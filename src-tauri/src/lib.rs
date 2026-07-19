use serde::{Deserialize, Serialize};
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::PathBuf;
use std::process::Command;
use std::sync::Mutex;
use tauri::Manager;

mod ide;

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LaunchRequest {
    /// Executable for whichever agent CLI this project runs. The frontend
    /// agent registry resolves it; this side never learns which agent it is.
    pub agent_path: String,
    pub project_path: String,
    pub terminal_profile: String,
    pub flags: Vec<String>,
    /// Subcommand inserted before the flags, or None. Claude Code sends
    /// Some("remote-control") when that setting is on.
    pub subcommand: Option<String>,
    /// True only for Claude Code. Gates the behaviours that exist because of
    /// Claude Code's specific protocols rather than because of terminals in
    /// general: the HKCU full-repaint env install, the statusLine path→name
    /// map, nested-session suppression, and the CLAUDE_CODE_* renderer vars.
    /// Sending these to another agent would at best be inert and at worst
    /// confuse it, so they are opt-in rather than unconditional.
    #[serde(default)]
    pub claude_features: bool,
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
    /// IDE-mode renderer: "classic" forces Claude's scrollback renderer
    /// (CLAUDE_CODE_DISABLE_ALTERNATE_SCREEN); anything else (incl. unset)
    /// uses the fullscreen alt-screen TUI. Ignored by the wt launch path.
    pub ide_renderer: Option<String>,
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

/// Metacharacters that must not appear in filesystem paths. Looser than
/// `SHELL_METACHARACTERS` because characters like `( ) { } ! $ &` are legal in
/// Windows paths (e.g. `C:\Program Files (x86)\...`). Paths are always passed
/// as discrete process arguments (never interpolated into a shell string), so
/// the only chars worth blocking are wt's `;` subcommand delimiter, shell
/// redirection/pipe chars, backtick, and newlines.
const PATH_METACHARACTERS: &[char] = &[';', '|', '`', '<', '>', '\n', '\r'];

/// Validate that a CLI flag matches the safe pattern: --[a-zA-Z][a-zA-Z0-9-]*
/// Optionally allows =value suffix for flags like --model=opus
pub(crate) fn is_safe_flag(flag: &str) -> bool {
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

/// Validate that a path string contains no dangerous metacharacters.
/// Uses the path-specific (looser) set so legal Windows paths such as
/// `C:\Program Files (x86)\...` are accepted.
pub(crate) fn is_safe_path(path: &str) -> bool {
    !path.contains(PATH_METACHARACTERS.as_ref())
}

/// Env var that fixes intermittently garbled fullscreen-TUI output on Windows
/// Terminal (stale glyphs from the previous frame left in the leading columns)
/// by making Claude Code repaint the whole screen each frame instead of
/// incrementally. See anthropics/claude-code#69619. Persisted as a user-level
/// Windows environment variable (HKCU\Environment) by ensure_full_repaint_env
/// so every future terminal inherits it in its real process env before claude
/// starts; the wt spawn and the pwsh fallback also set it directly on their
/// child as belt-and-suspenders. The IDE PTY deliberately REMOVES it instead —
/// the bug it fixes is Windows Terminal's, and in the embedded xterm terminal
/// per-frame full repaints only multiply rendering load (see ide.rs).
pub(crate) const FULL_REPAINT_ENV: &str = "CLAUDE_CODE_ALT_SCREEN_FULL_REPAINT";

/// Validate a subcommand: lowercase ASCII, digits and dashes only, starting
/// with a letter. The vocabulary is closed and supplied by the frontend agent
/// registry, but this struct crosses the IPC boundary, so validate anyway.
pub(crate) fn is_safe_subcommand(sub: &str) -> bool {
    !sub.is_empty()
        && sub.len() <= 32
        && sub.starts_with(|c: char| c.is_ascii_lowercase())
        && sub
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
}

/// Build the PowerShell command string to invoke the agent with flags.
/// Returns something like: & 'C:\path\claude.exe' '--flag1' '--flag2'
pub(crate) fn build_agent_pwsh_cmd(request: &LaunchRequest) -> String {
    let mut cmd_parts: Vec<String> = vec![
        "&".to_string(),
        format!("'{}'", request.agent_path.replace('\'', "''")),
    ];
    if let Some(sub) = request.subcommand.as_deref() {
        if is_safe_subcommand(sub) {
            cmd_parts.push(format!("'{}'", sub));
        }
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
async fn launch_agent(
    app: tauri::AppHandle,
    request: LaunchRequest,
) -> Result<LaunchResult, String> {
    let log_path = app.state::<LogPath>().0.lock().unwrap().clone();
    write_log(&log_path, "INFO", &format!("Launch requested for: {}", request.project_path));

    // --- Input validation ---
    if !is_safe_path(&request.agent_path) {
        let msg = "Agent path contains invalid characters".to_string();
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

    if let Some(sub) = request.subcommand.as_deref() {
        if !is_safe_subcommand(sub) {
            let msg = format!("Invalid subcommand rejected: {}", sub);
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

    // Validate agent_path points to an existing file
    let agent_path = std::path::Path::new(&request.agent_path);
    if !agent_path.exists() {
        let msg = format!("Agent executable not found: {}", request.agent_path);
        write_log(&log_path, "ERROR", &msg);
        return Ok(LaunchResult {
            success: false,
            command: String::new(),
            error: Some(msg),
        });
    }

    // Best-effort: make sure the session about to start (and every other
    // Claude session) picks up the fullscreen-repaint fix. The write completes
    // before the spawn below, so this launch already benefits. A failure here
    // must not block the launch. Claude Code only — the var means nothing to
    // another agent, and persisting it machine-wide on its behalf would be
    // writing someone else's config for no reason.
    if request.claude_features {
        match ensure_full_repaint_env() {
            Ok(true) => write_log(&log_path, "INFO", "Installed full-repaint env into HKCU\\Environment"),
            Ok(false) => {}
            Err(e) => write_log(&log_path, "WARN", &format!("full-repaint env install failed: {}", e)),
        }
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
    // Claude Code only: the map is read by the installed statusLine script,
    // which is a Claude Code concept with no analogue elsewhere.
    if request.claude_features && request.model_in_title.unwrap_or(false) {
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
        let agent_cmd = build_agent_pwsh_cmd(&request);
        let pre_cmd = request.pre_launch_command.as_ref().unwrap();

        // Write both commands to a temp PowerShell script to avoid wt
        // semicolon parsing issues. wt treats ';' as a subcommand delimiter
        // (opening separate tabs) even within quoted arguments, and \; escaping
        // is unreliable when args are passed through Rust's Command API.
        let temp_dir = std::env::temp_dir();
        let script_path = temp_dir.join("claude-launcher-prelaunch.ps1");
        let script_content = format!("{}\n{}", pre_cmd, agent_cmd);

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
        args.push(request.agent_path.clone());
        if let Some(sub) = request.subcommand.as_deref() {
            args.push(sub.to_string());
        }
        for flag in &request.flags {
            args.push(flag.clone());
        }
    }

    let full_command = format!("wt {}", args.join(" "));
    write_log(&log_path, "INFO", &format!("Executing: {}", full_command));

    // Try wt first, then fall back to starting cmd/pwsh directly
    let mut wt_cmd = Command::new("wt");
    wt_cmd.args(&args);
    if request.claude_features {
        // Prevent Claude's nested-session detection.
        wt_cmd.env_remove("CLAUDECODE");
        // Belt-and-suspenders for the repaint fix: when this spawn starts a fresh
        // wt.exe (no existing window services the request), the new wt — and the
        // claude tab under it — inherit our env directly, so the fix applies even
        // before the persisted HKCU var has propagated to a new shell session.
        wt_cmd.env(FULL_REPAINT_ENV, "1");
    }
    match wt_cmd.spawn() {
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
    // Launch the agent as a direct process via pwsh, passing the executable
    // and flags as separate arguments to avoid shell interpretation.
    // Using -NoExit keeps the terminal open; -Command with & (call operator)
    // and individually quoted args prevents injection.
    let agent_cmd = build_agent_pwsh_cmd(request);
    let agent_cmd = match &request.pre_launch_command {
        Some(pre_cmd) if !pre_cmd.is_empty() => format!("{}; {}", pre_cmd, agent_cmd),
        _ => agent_cmd,
    };
    // No --suppressApplicationTitle equivalent here, so the agent may still
    // retitle the window later; set the initial title at least.
    let agent_cmd = match &request.tab_title {
        Some(title) if is_safe_title(title) => format!(
            "$Host.UI.RawUI.WindowTitle = '{}'; {}",
            title.replace('\'', "''"),
            agent_cmd
        ),
        _ => agent_cmd,
    };

    let full_command = format!(
        "pwsh -NoExit -WorkingDirectory \"{}\" -Command \"{}\"",
        request.project_path, agent_cmd
    );
    write_log(log_path, "INFO", &format!("Executing fallback: {}", full_command));

    let mut pwsh_cmd = Command::new("pwsh");
    pwsh_cmd.args([
        "-NoExit",
        "-WorkingDirectory",
        &request.project_path,
        "-Command",
        &agent_cmd,
    ]);
    if request.claude_features {
        pwsh_cmd.env_remove("CLAUDECODE");
        // Direct child of this pwsh spawn, so the env propagates reliably
        // (unlike the wt path, which sets it inside the launch script).
        pwsh_cmd.env(FULL_REPAINT_ENV, "1");
    }
    match pwsh_cmd.spawn() {
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

/// Launch a plain Command Prompt or PowerShell window (no Claude), opened in
/// the user's home directory. Tries Windows Terminal first, then falls back to
/// spawning the shell in its own new console. `shell` must be "cmd" or "pwsh".
#[tauri::command]
async fn launch_shell(app: tauri::AppHandle, shell: String) -> Result<LaunchResult, String> {
    let log_path = app.state::<LogPath>().0.lock().unwrap().clone();

    // Whitelist the shell to a known pair — never pass arbitrary strings to a
    // process spawn.
    let (exe, profile, extra_args): (&str, &str, &[&str]) = match shell.as_str() {
        "cmd" => ("cmd.exe", "Command Prompt", &["/k"]),
        "pwsh" => ("pwsh.exe", "PowerShell", &["-NoExit"]),
        other => {
            let msg = format!("Unsupported shell requested: {}", other);
            write_log(&log_path, "ERROR", &msg);
            return Ok(LaunchResult { success: false, command: String::new(), error: Some(msg) });
        }
    };

    let home = std::env::var("USERPROFILE").unwrap_or_default();
    write_log(&log_path, "INFO", &format!("Shell launch requested: {} in {}", exe, home));

    // Try Windows Terminal: wt new-tab --profile "<profile>" -d <home> -- <exe> <extra>
    let mut wt_args: Vec<String> = vec![
        "new-tab".to_string(),
        "--profile".to_string(),
        profile.to_string(),
    ];
    if !home.is_empty() {
        wt_args.push("-d".to_string());
        wt_args.push(home.clone());
    }
    wt_args.push("--".to_string());
    wt_args.push(exe.to_string());
    for a in extra_args {
        wt_args.push(a.to_string());
    }

    let full_command = format!("wt {}", wt_args.join(" "));
    write_log(&log_path, "INFO", &format!("Executing: {}", full_command));

    match Command::new("wt").args(&wt_args).env_remove("CLAUDECODE").spawn() {
        Ok(mut child) => {
            tokio::time::sleep(std::time::Duration::from_millis(500)).await;
            match child.try_wait() {
                Ok(Some(status)) if !status.success() => {
                    write_log(&log_path, "WARN", &format!("wt exited with code: {:?}", status.code()));
                    launch_shell_direct(&log_path, exe, extra_args, &home)
                }
                _ => {
                    write_log(&log_path, "INFO", "Shell launch successful via wt");
                    Ok(LaunchResult { success: true, command: full_command, error: None })
                }
            }
        }
        Err(e) => {
            write_log(&log_path, "WARN", &format!("wt spawn failed: {}", e));
            launch_shell_direct(&log_path, exe, extra_args, &home)
        }
    }
}

/// Fallback: spawn the shell directly in its own new console window.
fn launch_shell_direct(
    log_path: &PathBuf,
    exe: &str,
    extra_args: &[&str],
    home: &str,
) -> Result<LaunchResult, String> {
    // CREATE_NEW_CONSOLE so the shell gets its own visible window rather than
    // attaching (invisibly) to this GUI process.
    const CREATE_NEW_CONSOLE: u32 = 0x0000_0010;
    use std::os::windows::process::CommandExt;

    let mut cmd = Command::new(exe);
    cmd.args(extra_args).env_remove("CLAUDECODE").creation_flags(CREATE_NEW_CONSOLE);
    if !home.is_empty() {
        cmd.current_dir(home);
    }

    match cmd.spawn() {
        Ok(_) => {
            write_log(log_path, "INFO", &format!("Shell launch successful via direct {} spawn", exe));
            Ok(LaunchResult { success: true, command: exe.to_string(), error: None })
        }
        Err(e) => {
            let msg = format!("Direct {} spawn failed: {}", exe, e);
            write_log(log_path, "ERROR", &msg);
            Ok(LaunchResult { success: false, command: exe.to_string(), error: Some(msg) })
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

/// The IDE attention hook script, written to ~/.claude/scripts. Keeping the
/// logic in a file (rather than inline in settings.json) is essential: Claude
/// Code runs hook commands through a shell, and on Windows that can be a POSIX
/// shell (Git Bash) which expands every `$var` to empty BEFORE powershell sees
/// it — mangling an inline `...$port...` command into a parse error. Here the
/// `$vars` live inside the script, never on the command line, so nothing can
/// strip them. Reads the loopback port + session id and POSTs {session,event}.
const IDE_EVENT_TEMPLATE: &str = r#"param([string]$Event)
# Auto-generated by Claude Launcher (IDE Mode). Notifies the running app so its
# session rail can blink and end the Working state. No-ops when the app isn't
# running or the session is external.
$ErrorActionPreference = 'SilentlyContinue'
# Prefer the port the spawning app instance stamped onto this session's env: it
# points at exactly the instance that owns the session, even when several apps
# (or a dev build) are running and the shared ide-port file has been overwritten
# by whichever launched last. Fall back to the file for older sessions.
$port = $env:CLAUDE_LAUNCHER_PORT
if (-not $port) {
  $portFile = Join-Path $env:USERPROFILE '.claude-launcher\ide-port'
  if (Test-Path $portFile) { $port = (Get-Content -Raw $portFile).Trim() }
}
$sid = $env:CLAUDE_LAUNCHER_SESSION
if (-not $port -or -not $sid) { return }
# Disable the Expect: 100-continue handshake so the body is sent with the
# headers in one shot — the app's tiny loopback listener answers immediately,
# and waiting for a 100 Continue would otherwise drop the body.
[System.Net.ServicePointManager]::Expect100Continue = $false
try {
  $body = @{ session = $sid; event = $Event } | ConvertTo-Json -Compress
  Invoke-RestMethod -Uri ("http://127.0.0.1:$port/event") -Method Post -TimeoutSec 1 -ContentType 'application/json' -Body $body | Out-Null
} catch { }
"#;

/// The Stop/Notification hook command that runs the IDE event script. The line
/// carries zero `$`/paren/brace tokens so a wrapping POSIX shell can't damage
/// it, and uses forward slashes so backslash-escaping is moot. The trailing
/// `#cl-ide-event` is the dedup marker (a harmless extra arg / shell comment).
fn ide_event_command(script_path: &std::path::Path, event: &str) -> String {
    let path = script_path.to_string_lossy().replace('\\', "/");
    format!(
        "powershell -NoProfile -ExecutionPolicy Bypass -File \"{}\" {} #cl-ide-event",
        path, event
    )
}

/// Persist the fullscreen-repaint fix as a **user-level Windows environment
/// variable** (HKCU\Environment → CLAUDE_CODE_ALT_SCREEN_FULL_REPAINT=1) so every
/// future terminal — and thus every Claude Code session, however launched —
/// inherits it in its real process environment before claude starts.
///
/// This replaces the old ~/.claude/settings.json vehicle, which proved
/// unreliable in practice: settings.json has many other writers (Claude Code's
/// own config writes, claude-mem, manual edits) that rewrite the whole file from
/// their in-memory copy and silently drop our injected `env` key. A registry var
/// can't be clobbered that way, and it sidesteps the unverified risk that Claude
/// reads renderer vars *before* applying settings.json `env`.
///
/// Idempotent and non-destructive: any existing value (including a deliberate
/// "0" opt-out) is respected and left untouched — we read HKCU directly (a cheap,
/// spawn-free registry read) and only write when the var is unset/empty, so after
/// the first launch this is a no-op. When a write is needed we shell to .NET's
/// SetEnvironmentVariable via PowerShell, which both persists the key and
/// broadcasts WM_SETTINGCHANGE so already-running Explorer refreshes its env
/// cache (terminals launched from the shell then inherit it without a re-login).
/// Already-open Windows Terminal windows still only pick it up after they
/// restart, since a running process's environment block is fixed at spawn.
/// Returns Ok(true) when it wrote, Ok(false) when the var was already set.
fn ensure_full_repaint_env() -> Result<bool, String> {
    use winreg::enums::HKEY_CURRENT_USER;
    use winreg::RegKey;

    let env = RegKey::predef(HKEY_CURRENT_USER)
        .open_subkey("Environment")
        .map_err(|e| format!("open HKCU\\Environment: {}", e))?;
    let current: Option<String> = env.get_value(FULL_REPAINT_ENV).ok();

    if !full_repaint_needs_write(current.as_deref()) {
        return Ok(false);
    }

    // Persist + broadcast in one shot. .NET's SetEnvironmentVariable writes
    // HKCU\Environment and sends WM_SETTINGCHANGE. The args are fixed literals
    // (FULL_REPAINT_ENV is a compile-time constant, no untrusted interpolation),
    // so PowerShell quoting is safe here.
    let status = Command::new("powershell")
        .args([
            "-NoProfile",
            "-Command",
            &format!(
                "[Environment]::SetEnvironmentVariable('{}','1','User')",
                FULL_REPAINT_ENV
            ),
        ])
        .status()
        .map_err(|e| format!("set user env var: {}", e))?;
    if !status.success() {
        return Err(format!("powershell exited {:?}", status.code()));
    }
    Ok(true)
}

/// Decide whether the repaint var needs writing: only when it is currently unset
/// or empty. Any explicit value (e.g. a user's deliberate "0") is preserved.
/// Split out from the registry/PowerShell I/O so it is unit-testable without
/// touching the real HKCU hive.
fn full_repaint_needs_write(current: Option<&str>) -> bool {
    matches!(current, None | Some(""))
}

/// The Windows build number, for xterm.js's `windowsPty` option. xterm keys its
/// ConPTY workarounds (reflow behavior, resize handling) off the host build the
/// same way VS Code does — it passes the real build from the pty host process.
/// Read from the registry (cheap, spawn-free); 0 on failure, which the frontend
/// treats as "don't set windowsPty".
#[tauri::command]
fn get_os_build() -> u32 {
    use winreg::enums::HKEY_LOCAL_MACHINE;
    use winreg::RegKey;

    RegKey::predef(HKEY_LOCAL_MACHINE)
        .open_subkey("SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion")
        .ok()
        .and_then(|k| k.get_value::<String, _>("CurrentBuildNumber").ok())
        .and_then(|s| s.trim().parse().ok())
        .unwrap_or(0)
}

/// Ensure the IDE-mode attention hooks are present in ~/.claude/settings.json,
/// WITHOUT touching chimes or anything else. Idempotent; called when the user
/// enters IDE Mode so the rail's blink / Working-end state works out of the box.
#[tauri::command]
async fn ensure_ide_hooks() -> Result<String, String> {
    let home = std::env::var_os("USERPROFILE")
        .map(PathBuf::from)
        .ok_or_else(|| "Could not resolve USERPROFILE".to_string())?;
    let claude_dir = home.join(".claude");
    let scripts_dir = claude_dir.join("scripts");
    fs::create_dir_all(&scripts_dir).map_err(|e| e.to_string())?;
    let settings_path = claude_dir.join("settings.json");

    // Always (re)write the event script so a missing or previously-broken one
    // self-heals on the next entry into IDE Mode.
    let script_path = scripts_dir.join("launcher-ide-event.ps1");
    fs::write(&script_path, IDE_EVENT_TEMPLATE)
        .map_err(|e| format!("Failed to write IDE event script: {}", e))?;

    let original = if settings_path.exists() {
        fs::read_to_string(&settings_path)
            .map_err(|e| format!("Failed to read settings.json: {}", e))?
    } else {
        String::new()
    };
    let mut root: serde_json::Value = if original.is_empty() {
        serde_json::json!({})
    } else {
        serde_json::from_str(&original).map_err(|e| format!("settings.json invalid: {}", e))?
    };

    let obj = root
        .as_object_mut()
        .ok_or_else(|| "settings.json root is not an object".to_string())?;
    let hooks = obj.entry("hooks").or_insert_with(|| serde_json::json!({}));
    let hooks_obj = hooks
        .as_object_mut()
        .ok_or_else(|| "settings.json 'hooks' is not an object".to_string())?;

    // upsert_hook strips any prior hook carrying the marker before adding ours,
    // so re-running heals the old broken inline command in place.
    upsert_hook(hooks_obj, "Stop", &ide_event_command(&script_path, "stop"), "cl-ide-event", 5);
    upsert_hook(
        hooks_obj,
        "Notification",
        &ide_event_command(&script_path, "notification"),
        "cl-ide-event",
        5,
    );

    let serialized =
        serde_json::to_string_pretty(&root).map_err(|e| e.to_string())?;
    // No change → no write (and no needless .bak churn on every IDE entry).
    if serialized == original {
        return Ok("IDE hooks already current".to_string());
    }
    if !original.is_empty() {
        let _ = fs::write(claude_dir.join("settings.json.bak"), &original);
    }
    fs::write(&settings_path, serialized).map_err(|e| e.to_string())?;
    Ok("IDE hooks installed".to_string())
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

    // Write the IDE event script too, so the IDE pings below point at a file
    // that exists even if the user never enters IDE Mode (mirrors ensure_ide_hooks).
    let scripts_dir = claude_dir.join("scripts");
    fs::create_dir_all(&scripts_dir)
        .map_err(|e| format!("Failed to create {}: {}", scripts_dir.display(), e))?;
    let ide_script_path = scripts_dir.join("launcher-ide-event.ps1");
    fs::write(&ide_script_path, IDE_EVENT_TEMPLATE)
        .map_err(|e| format!("Failed to write IDE event script: {}", e))?;

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

    // IDE Mode attention pings. Additive to the chime; see ide_event_command.
    upsert_hook(hooks_obj, "Stop", &ide_event_command(&ide_script_path, "stop"), "cl-ide-event", 5);
    upsert_hook(
        hooks_obj,
        "Notification",
        &ide_event_command(&ide_script_path, "notification"),
        "cl-ide-event",
        5,
    );

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

/// Probe well-known install locations for an agent CLI, falling back to the
/// bare command name so PATH resolution still gets a chance. `agent_id` is
/// supplied by the frontend registry; an unknown id falls back to "claude" so
/// an older backend paired with a newer frontend degrades rather than errors.
#[tauri::command]
async fn detect_agent_path(agent_id: Option<String>) -> Result<String, String> {
    let id = agent_id.as_deref().unwrap_or("claude");
    let (dir_name, exe_stem) = match id {
        "codex" => ("codex", "codex"),
        _ => ("claude", "claude"),
    };

    if let Some(home) = std::env::var_os("USERPROFILE") {
        let home_path = std::path::PathBuf::from(home);

        let candidates = vec![
            home_path.join(".local").join("bin").join(format!("{}.exe", exe_stem)),
            home_path.join(".local").join("bin").join(exe_stem),
            home_path
                .join("AppData")
                .join("Local")
                .join("Programs")
                .join(dir_name)
                .join(format!("{}.exe", exe_stem)),
        ];

        for candidate in candidates {
            if candidate.exists() {
                return Ok(candidate.to_string_lossy().to_string());
            }
        }
    }

    Ok(exe_stem.to_string())
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
        .plugin(tauri_plugin_clipboard_manager::init())
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
            app.manage(ide::PtySessions::default());
            let ide_port = ide::start_ide_listener(app.handle().clone());
            app.manage(ide::IdePort(std::sync::atomic::AtomicU16::new(ide_port)));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            launch_agent,
            launch_shell,
            detect_agent_path,
            install_chime_hooks,
            install_model_title_statusline,
            ensure_ide_hooks,
            list_terminal_profiles,
            get_log_path,
            read_log,
            open_log_folder,
            ide::spawn_pty,
            ide::write_pty,
            ide::resize_pty,
            ide::kill_pty,
            ide::read_dir_entries,
            ide::git_status,
            ide::git_diff,
            get_os_build,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The subcommand crosses the IPC boundary and is appended directly to an
    /// argv, so it must stay a closed, boring vocabulary. Anything that could
    /// start a flag, escape into a shell, or smuggle a path must be rejected.
    #[test]
    fn subcommand_validation() {
        assert!(is_safe_subcommand("remote-control"));
        assert!(is_safe_subcommand("exec"));
        assert!(is_safe_subcommand("a1-b2"));

        assert!(!is_safe_subcommand(""));
        assert!(!is_safe_subcommand("-flag"));
        assert!(!is_safe_subcommand("--flag"));
        assert!(!is_safe_subcommand("1leading-digit"));
        assert!(!is_safe_subcommand("Remote-Control")); // uppercase
        assert!(!is_safe_subcommand("rm -rf"));         // space
        assert!(!is_safe_subcommand("a;b"));            // shell metachar
        assert!(!is_safe_subcommand("a|b"));
        assert!(!is_safe_subcommand("a$b"));
        assert!(!is_safe_subcommand("../escape"));
        assert!(!is_safe_subcommand("C:\\evil.exe"));
        assert!(!is_safe_subcommand(&"a".repeat(33)));  // length cap
    }

    /// The write decision must fire only when the var is unset or empty, and must
    /// preserve any explicit value the user chose (including a deliberate "0"
    /// opt-out). Pure — never touches the real HKCU hive.
    #[test]
    fn full_repaint_write_decision() {
        assert!(full_repaint_needs_write(None)); // unset → write "1"
        assert!(full_repaint_needs_write(Some(""))); // empty → write "1"
        assert!(!full_repaint_needs_write(Some("1"))); // already on → skip
        assert!(!full_repaint_needs_write(Some("0"))); // deliberate opt-out → respect
    }
}
