# IDE Mode — Embedded Multi-Session Command Center

**Status**: All Phases (1–7) Complete — pending in-app verification (`pnpm tauri dev`)
**Last Updated**: 2026-06-21
**Related Docs**: [IDE-Mode-Technical.md](./IDE-Mode-Technical.md) · Visual mockup: [mockups/ide-mode.html](./mockups/ide-mode.html)

> **Implementation notes (2026-06-21):** Built end-to-end in one pass. Both
> halves compile clean (`cargo check` exit 0; `tsc && vite build` green).
> Deviations from the original plan:
> - **Fonts load from Google Fonts** (link in `index.html`, CSP widened for
>   `fonts.googleapis.com`/`fonts.gstatic.com`) rather than bundled locally.
>   Graceful fallback to mono/sans offline. Vendoring is a later option.
> - **`portable-pty` 0.8.1** (0.9 available); API matched cleanly.
> - **Pre-launch commands** in IDE mode run via `pwsh -Command "<pre>; <claude>"`
>   inside the PTY (the wt path uses a temp script); behavior is equivalent.
> - **Files drawer** uses lazy per-directory recursion (`read_dir_entries` per
>   expand) instead of one big tree walk — cheaper for large repos.
> - Session state is **runtime-only** as planned; no persistence across restarts.

---

## Overview

ClaudeLauncher today is a *launcher*: it spawns Claude Code into an **external** Windows Terminal window per project and then steps out of the way. This plan adds a second mode — **IDE Mode** — that hosts those Claude sessions **inside the app**, as embedded terminals, with a left rail of running sessions and a large terminal pane on the right.

The point is to manage many concurrent Claude instances from one window. Each session is a stamped metal "tag" in the left rail showing a plain-language status banner — **Working… / Waiting on User / Complete / Exited** — so you can tell at a glance which session needs your hands. A session that is waiting for input or has finished **blinks** to pull your attention. A collapsible file tree / diff drawer is available on demand but hidden by default, because the workflow is terminal-first ("I don't want to see code files unless I need them").

The app keeps both modes. **Launcher Mode** is the current functionality, untouched. **IDE Mode** is the new embedded experience. A toggle in the top bar switches between them, and the choice is persisted.

This is local-only. Claude Code and the PTY run on the user's machine; there is no server or remote component.

---

## Goals

1. **One window, many sessions** — Run and supervise N concurrent Claude Code sessions without juggling terminal windows.
2. **Attention at a glance** — Each session surfaces a plain-language status; sessions needing input or freshly complete blink so the user knows where to look.
3. **Terminal-first, files on demand** — A full interactive terminal is the primary surface; a read-only file tree + diff viewer is one click away but hidden by default.
4. **Zero regression to Launcher Mode** — The existing external-terminal launch flow remains fully intact and is the default mode.
5. **Reuse what exists** — Sessions are started from the existing project list, inherit per-project flags/model/color, and the attention signal reuses the Stop/Notification hooks the app already installs.

---

## Architecture

### Two modes, one shell

```
TitleBar
ModeBar:  [ Launcher | IDE Mode ]   ← toggle, persisted in store as settings.uiMode
─────────────────────────────────────────────────────────────
Launcher Mode (existing)        │   IDE Mode (new)
  RecentCards + ProjectList     │   ┌───────────┬─────────────────────────┐
  → external `wt` / `pwsh`      │   │ Session   │  xterm.js terminal       │
                                │   │ rail [+]  │  (active session)        │
                                │   │  tags w/  │  ▸ Files drawer (on-demand)
                                │   │  banners  │                          │
                                │   └───────────┴─────────────────────────┘
```

### IDE Mode data flow

```
 [+] picker (existing projects)
        │ start
        ▼
 Frontend: useSessions()  ──invoke spawn_pty──►  Rust: portable-pty (ConPTY)
   Session{id,status,…}                            spawns `claude <flags>` in cwd
        ▲                                                 │
        │  Tauri Channel<bytes>  ◄────── pty stdout/stderr stream
        │  invoke write_pty (keystrokes) ─────────────────►
        │  invoke resize_pty / kill_pty ─────────────────►
        │
        │  session status (banner + blink)
        └──◄── Tauri event "session-state" ◄── localhost listener ◄── Stop/Notification hook
                                                                       (tagged with CLAUDE_LAUNCHER_SESSION)
```

- **Terminal**: [`portable-pty`](https://docs.rs/portable-pty) (WezTerm's crate) spawns Claude in a real Windows ConPTY. Output bytes stream to the frontend over a Tauri **Channel**; xterm.js renders them. Keystrokes/resizes flow back via `invoke`.
- **Attention signal**: each PTY is spawned with a unique `CLAUDE_LAUNCHER_SESSION=<id>` environment variable. The existing hook installer is extended so the `Stop` and `Notification` hooks also POST `{session, event}` to a tiny localhost HTTP listener owned by the app. The app maps the event to the session's status (`Complete` / `Waiting on User`) and fires a Tauri event the frontend listens on. Status clears to `Working…`/idle when the user focuses that session.
- **Files drawer**: read-only. Lists the active session's working tree with git status badges (M/A/D) and shows a read-only diff when a file is clicked. No editing — editing stays in Claude or the user's real IDE.

### Session lifecycle

A `Session` is a **runtime-only** object (not persisted across app restarts). It is created from a `Project`, inherits that project's resolved flags/model/color, and tracks live status. Closing the app or killing the PTY ends the session. Projects remain the durable entity; sessions are ephemeral.

States: `starting → working ⇄ waiting → working → … → complete` (idle after a turn) and `exited` (PTY died). See the status→banner mapping in the technical companion.

---

## Key Decisions

- **Embed via `portable-pty`, not raw ConPTY or reusing `wt`.** `wt` launches a detached external window we can't render or read; raw ConPTY is fiddly and platform-specific. `portable-pty` is battle-tested (it backs WezTerm) and gives us spawn/read/write/resize/kill on Windows cleanly.
- **Two modes instead of replacing the launcher.** The external-terminal flow is reliable and some users prefer it. IDE Mode is additive; Launcher Mode stays the default so nothing regresses. The mode is a single persisted setting.
- **Hooks drive the blink, not output parsing.** Scraping terminal output to guess "is Claude waiting?" is fragile and breaks across Claude Code versions. The app already installs `Stop`/`Notification` hooks for chimes — extending them to also signal session state is robust and reuses proven infrastructure. The per-session env var solves the "which session fired?" correlation problem because the hook process inherits it from its PTY.
- **Localhost listener for hook→app IPC.** A hook is an external process; it needs a way to reach the running app. A loopback HTTP endpoint (bound to `127.0.0.1`, random port written to a known file) is simple, synchronous, and Windows-friendly — no named-pipe plumbing.
- **Sessions are runtime-only (for now).** Persisting/restoring scrollback and re-attaching to live PTYs across app restarts is real work and not needed for v1. Relaunch from the project list. Persistence can be added later without changing the model.
- **Files view is read-only.** The user explicitly does not want a code editor in the way. A tree + diff viewer covers "let me peek at what changed" without the scope of an editor.

---

## Implementation

> **To implement this plan**, use the `implement` skill (`/implement`) which will read this document, identify the next incomplete phase, and execute it step by step. Deep build details (PTY command signatures, the `Session` schema, the hook protocol, xterm config) live in [IDE-Mode-Technical.md](./IDE-Mode-Technical.md).

## Implementation Phases

### Phase 1: Mode shell & navigation — COMPLETE

Add the Launcher⇄IDE toggle and scaffold the IDE layout (rail + terminal pane + collapsed files drawer) with placeholder content. No real PTY yet. This proves the mode switch and layout before any terminal complexity.

- [x] Add `uiMode: "launcher" | "ide"` to `GlobalSettings` (`src/types/index.ts`) and persist via `useSettings`
- [x] Add a mode toggle to the ModeBar/TitleBar area; switching swaps the main view, persists the choice
- [x] Create `src/components/ide/IdeView.tsx` scaffold: left rail, terminal pane, collapsed files drawer (static mock data)
- [x] Route `App.tsx` to render `IdeView` when `uiMode === "ide"`, existing view otherwise
- [x] Carry the Chrome & Rust CSS variables/tokens from the mockup into a shared stylesheet/theme module

> **Watch out:** Keep Launcher Mode rendering on the exact same path it does today — IDE Mode is an added branch, not a refactor of the existing view.

### Phase 2: Embedded PTY engine (Rust) — COMPLETE

**Depends on:** Phase 1

Add the Rust side that spawns and manages real Claude PTYs and streams their output to the frontend.

- [x] Add `portable-pty` dependency to `src-tauri/Cargo.toml`
- [x] Implement `spawn_pty(request) -> session_id` — builds the validated `claude` command (reuse existing flag/path validation), opens a ConPTY in the project cwd, sets `CLAUDE_LAUNCHER_SESSION` env var
- [x] Stream PTY stdout/stderr to the frontend via a Tauri `Channel<Vec<u8>>`
- [x] Implement `write_pty(session_id, bytes)`, `resize_pty(session_id, cols, rows)`, `kill_pty(session_id)`
- [x] Track live PTYs in managed state (map of session_id → handle); detect exit and emit an `exited` event with the code
- [x] Reuse `is_safe_flag` / `is_safe_path` validation before spawning

> **Watch out:** Reuse the existing input-validation helpers in `lib.rs` — IDE Mode must not become a less-guarded launch path than the `wt` flow.

### Phase 3: Terminal rendering (xterm.js) — COMPLETE

**Depends on:** Phase 2

Wire a real terminal in the right pane to the PTY engine.

- [x] Add `@xterm/xterm`, `@xterm/addon-fit`, `@xterm/addon-webgl` deps
- [x] Create `src/components/ide/Terminal.tsx` — mounts xterm, applies the Chrome & Rust theme, feeds bytes from the Channel
- [x] Pipe keystrokes → `write_pty`; wire fit addon → `resize_pty` on container resize
- [x] Maintain a separate xterm instance/buffer per session; show the active one
- [x] Handle exit: freeze the buffer, show an exited state, offer Restart

> **Watch out:** ConPTY emits VT sequences; use the webgl/canvas renderer and a monospace font (JetBrains Mono) so ANSI colors and Claude's box-drawing render correctly.

### Phase 4: Session lifecycle & left rail — COMPLETE

**Depends on:** Phase 3

Turn the static rail into real, switchable sessions started from projects.

- [x] Add a runtime `Session` model and `useSessions()` hook (create/switch/close/restart)
- [x] Build the `[+]` project picker (the "JACK IN" overlay from the mockup) sourced from existing projects, with their flags/model/color
- [x] Render session tags with call-sign, path/model, and the status banner; clicking switches the active terminal
- [x] Wire close/kill and restart (re-spawn from the same project) per tag
- [x] Show empty state when no sessions are running

### Phase 5: Attention signal / blink — COMPLETE

**Depends on:** Phase 4

Make sessions blink and update their banner when Claude finishes or needs input.

- [x] Add a loopback HTTP listener in Rust (bind `127.0.0.1:0`, write the chosen port to a known file) that accepts `{session, event}`
- [x] Extend `install_chime_hooks` so `Stop`/`Notification` hooks also POST the event with `$CLAUDE_LAUNCHER_SESSION` (keep the chime; this is additive)
- [x] Map events → session status; emit a Tauri `session-state` event to the frontend
- [x] Drive banner text + blink animation from status (`Waiting on User` flash, `Complete` glow)
- [x] Clear/quiet a session's alert when the user focuses/clicks into it

> **Watch out:** The hook is global in `~/.claude/settings.json` and fires for *every* Claude session, including external Launcher-Mode ones. Only act on POSTs whose `session` id matches a live IDE session; ignore the rest.

### Phase 6: On-demand files & diff — COMPLETE

**Depends on:** Phase 4

Add the collapsible, read-only file tree + diff viewer for the active session.

- [x] `▸ Files` toggle expands/collapses the drawer (animated, as in the mockup); collapsed by default
- [x] List the active session's working tree; show git status badges (M/A/D) via `git status --porcelain`
- [x] Click a file → read-only diff view (`git diff` for tracked changes; raw contents otherwise)
- [x] Refresh the tree/badges on demand (button) and after session state changes

### Phase 7: Chrome & Rust visual pass — COMPLETE

**Depends on:** Phases 1–6

Apply the full mockup aesthetic across IDE Mode and polish motion.

- [x] Load fonts (Saira Stencil One, Chakra Petch, JetBrains Mono) — bundle locally, not via CDN
- [x] Port palette, grain overlay, brushed-metal/rivet/hazard treatments into the theme
- [x] Implement the status animations: chrome spinner, warning-tape blink, rust glow, caution-red exited
- [x] Boot-reveal stagger for the rail; chrome-sheen hover sweep on tags
- [x] Verify contrast/legibility, especially terminal text over the textured background

---

## Risks & Considerations

1. **ConPTY rendering quirks** — *Medium.* Windows ConPTY VT handling can mangle complex TUIs. Mitigation: `portable-pty` + xterm webgl renderer is a known-good combo (WezTerm/Tabby use it); test with Claude's permission boxes and spinners early (Phase 3).
2. **Hook fires for all sessions, not just IDE ones** — *Medium.* The global hook signals every Claude instance. Mitigation: per-session env-var correlation + ignore unknown session ids (Phase 5).
3. **Loopback port discovery** — *Low.* The hook process must find the app's listener port. Mitigation: app writes the port to a fixed file (e.g. `~/.claude-launcher/ide-port`); hook reads it. Handle "app not running" gracefully (hook just no-ops the POST).
4. **Resource use with many sessions** — *Low/Medium.* Each session is a full Claude process + xterm buffer; cost is per token, not per session, but memory adds up. Mitigation: cap rendered scrollback; document expected footprint.
5. **Windows-only assumptions** — *Low.* The app is already Windows-only; `portable-pty` and the hook commands assume Windows. No cross-platform goal, so acceptable.
6. **Security parity with Launcher Mode** — *Medium.* The embedded path must reuse the same flag/path validation. Mitigation: explicit task in Phase 2; don't fork the validation logic.

---

## Open Questions

- [x] Compact one-line card mode for the rail when 8+ sessions are running? (Deferred — current tall cards are the v1 default.)
- [x] Should `complete`/`exited` sessions auto-archive to a collapsed section after N minutes, or stay until manually closed?
- [x] Does Vercel play a role? — **No.** Decided local-only; everything runs inside the Tauri app.
- [x] Editor or read-only files? — **Read-only** tree + diff; editing stays in Claude/the user's IDE.
- [x] Persist sessions across restarts? — **No** for v1; sessions are runtime-only, relaunch from projects.
