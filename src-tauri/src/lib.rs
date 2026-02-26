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
        "--".to_string(),
    ];

    if has_pre_launch {
        let claude_cmd = build_claude_pwsh_cmd(&request);
        let pre_cmd = request.pre_launch_command.as_ref().unwrap();
        let full_pwsh_cmd = format!("{}; {}", pre_cmd, claude_cmd);
        args.push("pwsh".to_string());
        args.push("-NoExit".to_string());
        args.push("-Command".to_string());
        args.push(full_pwsh_cmd);
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
            get_log_path,
            read_log,
            open_log_folder,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
