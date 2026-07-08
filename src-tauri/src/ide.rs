//! IDE Mode backend: embedded Claude PTY sessions, the loopback attention
//! listener that turns hook pings into session-state events, and read-only
//! file-tree / diff helpers for the on-demand files drawer.

use std::collections::HashMap;
use std::io::{Read, Write};
use std::net::TcpListener;
use std::path::PathBuf;
use std::process::Command;
use std::sync::Mutex;
use std::thread;

use portable_pty::{native_pty_system, ChildKiller, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use tauri::{Emitter, Manager};

use crate::{
    build_claude_pwsh_cmd, is_safe_flag, is_safe_path, LaunchRequest, FULL_REPAINT_ENV,
};

/// Live PTYs keyed by session id.
pub struct PtySessions(pub Mutex<HashMap<String, PtyHandle>>);

impl Default for PtySessions {
    fn default() -> Self {
        PtySessions(Mutex::new(HashMap::new()))
    }
}

/// The port this app instance's attention listener is bound to (0 if it failed
/// to bind). Stamped onto every spawned session as `CLAUDE_LAUNCHER_PORT` so the
/// session's Stop/Notification hook reaches THIS instance directly, instead of
/// trusting the shared `ide-port` file — which any second instance (a dev build,
/// a double-launch) overwrites and none restores on exit, silently breaking
/// every other instance's status routing.
pub struct IdePort(pub std::sync::atomic::AtomicU16);

pub struct PtyHandle {
    writer: Box<dyn Write + Send>,
    master: Box<dyn MasterPty + Send>,
    killer: Box<dyn ChildKiller + Send + Sync>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ExitPayload {
    session_id: String,
    code: i32,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct StatePayload {
    session_id: String,
    status: String,
}

/// Spawn `claude` (optionally behind a pre-launch command) inside a real
/// Windows ConPTY. Output streams back over `on_output`; an exit emits
/// `pty-exit`. The session id is exported as `CLAUDE_LAUNCHER_SESSION` so the
/// global Stop/Notification hooks can correlate their pings to this session.
#[tauri::command]
pub fn spawn_pty(
    app: tauri::AppHandle,
    state: tauri::State<PtySessions>,
    session_id: String,
    request: LaunchRequest,
    cols: u16,
    rows: u16,
    on_output: tauri::ipc::Channel<Vec<u8>>,
) -> Result<(), String> {
    // Reuse the exact validation the wt launch path uses — IDE mode must not
    // be a weaker-guarded launch surface.
    if !is_safe_path(&request.claude_path) {
        return Err("Claude path contains invalid characters".into());
    }
    if !is_safe_path(&request.project_path) {
        return Err("Project path contains invalid characters".into());
    }
    for flag in &request.flags {
        if !is_safe_flag(flag) {
            return Err(format!("Invalid flag rejected: {}", flag));
        }
    }
    if !std::path::Path::new(&request.project_path).exists() {
        return Err(format!("Project directory does not exist: {}", request.project_path));
    }

    // Spawn Claude directly (CommandBuilder seeds the full parent env via
    // get_base_env, so PATH/APPDATA/etc are inherited). A pre-launch command
    // still needs a shell, so route that case through pwsh.
    let has_pre_launch = request
        .pre_launch_command
        .as_ref()
        .is_some_and(|c| !c.is_empty());

    let mut cmd = if has_pre_launch {
        let claude_cmd = build_claude_pwsh_cmd(&request);
        let pre = request.pre_launch_command.clone().unwrap_or_default();
        let mut c = CommandBuilder::new("pwsh");
        c.arg("-NoLogo");
        c.arg("-Command");
        c.arg(format!("{}; {}", pre, claude_cmd));
        c
    } else {
        let mut c = CommandBuilder::new(&request.claude_path);
        if request.remote_control {
            c.arg("remote-control");
        }
        for flag in &request.flags {
            c.arg(flag);
        }
        c
    };

    cmd.cwd(&request.project_path);
    cmd.env("CLAUDE_LAUNCHER_SESSION", &session_id);
    // Stamp THIS instance's listener port so the session's Stop/Notification
    // hook POSTs status straight back to us, regardless of what the shared
    // ide-port file currently holds (another instance may have overwritten it).
    if let Some(p) = app.try_state::<IdePort>() {
        let port = p.0.load(std::sync::atomic::Ordering::Relaxed);
        if port != 0 {
            cmd.env("CLAUDE_LAUNCHER_PORT", port.to_string());
        }
    }
    // Match the wt path: prevent Claude's nested-session detection.
    cmd.env_remove("CLAUDECODE");
    // Renderer choice (IDE mode only). The embedded xterm.js terminal can run
    // Claude's fullscreen alt-screen TUI; "classic" forces the scrollback
    // renderer for users who prefer it. Default (unset) is fullscreen. We pin
    // whichever is chosen so an inherited env var can't flip it the other way.
    if request.ide_renderer.as_deref() == Some("classic") {
        cmd.env("CLAUDE_CODE_DISABLE_ALTERNATE_SCREEN", "1");
        cmd.env_remove("CLAUDE_CODE_NO_FLICKER");
    } else {
        cmd.env("CLAUDE_CODE_NO_FLICKER", "1");
        cmd.env_remove("CLAUDE_CODE_DISABLE_ALTERNATE_SCREEN");
    }
    // Do NOT let ALT_SCREEN_FULL_REPAINT reach embedded sessions. The launcher
    // persists it machine-wide (HKCU) to fix Windows Terminal's stale-glyph bug
    // (anthropics/claude-code#69619), and this app's process env inherits it —
    // but that bug is WT's, not xterm's. In here it forces Claude to redraw the
    // whole screen every frame, multiplying xterm's rendering load (and, under
    // the WebGL renderer, the glyph-atlas churn behind the corruption the
    // repaint controls were added for). xterm's stale-glyph issues are addressed
    // at the renderer level instead (DOM renderer default + sideloaded ConPTY).
    cmd.env_remove(FULL_REPAINT_ENV);

    let pair = native_pty_system()
        .openpty(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("openpty failed: {}", e))?;

    let mut child = pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| format!("spawn failed: {}", e))?;
    // The parent does not need the slave handle once the child holds it.
    drop(pair.slave);

    let mut reader = pair
        .master
        .try_clone_reader()
        .map_err(|e| format!("clone reader failed: {}", e))?;
    let writer = pair
        .master
        .take_writer()
        .map_err(|e| format!("take writer failed: {}", e))?;
    let killer = child.clone_killer();

    // Reader thread: stream PTY output to the frontend.
    {
        let channel = on_output.clone();
        thread::spawn(move || {
            let mut buf = [0u8; 4096];
            loop {
                match reader.read(&mut buf) {
                    Ok(0) | Err(_) => break,
                    Ok(n) => {
                        if channel.send(buf[..n].to_vec()).is_err() {
                            break;
                        }
                    }
                }
            }
        });
    }

    // Wait thread: detect exit, clean up, notify the frontend.
    {
        let app = app.clone();
        let sid = session_id.clone();
        thread::spawn(move || {
            let code = child
                .wait()
                .map(|s| s.exit_code() as i32)
                .unwrap_or(-1);
            if let Some(state) = app.try_state::<PtySessions>() {
                state.0.lock().unwrap().remove(&sid);
            }
            let _ = app.emit("pty-exit", ExitPayload { session_id: sid, code });
        });
    }

    state.0.lock().unwrap().insert(
        session_id,
        PtyHandle {
            writer,
            master: pair.master,
            killer,
        },
    );
    Ok(())
}

#[tauri::command]
pub fn write_pty(
    state: tauri::State<PtySessions>,
    session_id: String,
    data: String,
) -> Result<(), String> {
    let mut map = state.0.lock().unwrap();
    let handle = map
        .get_mut(&session_id)
        .ok_or_else(|| "No such session".to_string())?;
    handle
        .writer
        .write_all(data.as_bytes())
        .map_err(|e| e.to_string())?;
    handle.writer.flush().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn resize_pty(
    state: tauri::State<PtySessions>,
    session_id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    let map = state.0.lock().unwrap();
    let handle = map
        .get(&session_id)
        .ok_or_else(|| "No such session".to_string())?;
    handle
        .master
        .resize(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn kill_pty(state: tauri::State<PtySessions>, session_id: String) -> Result<(), String> {
    if let Some(mut handle) = state.0.lock().unwrap().remove(&session_id) {
        let _ = handle.killer.kill();
    }
    Ok(())
}

/// Path of the file the app writes its loopback port to, so the hook command
/// (which has no other channel to the app) can find it.
fn ide_port_file() -> Option<PathBuf> {
    std::env::var_os("USERPROFILE")
        .map(|h| PathBuf::from(h).join(".claude-launcher").join("ide-port"))
}

/// Start the loopback attention listener. Binds 127.0.0.1:<random>, writes the
/// port to a well-known file, and turns `{session,event}` POSTs from the
/// Stop/Notification hooks into `session-state` events. Pings for sessions we
/// don't own (e.g. external Launcher-Mode sessions firing the same global hook)
/// are ignored.
pub fn start_ide_listener(app: tauri::AppHandle) -> u16 {
    // Bind synchronously so the caller can stamp the real port onto sessions
    // before any are spawned. Returns 0 if binding failed (status routing then
    // falls back to the shared port file, written below).
    let listener = match TcpListener::bind("127.0.0.1:0") {
        Ok(l) => l,
        Err(_) => return 0,
    };
    let port = listener.local_addr().map(|a| a.port()).unwrap_or(0);
    if port != 0 {
        if let Some(file) = ide_port_file() {
            if let Some(parent) = file.parent() {
                let _ = std::fs::create_dir_all(parent);
            }
            let _ = std::fs::write(&file, port.to_string());
        }
    }

    thread::spawn(move || {
        for stream in listener.incoming() {
            let mut stream = match stream {
                Ok(s) => s,
                Err(_) => continue,
            };
            // Never let a stalled client wedge this single-threaded loop.
            let _ = stream.set_read_timeout(Some(std::time::Duration::from_millis(1500)));

            // Minimal HTTP read. We must consume the full request body, which
            // means handling the `Expect: 100-continue` handshake that Windows
            // PowerShell's Invoke-RestMethod uses: it sends only the headers and
            // waits for a "100 Continue" before sending the body. If we answered
            // with a final 200 first (as a naive single-read server does), the
            // body would never arrive, the session id would be empty, and the
            // session would stay stuck on "Working".
            let mut data: Vec<u8> = Vec::with_capacity(2048);
            let mut tmp = [0u8; 2048];
            let mut header_end: Option<usize> = None;
            while header_end.is_none() && data.len() < 64 * 1024 {
                match stream.read(&mut tmp) {
                    Ok(0) | Err(_) => break,
                    Ok(n) => {
                        data.extend_from_slice(&tmp[..n]);
                        header_end = data.windows(4).position(|w| w == b"\r\n\r\n");
                    }
                }
            }
            let hdr_end = match header_end {
                Some(e) => e,
                None => {
                    let _ = stream.write_all(b"HTTP/1.1 400 Bad Request\r\nContent-Length: 0\r\n\r\n");
                    continue;
                }
            };
            let headers_lc = String::from_utf8_lossy(&data[..hdr_end]).to_ascii_lowercase();

            if headers_lc.contains("expect:") && headers_lc.contains("100-continue") {
                let _ = stream.write_all(b"HTTP/1.1 100 Continue\r\n\r\n");
                let _ = stream.flush();
            }

            let content_len = headers_lc
                .lines()
                .find_map(|l| l.strip_prefix("content-length:"))
                .and_then(|v| v.trim().parse::<usize>().ok())
                .unwrap_or(0);
            let body_start = hdr_end + 4;
            while data.len() < body_start + content_len {
                match stream.read(&mut tmp) {
                    Ok(0) | Err(_) => break,
                    Ok(n) => data.extend_from_slice(&tmp[..n]),
                }
            }

            // Always answer so the hook's HTTP client doesn't hang.
            let _ = stream.write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 0\r\n\r\n");
            let _ = stream.flush();

            let body = if data.len() > body_start {
                String::from_utf8_lossy(&data[body_start..]).to_string()
            } else {
                String::new()
            };
            if let Ok(v) = serde_json::from_str::<serde_json::Value>(body.trim()) {
                let session = v.get("session").and_then(|s| s.as_str()).unwrap_or("");
                let event = v.get("event").and_then(|s| s.as_str()).unwrap_or("");
                if session.is_empty() {
                    continue;
                }
                // Only act on sessions we own.
                let owned = app
                    .try_state::<PtySessions>()
                    .map(|st| st.0.lock().unwrap().contains_key(session))
                    .unwrap_or(false);
                if !owned {
                    continue;
                }
                let status = match event {
                    "stop" => "complete",
                    "notification" => "waiting",
                    _ => continue,
                };
                let _ = app.emit(
                    "session-state",
                    StatePayload {
                        session_id: session.to_string(),
                        status: status.to_string(),
                    },
                );
            }
        }
    });

    port
}

// ---------------------------------------------------------------------------
// Read-only files drawer
// ---------------------------------------------------------------------------

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DirEntryInfo {
    name: String,
    is_dir: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitStatusEntry {
    path: String,
    status: String,
}

#[cfg(windows)]
fn no_window(cmd: &mut Command) {
    use std::os::windows::process::CommandExt;
    cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
}
#[cfg(not(windows))]
fn no_window(_cmd: &mut Command) {}

/// List the immediate children of a directory (dirs first, then files).
#[tauri::command]
pub fn read_dir_entries(path: String) -> Result<Vec<DirEntryInfo>, String> {
    if !is_safe_path(&path) {
        return Err("Invalid path".into());
    }
    let p = std::path::Path::new(&path);
    if !p.is_dir() {
        return Err("Not a directory".into());
    }
    let mut entries: Vec<DirEntryInfo> = Vec::new();
    for entry in std::fs::read_dir(p).map_err(|e| e.to_string())?.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        if name == ".git" || name == "node_modules" || name == "target" {
            continue;
        }
        let is_dir = entry.file_type().map(|t| t.is_dir()).unwrap_or(false);
        entries.push(DirEntryInfo { name, is_dir });
    }
    entries.sort_by(|a, b| match (a.is_dir, b.is_dir) {
        (true, false) => std::cmp::Ordering::Less,
        (false, true) => std::cmp::Ordering::Greater,
        _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
    });
    Ok(entries)
}

/// `git status --porcelain` for the working tree, mapped to M/A/D badges.
#[tauri::command]
pub fn git_status(cwd: String) -> Result<Vec<GitStatusEntry>, String> {
    if !is_safe_path(&cwd) {
        return Err("Invalid path".into());
    }
    let mut cmd = Command::new("git");
    cmd.args(["-C", &cwd, "status", "--porcelain"]);
    no_window(&mut cmd);
    let out = cmd.output().map_err(|e| e.to_string())?;
    if !out.status.success() {
        return Ok(Vec::new()); // not a git repo — no badges
    }
    let text = String::from_utf8_lossy(&out.stdout);
    let mut entries = Vec::new();
    for line in text.lines() {
        if line.len() < 4 {
            continue;
        }
        let code = &line[..2];
        let path = line[3..].trim().to_string();
        let status = if code.contains('?') || code.contains('A') {
            "A"
        } else if code.contains('D') {
            "D"
        } else if code.contains('M') || code.contains('R') {
            "M"
        } else {
            "M"
        };
        entries.push(GitStatusEntry {
            path,
            status: status.to_string(),
        });
    }
    Ok(entries)
}

/// Read-only diff for a single file. Falls back to staged diff, then to raw
/// contents for untracked files.
#[tauri::command]
pub fn git_diff(cwd: String, file: String) -> Result<String, String> {
    if !is_safe_path(&cwd) || !is_safe_path(&file) {
        return Err("Invalid path".into());
    }
    let run = |args: &[&str]| -> Option<String> {
        let mut cmd = Command::new("git");
        cmd.args(args);
        no_window(&mut cmd);
        let out = cmd.output().ok()?;
        let s = String::from_utf8_lossy(&out.stdout).to_string();
        if s.trim().is_empty() {
            None
        } else {
            Some(s)
        }
    };

    if let Some(d) = run(&["-C", &cwd, "diff", "--", &file]) {
        return Ok(d);
    }
    if let Some(d) = run(&["-C", &cwd, "diff", "--cached", "--", &file]) {
        return Ok(d);
    }
    // Untracked / new file: show raw contents.
    let full = std::path::Path::new(&cwd).join(&file);
    match std::fs::read_to_string(&full) {
        Ok(c) => Ok(format!("(untracked file)\n\n{}", c)),
        Err(_) => Ok("(no diff available)".to_string()),
    }
}
