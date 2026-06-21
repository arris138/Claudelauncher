# IDE Mode — Technical Companion

**Parent doc**: [IDE-Mode.md](./IDE-Mode.md)
**Last Updated**: 2026-06-21

Deep build details for IDE Mode: the `Session` runtime model, the Rust PTY command surface, the hook→app attention protocol, and xterm.js configuration. The parent doc holds the architecture and phase plan; this is the reference you open while writing the code.

---

## 1. Session runtime model

Sessions are **runtime-only** (not persisted). They derive from a durable `Project` (`src/types/index.ts`).

```ts
// src/types/index.ts (additions)

export type SessionStatus =
  | "starting"   // PTY spawning
  | "working"    // Claude actively running a turn (default while alive)
  | "waiting"    // Notification hook fired — needs user input  → banner "Waiting on User"
  | "complete"   // Stop hook fired, idle                       → banner "Complete"
  | "exited";    // PTY died                                     → banner "Exited · code N"

export interface Session {
  id: string;                 // uuid; also passed as CLAUDE_LAUNCHER_SESSION
  projectId: string;          // source Project.id
  title: string;              // call-sign shown in the rail (defaults to project name)
  cwd: string;                // resolved project path
  model?: string;             // resolved model id
  color?: string;             // inherited project color (rail swatch / accent)
  flags: string[];            // resolved flags (resolveFlags output)
  status: SessionStatus;
  exitCode?: number | null;
  startedAt: string;
  lastActivityAt: string;     // drives the "idle 3m" timer
  unseen: boolean;            // true while blinking; cleared on focus
}
```

Add `uiMode` to global settings:

```ts
export interface GlobalSettings {
  // …existing…
  uiMode: "launcher" | "ide";   // default "launcher"
}
```

### Status → banner mapping (matches the mockup)

| status     | banner label        | banner style class | blink |
|------------|---------------------|--------------------|-------|
| starting   | `Starting…`         | `.bar.run`         | no    |
| working    | `Working…`          | `.bar.run`         | no (spinner) |
| waiting    | `⚠ Waiting on User` | `.bar.need`        | **yes** (warning-tape) |
| complete   | `✓ Complete`        | `.bar.done`        | glow until seen |
| exited     | `✕ Exited · code N` | `.bar.dead`        | no    |

`unseen` controls the blink; focusing the session sets `unseen = false` and, if `complete`/`waiting`, leaves the banner but stops the flash.

---

## 2. Rust PTY command surface

Crate: [`portable-pty`](https://docs.rs/portable-pty) (add to `src-tauri/Cargo.toml`). Live PTYs are held in Tauri-managed state.

```rust
// Managed state
pub struct PtySessions(pub Mutex<HashMap<String, PtyHandle>>);

struct PtyHandle {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    child:  Box<dyn Child + Send + Sync>,
}
```

### Commands

```rust
#[tauri::command]
async fn spawn_pty(
    app: tauri::AppHandle,
    session_id: String,
    request: LaunchRequest,       // reuse existing struct + validation
    cols: u16, rows: u16,
    on_output: tauri::ipc::Channel<Vec<u8>>,
) -> Result<(), String>;

#[tauri::command]
async fn write_pty(session_id: String, data: String) -> Result<(), String>;

#[tauri::command]
async fn resize_pty(session_id: String, cols: u16, rows: u16) -> Result<(), String>;

#[tauri::command]
async fn kill_pty(session_id: String) -> Result<(), String>;
```

### spawn_pty outline

1. **Validate** with the existing helpers (`is_safe_flag`, `is_safe_path`, claude/project existence). Do **not** fork this logic — IDE Mode must not be a weaker launch path than `wt`.
2. Build a `CommandBuilder`:
   ```rust
   let mut cmd = CommandBuilder::new(&request.claude_path);
   for f in &request.flags { cmd.arg(f); }
   cmd.cwd(&request.project_path);
   cmd.env("CLAUDE_LAUNCHER_SESSION", &session_id);
   cmd.env_remove("CLAUDECODE");           // same as existing flow — prevent nested detection
   ```
3. Open the PTY at the given size and spawn:
   ```rust
   let pair = native_pty_system().openpty(PtySize { rows, cols, ..Default::default() })?;
   let child = pair.slave.spawn_command(cmd)?;
   ```
4. Spawn a reader thread: read `master` in chunks → `on_output.send(bytes)`. On EOF/exit, look up the child's exit code and emit a Tauri event `pty-exit { session_id, code }`.
5. Store the handle in `PtySessions`.

`write_pty` writes UTF-8 bytes to the stored writer. `resize_pty` calls `master.resize(...)`. `kill_pty` kills the child and removes the handle.

Register all four in `invoke_handler!` and add `app.manage(PtySessions(...))` in `run()`.

---

## 3. Attention protocol (hook → app → blink)

### Why a loopback listener

Hooks are external processes spawned by Claude Code. They inherit `CLAUDE_LAUNCHER_SESSION` from the PTY's environment, so each hook knows which session it belongs to — but it needs a channel back to the running app. A loopback HTTP endpoint is the simplest Windows-friendly IPC.

### Listener (Rust)

- On app start (or first IDE-Mode entry), bind `TcpListener` on `127.0.0.1:0` (OS-assigned port).
- Write the chosen port to a known file: `%USERPROFILE%\.claude-launcher\ide-port`.
- Accept `POST /event` with body `{ "session": "<id>", "event": "stop" | "notification" }`.
- Map: `stop → complete`, `notification → waiting`. Ignore any `session` not in `PtySessions` (filters out external Launcher-Mode sessions, which fire the same global hook).
- Emit Tauri event `session-state { session_id, status }`.

### Hook installation (extend existing `install_chime_hooks`)

The hooks stay (chime is kept); the command gains a fire-and-forget POST. Build the command so it reads the port file and includes the env var. Example `Stop` hook command (PowerShell, one line):

```powershell
$p = Get-Content "$env:USERPROFILE\.claude-launcher\ide-port" -ErrorAction SilentlyContinue;
if ($p -and $env:CLAUDE_LAUNCHER_SESSION) {
  try { Invoke-RestMethod -Uri "http://127.0.0.1:$p/event" -Method Post -TimeoutSec 1 `
        -Body (@{ session=$env:CLAUDE_LAUNCHER_SESSION; event="stop" } | ConvertTo-Json) `
        -ContentType "application/json" } catch {}
}
```

- `Notification` hook is identical with `event="notification"`.
- Wrap in `try/catch` and a short timeout so a not-running app never blocks Claude.
- Keep the existing `upsert_hook` dedupe-by-marker approach; use a distinct marker (e.g. `claude-launcher-ide-event`) so chime and event entries coexist and re-install updates paths cleanly.

### Frontend

`useSessions()` listens for `session-state` and `pty-exit`, updates the `Session`, sets `unseen = true` on `waiting`/`complete`. Focusing a session clears `unseen` and quiets the flash.

---

## 4. xterm.js configuration

Deps: `@xterm/xterm`, `@xterm/addon-fit`, `@xterm/addon-webgl`.

```ts
const term = new Terminal({
  fontFamily: '"JetBrains Mono", monospace',
  fontSize: 12.5,
  lineHeight: 1.45,
  cursorBlink: true,
  scrollback: 5000,                 // cap for memory; see risk #4
  theme: {
    background:    "#0a0b0d",
    foreground:    "#d6dadf",
    cursor:        "#e2742f",       // rust
    selectionBackground: "#2a2e34",
    black: "#0e0f11", red: "#b3361f", green: "#6fae5e", yellow: "#e8c33b",
    blue:  "#5a93c4", magenta: "#9a6cc4", cyan: "#3fb0a0", white: "#aeb6bf",
    brightRed: "#e2742f", brightYellow: "#e8c33b", brightWhite: "#e6ebef",
  },
});
term.loadAddon(new FitAddon());
term.loadAddon(new WebglAddon());   // canvas fallback if webgl unavailable
```

Wiring:
- `on_output` Channel → `term.write(bytes)`.
- `term.onData(data => invoke("write_pty", { sessionId, data }))`.
- `ResizeObserver` → `fit.fit()` → `invoke("resize_pty", { sessionId, cols: term.cols, rows: term.rows })`.
- One `Terminal` instance per session; mount only the active one (keep others' instances in a ref map, or serialize buffers — instance-per-session is simpler for v1).

---

## 5. Files drawer (read-only)

- Tree: enumerate the session `cwd`. Overlay git status from `git status --porcelain` → badges `M`/`A`/`D` (see mockup `.badge.m` / `.badge.a`).
- Diff: on file click, `git diff -- <path>` for tracked changes (render read-only); for untracked/new files show raw contents.
- Collapsed by default; `▸ Files` toggles the `.term-split.files-open` grid (`1fr 320px`) as in the mockup. No write paths.

---

## 6. Component & file map

```
src/
  components/ide/
    IdeView.tsx        # layout shell (rail + stage + drawer)
    SessionRail.tsx    # left rail, [+] button, tags + banners
    SessionTag.tsx     # one card: call-sign, meta, status banner
    Terminal.tsx       # xterm mount + PTY wiring
    FilesDrawer.tsx    # read-only tree + diff
    JackInPicker.tsx   # "+" project picker overlay
  hooks/
    useSessions.ts     # runtime session state, spawn/kill/restart, event listeners
  theme/
    chromeRust.css     # ported palette/tokens/animations from the mockup
src-tauri/src/
  lib.rs               # + spawn_pty/write_pty/resize_pty/kill_pty, loopback listener,
                       #   extended install_chime_hooks, PtySessions state
```

Visual source of truth: [mockups/ide-mode.html](./mockups/ide-mode.html).
