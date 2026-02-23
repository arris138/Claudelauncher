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
}

#[derive(Debug, Serialize, Deserialize)]
pub struct LaunchResult {
    pub success: bool,
    pub command: String,
    pub error: Option<String>,
}

// Managed state for log file path
pub struct LogPath(pub Mutex<PathBuf>);

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

#[tauri::command]
async fn launch_claude(
    app: tauri::AppHandle,
    request: LaunchRequest,
) -> Result<LaunchResult, String> {
    let log_path = app.state::<LogPath>().0.lock().unwrap().clone();
    write_log(&log_path, "INFO", &format!("Launch requested for: {}", request.project_path));

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

    // Build wt arguments:
    // wt new-tab --profile "PowerShell" -d "D:\project\path" -- claude --flags
    let mut args: Vec<String> = vec![
        "new-tab".to_string(),
        "--profile".to_string(),
        request.terminal_profile.clone(),
        "-d".to_string(),
        request.project_path.clone(),
        "--".to_string(),
        request.claude_path.clone(),
    ];

    for flag in &request.flags {
        args.push(flag.clone());
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
            std::thread::sleep(std::time::Duration::from_millis(500));
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
    // Build the claude command with flags
    let mut claude_cmd = request.claude_path.clone();
    for flag in &request.flags {
        claude_cmd.push(' ');
        claude_cmd.push_str(flag);
    }

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
async fn set_log_path(app: tauri::AppHandle, path: String) -> Result<(), String> {
    let state = app.state::<LogPath>();
    let new_path = PathBuf::from(&path);
    {
        let current = state.0.lock().unwrap();
        write_log(&current, "INFO", &format!("Log path changed to: {}", path));
    }
    let mut log_path = state.0.lock().unwrap();
    *log_path = new_path;
    Ok(())
}

#[tauri::command]
async fn read_log(app: tauri::AppHandle, tail_lines: Option<usize>) -> Result<String, String> {
    let log_path = app.state::<LogPath>().0.lock().unwrap().clone();
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
            app.manage(LogPath(Mutex::new(log_path)));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            launch_claude,
            detect_claude_path,
            get_log_path,
            set_log_path,
            read_log,
            open_log_folder,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
