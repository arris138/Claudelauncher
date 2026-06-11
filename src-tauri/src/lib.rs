use serde::{Deserialize, Serialize};
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::PathBuf;
use std::process::Command;
use std::sync::Mutex;
use tauri::Manager;

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LaunchRequest {
    pub claude_path: String,
    pub project_path: String,
    pub terminal_profile: String,
    pub flags: Vec<String>,
    pub remote_control: bool,
    pub pre_launch_command: Option<String>,
    pub tab_color: Option<String>,
    pub tab_title: Option<String>,
    /// When true, skip --suppressApplicationTitle so Claude Code's own
    /// dynamic titles (status spinner / task text) replace the tab title.
    pub dynamic_title: Option<bool>,
    /// When true, leave the title un-suppressed (so the installed statusLine's
    /// OSC title sequence is honored) and record this project's name in the
    /// path→name map the statusLine reads to render "<name> — <model>".
    pub model_in_title: Option<bool>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct LaunchResult {
    pub success: bool,
    pub command: String,
    pub error: Option<String>,
}

// Managed state for log file path
pub struct LogPath(pub Mutex<PathBuf>);

// Managed state for the app data directory (used to restrict log path changes)
pub struct AppDataDir(pub PathBuf);

fn write_log(log_path: &PathBuf, level: &str, message: &str) {
    let timestamp = chrono::Local::now().format("%Y-%m-%d %H:%M:%S%.3f");
    let line = format!("[{}] [{}] {}\n", timestamp, level, message);

    if let Some(parent) = log_path.parent() {
        let _ = fs::create_dir_all(parent);
    }

    if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(log_path) {
        let _ = file.write_all(line.as_bytes());
    }
}

/// Shell metacharacters that must not appear in user-supplied values
/// passed to shell command strings.
const SHELL_METACHARACTERS: &[char] = &[';', '|', '&', '`', '$', '(', ')', '{', '}', '<', '>', '!', '\n', '\r'];

/// Validate that a CLI flag matches the safe pattern: --[a-zA-Z][a-zA-Z0-9-]*
/// Optionally allows =value suffix for flags like --model=opus
fn is_safe_flag(flag: &str) -> bool {
    if !flag.starts_with("--") {
        return false;
    }
    let rest = &flag[2..];
    // Split on first '=' to allow --flag=value
    let name = rest.split('=').next().unwrap_or("");
    if name.is_empty() {
        return false;
    }
    let mut chars = name.chars();
    match chars.next() {
        Some(c) if c.is_ascii_alphabetic() => {}
        _ => return false,
    }
    if !chars.all(|c| c.is_ascii_alphanumeric() || c == '-') {
        return false;
    }
    // If there's a value part after '=', ensure no shell metacharacters
    if let Some(eq_pos) = rest.find('=') {
        let value = &rest[eq_pos + 1..];
        if value.contains(SHELL_METACHARACTERS.as_ref()) {
            return false;
        }
    }
    true
}

/// Validate that a path string contains no shell metacharacters
fn is_safe_path(path: &str) -> bool {
    !path.contains(SHELL_METACHARACTERS.as_ref())
}

/// Build the PowerShell command string to invoke claude with flags.
/// Returns something like: & 'C:\path\claude.exe' '--flag1' '--flag2'
fn build_claude_pwsh_cmd(request: &LaunchRequest) -> String {
    let mut cmd_parts: Vec<String> = vec![
        "&".to_string(),
        format!("'{}'", request.claude_path.replace('\'', "''")),
    ];
    if request.remote_control {
        cmd_parts.push("'remote-control'".to_string());
    }
    for flag in &request.flags {
        cmd_parts.push(format!("'{}'", flag.replace('\'', "''")));
    }
    cmd_parts.join(" ")
}

/// Validate that a color is a strict `#rrggbb` hex string.
fn is_safe_color(color: &str) -> bool {
    let bytes = color.as_bytes();
    bytes.len() == 7 && bytes[0] == b'#' && bytes[1..].iter().all(|b| b.is_ascii_hexdigit())
}

/// Validate that a tab title is safe: non-empty, bounded length, no shell
/// metacharacters. `;` matters most — wt treats it as a subcommand delimiter.
fn is_safe_title(title: &str) -> bool {
    !title.is_empty() && title.len() <= 128 && !title.contains(SHELL_METACHARACTERS.as_ref())
}

/// Validate that a terminal profile name is safe (alphanumeric, spaces, hyphens, underscores)
fn is_safe_profile(profile: &str) -> bool {
    !profile.is_empty()
        && profile
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == ' ' || c == '-' || c == '_')
}

#[tauri::command]
async fn launch_claude(
    app: tauri::AppHandle,
    request: LaunchRequest,
) -> Result<LaunchResult, String> {
    let log_path = app.state::<LogPath>().0.lock().unwrap().clone();
    write_log(&log_path, "INFO", &format!("Launch requested for: {}", request.project_path));

    // --- Input validation ---
    if !is_safe_path(&request.claude_path) {
        let msg = "Claude path contains invalid characters".to_string();
        write_log(&log_path, "ERROR", &msg);
        return Ok(LaunchResult { success: false, command: String::new(), error: Some(msg) });
    }

    if !is_safe_path(&request.project_path) {
        let msg = "Project path contains invalid characters".to_string();
        write_log(&log_path, "ERROR", &msg);
        return Ok(LaunchResult { success: false, command: String::new(), error: Some(msg) });
    }

    if !is_safe_profile(&request.terminal_profile) {
        let msg = "Terminal profile contains invalid characters".to_string();
        write_log(&log_path, "ERROR", &msg);
        return Ok(LaunchResult { success: false, command: String::new(), error: Some(msg) });
    }

    for flag in &request.flags {
        if !is_safe_flag(flag) {
            let msg = format!("Invalid flag rejected: {}", flag);
            write_log(&log_path, "ERROR", &msg);
            return Ok(LaunchResult { success: false, command: String::new(), error: Some(msg) });
        }
    }

    // Reject a malformed tab color rather than passing it to wt.
    if let Some(color) = &request.tab_color {
        if !color.is_empty() && !is_safe_color(color) {
            let msg = format!("Invalid tab color rejected: {}", color);
            write_log(&log_path, "ERROR", &msg);
            return Ok(LaunchResult { success: false, command: String::new(), error: Some(msg) });
        }
    }

    // Reject a malformed tab title rather than passing it to wt.
    if let Some(title) = &request.tab_title {
        if !title.is_empty() && !is_safe_title(title) {
            let msg = format!("Invalid tab title rejected: {}", title);
            write_log(&log_path, "ERROR", &msg);
            return Ok(LaunchResult { success: false, command: String::new(), error: Some(msg) });
        }
    }

    // Validate project path exists
    if !std::path::Path::new(&request.project_path).exists() {
        let msg = format!("Project directory does not exist: {}", request.project_path);
        write_log(&log_path, "ERROR", &msg);
        return Ok(LaunchResult {
            success: false,
            command: String::new(),
            error: Some(msg),
        });
    }

    // Validate claude_path points to an existing file
    let claude_path = std::path::Path::new(&request.claude_path);
    if !claude_path.exists() {
        let msg = format!("Claude executable not found: {}", request.claude_path);
        write_log(&log_path, "ERROR", &msg);
        return Ok(LaunchResult {
            success: false,
            command: String::new(),
            error: Some(msg),
        });
    }

    // Build wt arguments.
    // Without pre-launch: wt new-tab --profile "PowerShell" -d "path" -- claude --flags
    // With pre-launch:    wt new-tab --profile "PowerShell" -d "path" -- pwsh -NoExit -Command "pre_cmd; & 'claude' '--flags'"
    let has_pre_launch = request.pre_launch_command.as_ref().is_some_and(|c| !c.is_empty());

    let mut args: Vec<String> = vec![
        "new-tab".to_string(),
        "--profile".to_string(),
        request.terminal_profile.clone(),
        "-d".to_string(),
        request.project_path.clone(),
    ];

    // Color the terminal tab per-project. This is a wt new-tab option, so it
    // must come before the `--` command separator.
    if let Some(color) = &request.tab_color {
        if is_safe_color(color) {
            args.push("--tabColor".to_string());
            args.push(color.clone());
        }
    }

    // Title the terminal tab per-project. --suppressApplicationTitle keeps it
    // fixed; without it Claude Code's own OSC title updates (and the installed
    // statusLine's "<name> — <model>" title) replace it. Both `dynamic_title`
    // and `model_in_title` need the title left un-suppressed.
    let live_title = request.dynamic_title.unwrap_or(false)
        || request.model_in_title.unwrap_or(false);
    if let Some(title) = &request.tab_title {
        if is_safe_title(title) {
            args.push("--title".to_string());
            args.push(title.clone());
            if !live_title {
                args.push("--suppressApplicationTitle".to_string());
            }
        }
    }

    // When live model-in-title is on, record this project's name keyed by its
    // directory so the installed statusLine can look it up by the cwd it
    // receives and render "<name> — <model>". Best-effort: a failure here must
    // not block the launch.
    if request.model_in_title.unwrap_or(false) {
        if let Some(title) = &request.tab_title {
            if is_safe_title(title) {
                if let Err(e) = upsert_tab_name(&request.project_path, title) {
                    write_log(&log_path, "WARN", &format!("Failed to update tab-name map: {}", e));
                }
            }
        }
    }

    args.push("--".to_string());

    if has_pre_launch {
        let claude_cmd = build_claude_pwsh_cmd(&request);
        let pre_cmd = request.pre_launch_command.as_ref().unwrap();

        // Write both commands to a temp PowerShell script to avoid wt
        // semicolon parsing issues. wt treats ';' as a subcommand delimiter
        // (opening separate tabs) even within quoted arguments, and \; escaping
        // is unreliable when args are passed through Rust's Command API.
        let temp_dir = std::env::temp_dir();
        let script_path = temp_dir.join("claude-launcher-prelaunch.ps1");
        let script_content = format!("{}\n{}", pre_cmd, claude_cmd);

        if let Err(e) = std::fs::write(&script_path, &script_content) {
            let msg = format!("Failed to write pre-launch script: {}", e);
            write_log(&log_path, "ERROR", &msg);
            return Ok(LaunchResult { success: false, command: String::new(), error: Some(msg) });
        }

        args.push("pwsh".to_string());
        args.push("-NoExit".to_string());
        args.push("-ExecutionPolicy".to_string());
        args.push("Bypass".to_string());
        args.push("-File".to_string());
        args.push(script_path.to_string_lossy().to_string());
    } else {
        args.push(request.claude_path.clone());
        if request.remote_control {
            args.push("remote-control".to_string());
        }
        for flag in &request.flags {
            args.push(flag.clone());
        }
    }

    let full_command = format!("wt {}", args.join(" "));
    write_log(&log_path, "INFO", &format!("Executing: {}", full_command));

    // Try wt first, then fall back to starting cmd/pwsh directly
    match Command::new("wt")
        .args(&args)
        .env_remove("CLAUDECODE")
        .spawn()
    {
        Ok(mut child) => {
            // Wait briefly to see if it exits immediately with error
            tokio::time::sleep(std::time::Duration::from_millis(500)).await;
            match child.try_wait() {
                Ok(Some(status)) if !status.success() => {
                    let msg = format!("wt exited with code: {:?}", status.code());
                    write_log(&log_path, "WARN", &msg);
                    // Fall back to pwsh directly
                    write_log(&log_path, "INFO", "Falling back to pwsh direct launch");
                    launch_with_pwsh(&log_path, &request)
                }
                Ok(_) => {
                    write_log(&log_path, "INFO", "Launch successful via wt");
                    Ok(LaunchResult {
                        success: true,
                        command: full_command,
                        error: None,
                    })
                }
                Err(e) => {
                    let msg = format!("Error checking wt status: {}", e);
                    write_log(&log_path, "WARN", &msg);
                    Ok(LaunchResult {
                        success: true,
                        command: full_command,
                        error: None,
                    })
                }
            }
        }
        Err(e) => {
            let msg = format!("wt spawn failed: {}", e);
            write_log(&log_path, "WARN", &msg);
            write_log(&log_path, "INFO", "Falling back to pwsh direct launch");
            launch_with_pwsh(&log_path, &request)
        }
    }
}

fn launch_with_pwsh(log_path: &PathBuf, request: &LaunchRequest) -> Result<LaunchResult, String> {
    // Launch claude as a direct process via pwsh, passing the executable
    // and flags as separate arguments to avoid shell interpretation.
    // Using -NoExit keeps the terminal open; -Command with & (call operator)
    // and individually quoted args prevents injection.
    let claude_cmd = build_claude_pwsh_cmd(request);
    let claude_cmd = match &request.pre_launch_command {
        Some(pre_cmd) if !pre_cmd.is_empty() => format!("{}; {}", pre_cmd, claude_cmd),
        _ => claude_cmd,
    };
    // No --suppressApplicationTitle equivalent here, so Claude may still
    // retitle the window later; set the initial title at least.
    let claude_cmd = match &request.tab_title {
        Some(title) if is_safe_title(title) => format!(
            "$Host.UI.RawUI.WindowTitle = '{}'; {}",
            title.replace('\'', "''"),
            claude_cmd
        ),
        _ => claude_cmd,
    };

    let full_command = format!(
        "pwsh -NoExit -WorkingDirectory \"{}\" -Command \"{}\"",
        request.project_path, claude_cmd
    );
    write_log(log_path, "INFO", &format!("Executing fallback: {}", full_command));

    match Command::new("pwsh")
        .args([
            "-NoExit",
            "-WorkingDirectory",
            &request.project_path,
            "-Command",
            &claude_cmd,
        ])
        .env_remove("CLAUDECODE")
        .spawn()
    {
        Ok(_) => {
            write_log(log_path, "INFO", "Launch successful via pwsh fallback");
            Ok(LaunchResult {
                success: true,
                command: full_command,
                error: None,
            })
        }
        Err(e) => {
            let msg = format!("pwsh fallback also failed: {}", e);
            write_log(log_path, "ERROR", &msg);
            Ok(LaunchResult {
                success: false,
                command: full_command,
                error: Some(msg),
            })
        }
    }
}

#[tauri::command]
async fn list_terminal_profiles() -> Result<Vec<String>, String> {
    // Read Windows Terminal settings.json to extract profile names
    let local_app_data = std::env::var("LOCALAPPDATA").unwrap_or_default();
    let candidates = vec![
        // Stable
        std::path::PathBuf::from(&local_app_data)
            .join("Packages")
            .join("Microsoft.WindowsTerminal_8wekyb3d8bbwe")
            .join("LocalState")
            .join("settings.json"),
        // Preview
        std::path::PathBuf::from(&local_app_data)
            .join("Packages")
            .join("Microsoft.WindowsTerminalPreview_8wekyb3d8bbwe")
            .join("LocalState")
            .join("settings.json"),
        // Unpackaged / scoop / winget
        std::path::PathBuf::from(&local_app_data)
            .join("Microsoft")
            .join("Windows Terminal")
            .join("settings.json"),
    ];

    for path in candidates {
        if let Ok(content) = fs::read_to_string(&path) {
            // Strip single-line comments (// ...) that Windows Terminal allows
            let stripped: String = content
                .lines()
                .map(|line| {
                    let trimmed = line.trim_start();
                    if trimmed.starts_with("//") {
                        ""
                    } else {
                        line
                    }
                })
                .collect::<Vec<_>>()
                .join("\n");

            if let Ok(json) = serde_json::from_str::<serde_json::Value>(&stripped) {
                let mut names: Vec<String> = Vec::new();
                if let Some(profiles) = json.get("profiles") {
                    // profiles.list is the array of profile objects
                    let list = profiles.get("list").unwrap_or(profiles);
                    if let Some(arr) = list.as_array() {
                        for profile in arr {
                            if let Some(name) = profile.get("name").and_then(|n| n.as_str()) {
                                if profile.get("hidden").and_then(|h| h.as_bool()).unwrap_or(false) {
                                    continue;
                                }
                                if !name.is_empty() {
                                    names.push(name.to_string());
                                }
                            }
                        }
                    }
                }
                // Deduplicate profile names while preserving order
                let mut seen = std::collections::HashSet::new();
                names.retain(|n| seen.insert(n.clone()));
                if !names.is_empty() {
                    return Ok(names);
                }
            }
        }
    }

    // Fallback: return common defaults
    Ok(vec![
        "PowerShell".to_string(),
        "Command Prompt".to_string(),
    ])
}

/// Insert or replace our chime hook entry in a given hook event array.
/// Removes any pre-existing entry whose command references `marker` (so a
/// re-install updates paths instead of stacking duplicates), then appends a
/// fresh entry pointing at the current command.
fn upsert_hook(
    hooks_obj: &mut serde_json::Map<String, serde_json::Value>,
    event: &str,
    command: &str,
    marker: &str,
    timeout: u64,
) {
    let entry = hooks_obj
        .entry(event.to_string())
        .or_insert_with(|| serde_json::json!([]));
    if !entry.is_array() {
        *entry = serde_json::json!([]);
    }
    let arr = entry.as_array_mut().unwrap();
    arr.retain(|group| {
        let references_marker = group
            .get("hooks")
            .and_then(|h| h.as_array())
            .map(|inner| {
                inner.iter().any(|h| {
                    h.get("command")
                        .and_then(|c| c.as_str())
                        .map(|c| c.contains(marker))
                        .unwrap_or(false)
                })
            })
            .unwrap_or(false);
        !references_marker
    });
    arr.push(serde_json::json!({
        "hooks": [
            {
                "type": "command",
                "command": command,
                "timeout": timeout
            }
        ]
    }));
}

/// Copy the bundled chime sounds into ~/.claude/sounds and merge the Stop +
/// Notification hooks into ~/.claude/settings.json. Idempotent: re-running
/// refreshes the files and rewrites the hook entries (fixing the user path on
/// a new machine) without disturbing other settings or hooks.
#[tauri::command]
async fn install_chime_hooks(app: tauri::AppHandle) -> Result<String, String> {
    let log_path = app.state::<LogPath>().0.lock().unwrap().clone();

    let home = std::env::var_os("USERPROFILE")
        .map(PathBuf::from)
        .ok_or_else(|| "Could not resolve USERPROFILE".to_string())?;
    let claude_dir = home.join(".claude");
    let sounds_dir = claude_dir.join("sounds");
    fs::create_dir_all(&sounds_dir)
        .map_err(|e| format!("Failed to create {}: {}", sounds_dir.display(), e))?;

    // Copy bundled wav resources into the user's sounds directory.
    let resource_dir = app
        .path()
        .resource_dir()
        .map_err(|e| format!("Failed to resolve resource dir: {}", e))?;
    let bundled_sounds = resource_dir.join("sounds");
    for file in ["computer-chirp.wav", "computer-chirp-fast.wav"] {
        let src = bundled_sounds.join(file);
        let dst = sounds_dir.join(file);
        fs::copy(&src, &dst)
            .map_err(|e| format!("Failed to copy {} -> {}: {}", src.display(), dst.display(), e))?;
    }

    let normal = sounds_dir.join("computer-chirp.wav");
    let fast = sounds_dir.join("computer-chirp-fast.wav");

    // Stop: single chirp when Claude finishes a turn.
    let stop_cmd = format!(
        "powershell -Command \"(New-Object Media.SoundPlayer '{}').PlaySync()\"",
        normal.display()
    );
    // Notification: faster double-chirp when Claude pauses for input/permission.
    let notif_cmd = format!(
        "powershell -Command \"$p = New-Object Media.SoundPlayer '{}'; $p.PlaySync(); Start-Sleep -Milliseconds 120; $p.PlaySync()\"",
        fast.display()
    );

    let settings_path = claude_dir.join("settings.json");
    let mut root: serde_json::Value = if settings_path.exists() {
        let content = fs::read_to_string(&settings_path)
            .map_err(|e| format!("Failed to read settings.json: {}", e))?;
        // Back up before modifying.
        let _ = fs::write(claude_dir.join("settings.json.bak"), &content);
        serde_json::from_str(&content)
            .map_err(|e| format!("settings.json is not valid JSON: {}", e))?
    } else {
        serde_json::json!({})
    };

    let obj = root
        .as_object_mut()
        .ok_or_else(|| "settings.json root is not a JSON object".to_string())?;
    let hooks = obj
        .entry("hooks")
        .or_insert_with(|| serde_json::json!({}));
    let hooks_obj = hooks
        .as_object_mut()
        .ok_or_else(|| "settings.json 'hooks' is not an object".to_string())?;

    upsert_hook(hooks_obj, "Stop", &stop_cmd, "computer-chirp.wav", 2);
    upsert_hook(hooks_obj, "Notification", &notif_cmd, "computer-chirp-fast.wav", 3);

    let serialized = serde_json::to_string_pretty(&root)
        .map_err(|e| format!("Failed to serialize settings.json: {}", e))?;
    fs::write(&settings_path, serialized)
        .map_err(|e| format!("Failed to write settings.json: {}", e))?;

    let msg = format!("Chimes installed. Updated {}", settings_path.display());
    write_log(&log_path, "INFO", &msg);
    Ok(format!(
        "{}. Restart any running Claude sessions to pick up the new hooks.",
        msg
    ))
}

/// Normalize a directory path into a stable key for the tab-name map:
/// forward slashes → backslashes, trailing separators trimmed, lower-cased.
/// MUST match the normalization the statusLine script applies to its cwd.
fn normalize_path_key(path: &str) -> String {
    path.replace('/', "\\").trim_end_matches('\\').to_lowercase()
}

/// Record (or update) a project's display name in
/// ~/.claude/launcher-tab-names.json, keyed by its normalized directory.
/// The installed statusLine reads this map by the cwd it receives to render
/// "<name> — <model>". Best-effort; callers log and continue on error.
fn upsert_tab_name(project_path: &str, name: &str) -> Result<(), String> {
    let home = std::env::var_os("USERPROFILE")
        .map(PathBuf::from)
        .ok_or_else(|| "Could not resolve USERPROFILE".to_string())?;
    let claude_dir = home.join(".claude");
    fs::create_dir_all(&claude_dir).map_err(|e| e.to_string())?;
    let map_path = claude_dir.join("launcher-tab-names.json");

    let mut root: serde_json::Value = if map_path.exists() {
        fs::read_to_string(&map_path)
            .ok()
            .and_then(|c| serde_json::from_str(&c).ok())
            .unwrap_or_else(|| serde_json::json!({}))
    } else {
        serde_json::json!({})
    };
    if !root.is_object() {
        root = serde_json::json!({});
    }
    root.as_object_mut().unwrap().insert(
        normalize_path_key(project_path),
        serde_json::Value::String(name.to_string()),
    );

    let serialized = serde_json::to_string_pretty(&root).map_err(|e| e.to_string())?;
    fs::write(&map_path, serialized).map_err(|e| e.to_string())?;
    Ok(())
}

/// PowerShell statusLine that re-titles the tab "<name> — <model>" on every
/// render (so swapping models with /model updates it live) and preserves any
/// pre-existing statusLine by chaining it for the visible text. `__INNER__` is
/// replaced at install time with the chained command (single-quote-escaped),
/// or left empty when there is nothing to chain.
const STATUSLINE_TEMPLATE: &str = r#"# Auto-generated by Claude Launcher. Re-run "Install model-in-title statusline"
# to regenerate. Keeps the Windows Terminal tab titled "<name> - <model>" and
# updates it whenever the model changes mid-session.
$ErrorActionPreference = 'SilentlyContinue'
$raw = [Console]::In.ReadToEnd()
try { $j = $raw | ConvertFrom-Json } catch { $j = $null }

$model = ''
if ($j) {
  $model = $j.model.display_name
  if (-not $model) { $model = $j.model.id }
}

$cwd = ''
if ($j) {
  $cwd = $j.workspace.current_dir
  if (-not $cwd) { $cwd = $j.cwd }
}

$name = ''
if ($cwd) {
  $key = ($cwd -replace '/', '\').TrimEnd('\').ToLower()
  $mapPath = Join-Path $env:USERPROFILE '.claude\launcher-tab-names.json'
  if (Test-Path $mapPath) {
    try {
      $map = Get-Content -Raw $mapPath | ConvertFrom-Json -AsHashtable
      if ($map -and $map.ContainsKey($key)) { $name = $map[$key] }
    } catch {}
  }
  if (-not $name) { $name = Split-Path $cwd -Leaf }
}

# Visible status text: chain a pre-existing statusLine if one was preserved.
$inner = '__INNER__'
$base = ''
if ($inner) {
  try { $base = ($raw | & ([scriptblock]::Create($inner))) | Out-String } catch {}
  $base = $base.TrimEnd("`r", "`n")
}

# Emit the tab title via OSC 0 (honored because the tab is not suppressed).
$sep = [char]0x2014
if ($name -and $model) { $title = "$name $sep $model" }
elseif ($model)        { $title = $model }
else                   { $title = $name }
if ($title) {
  $esc = [char]27
  $bel = [char]7
  [Console]::Out.Write("$esc]0;$title$bel")
}

if ($base) { Write-Output $base }
elseif ($name -and $model) { Write-Output "$name $([char]0x00B7) $model" }
elseif ($model) { Write-Output $model }
"#;

/// Write the model-in-title statusLine script to ~/.claude/scripts and point
/// settings.json at it. Idempotent and non-destructive: an existing user
/// statusLine is preserved (chained for the visible text and remembered in a
/// sidecar so re-installs don't drop it). Mirrors `install_chime_hooks`.
#[tauri::command]
async fn install_model_title_statusline(app: tauri::AppHandle) -> Result<String, String> {
    let log_path = app.state::<LogPath>().0.lock().unwrap().clone();

    let home = std::env::var_os("USERPROFILE")
        .map(PathBuf::from)
        .ok_or_else(|| "Could not resolve USERPROFILE".to_string())?;
    let claude_dir = home.join(".claude");
    let scripts_dir = claude_dir.join("scripts");
    fs::create_dir_all(&scripts_dir)
        .map_err(|e| format!("Failed to create {}: {}", scripts_dir.display(), e))?;
    let script_path = scripts_dir.join("launcher-statusline.ps1");
    let inner_sidecar = scripts_dir.join("launcher-statusline-inner.txt");
    let script_marker = "launcher-statusline.ps1";

    let settings_path = claude_dir.join("settings.json");
    let mut root: serde_json::Value = if settings_path.exists() {
        let content = fs::read_to_string(&settings_path)
            .map_err(|e| format!("Failed to read settings.json: {}", e))?;
        let _ = fs::write(claude_dir.join("settings.json.bak"), &content);
        serde_json::from_str(&content)
            .map_err(|e| format!("settings.json is not valid JSON: {}", e))?
    } else {
        serde_json::json!({})
    };
    let obj = root
        .as_object_mut()
        .ok_or_else(|| "settings.json root is not a JSON object".to_string())?;

    // Resolve any statusLine to chain for the visible text.
    let existing_cmd = obj
        .get("statusLine")
        .and_then(|sl| sl.get("command"))
        .and_then(|c| c.as_str())
        .unwrap_or("")
        .to_string();
    let mut inner_cmd = String::new();
    if !existing_cmd.is_empty() && !existing_cmd.contains(script_marker) {
        // A user's own statusLine — chain it and remember it for re-installs.
        inner_cmd = existing_cmd.clone();
        let _ = fs::write(&inner_sidecar, &inner_cmd);
    } else if existing_cmd.contains(script_marker) {
        // Re-installing over ours — recover the previously chained command.
        if let Ok(saved) = fs::read_to_string(&inner_sidecar) {
            inner_cmd = saved.trim().to_string();
        }
    }

    let script = STATUSLINE_TEMPLATE.replace("__INNER__", &inner_cmd.replace('\'', "''"));
    fs::write(&script_path, script)
        .map_err(|e| format!("Failed to write statusline script: {}", e))?;

    obj.insert(
        "statusLine".to_string(),
        serde_json::json!({
            "type": "command",
            "command": format!("pwsh -NoProfile -File \"{}\"", script_path.display()),
            "padding": 0
        }),
    );

    let serialized = serde_json::to_string_pretty(&root)
        .map_err(|e| format!("Failed to serialize settings.json: {}", e))?;
    fs::write(&settings_path, serialized)
        .map_err(|e| format!("Failed to write settings.json: {}", e))?;

    let chained = if inner_cmd.is_empty() {
        "no existing statusline to preserve"
    } else {
        "existing statusline preserved and chained"
    };
    let msg = format!(
        "Model-in-title statusline installed ({}). Updated {}",
        chained,
        settings_path.display()
    );
    write_log(&log_path, "INFO", &msg);
    Ok(format!(
        "{}. Enable \"Show live model in tab title\" per project, then restart any running Claude sessions.",
        msg
    ))
}

#[tauri::command]
async fn detect_claude_path() -> Result<String, String> {
    if let Some(home) = std::env::var_os("USERPROFILE") {
        let home_path = std::path::PathBuf::from(home);

        let candidates = vec![
            home_path.join(".local").join("bin").join("claude.exe"),
            home_path.join(".local").join("bin").join("claude"),
            home_path
                .join("AppData")
                .join("Local")
                .join("Programs")
                .join("claude")
                .join("claude.exe"),
        ];

        for candidate in candidates {
            if candidate.exists() {
                return Ok(candidate.to_string_lossy().to_string());
            }
        }
    }

    Ok("claude".to_string())
}

#[tauri::command]
async fn get_log_path(app: tauri::AppHandle) -> Result<String, String> {
    let log_path = app.state::<LogPath>().0.lock().unwrap().clone();
    Ok(log_path.to_string_lossy().to_string())
}

#[tauri::command]
async fn read_log(app: tauri::AppHandle, tail_lines: Option<usize>) -> Result<String, String> {
    let log_path = app.state::<LogPath>().0.lock().unwrap().clone();

    // Ensure log path is within the app data directory
    let app_data = app.state::<AppDataDir>().0.clone();
    let canonical_log = log_path.canonicalize().unwrap_or(log_path.clone());
    let canonical_app = app_data.canonicalize().unwrap_or(app_data.clone());
    if !canonical_log.starts_with(&canonical_app) {
        return Err("Log path is outside app data directory".to_string());
    }

    match fs::read_to_string(&log_path) {
        Ok(content) => {
            let lines: Vec<&str> = content.lines().collect();
            let n = tail_lines.unwrap_or(100);
            let start = if lines.len() > n { lines.len() - n } else { 0 };
            Ok(lines[start..].join("\n"))
        }
        Err(e) => {
            if e.kind() == std::io::ErrorKind::NotFound {
                Ok("No log entries yet.".to_string())
            } else {
                Err(format!("Failed to read log: {}", e))
            }
        }
    }
}

#[tauri::command]
async fn open_log_folder(app: tauri::AppHandle) -> Result<(), String> {
    let log_path = app.state::<LogPath>().0.lock().unwrap().clone();

    // Ensure log path is within the app data directory
    let app_data = app.state::<AppDataDir>().0.clone();
    let canonical_log = log_path.canonicalize().unwrap_or(log_path.clone());
    let canonical_app = app_data.canonicalize().unwrap_or(app_data.clone());
    if !canonical_log.starts_with(&canonical_app) {
        return Err("Log path is outside app data directory".to_string());
    }

    if let Some(parent) = log_path.parent() {
        let _ = Command::new("explorer").arg(parent).spawn();
    }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            // Default log path: app data dir / logs / claude-launcher.log
            let app_data = app.path().app_data_dir().unwrap_or_else(|_| {
                PathBuf::from(std::env::var("USERPROFILE").unwrap_or_default())
                    .join(".claude-launcher")
            });
            let log_path = app_data.join("logs").join("claude-launcher.log");
            write_log(&log_path, "INFO", "Claude Launcher started");
            app.manage(AppDataDir(app_data));
            app.manage(LogPath(Mutex::new(log_path)));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            launch_claude,
            detect_claude_path,
            install_chime_hooks,
            install_model_title_statusline,
            list_terminal_profiles,
            get_log_path,
            read_log,
            open_log_folder,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
