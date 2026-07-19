# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

A Windows-only Tauri v2 desktop app for launching Claude Code CLI sessions in different project directories with configurable flags. Launches via Windows Terminal (`wt`) with automatic PowerShell (`pwsh`) fallback.

## Commands

```bash
pnpm install          # Install dependencies
pnpm tauri dev        # Run in development (starts Vite + Tauri)
pnpm tauri build      # Production build (exe + NSIS + MSI installers)
```

There are no test or lint scripts configured. TypeScript checking runs as part of `pnpm build` (`tsc && vite build`).

## Tech Stack

- **Backend**: Rust (Tauri v2) — `src-tauri/src/lib.rs`
- **Frontend**: React 19 + TypeScript 5.6 + Vite 6
- **Styling**: Tailwind CSS v4 (via `@tailwindcss/vite` plugin)
- **Icons**: Lucide React
- **Persistence**: `tauri-plugin-store` → `claude-launcher-data.json`
- **Package manager**: pnpm

## Architecture

### Frontend → Backend Communication

All Rust commands are invoked from the frontend via `invoke()` from `@tauri-apps/api/core`. The Tauri commands are:

| Command | Purpose |
|---------|---------|
| `launch_claude` | Spawn Claude CLI in a terminal for a project directory |
| `detect_claude_path` | Auto-detect Claude CLI executable location |
| `list_terminal_profiles` | Read Windows Terminal profiles for the profile picker |
| `get_log_path` / `read_log` / `open_log_folder` | Log management |

### Data Flow

- `src/services/store.ts` — Singleton wrapper around `tauri-plugin-store`. Stores `projects` and `settings` as top-level keys in `claude-launcher-data.json`.
- `src/hooks/useProjects.ts` — Project CRUD, sorting, recent tracking (top 5 by `lastLaunchedAt`).
- `src/hooks/useSettings.ts` — Global settings; auto-detects Claude path on first load if set to default `"claude"`.

### Flag Resolution System

Flags flow through a three-tier system (`src/utils/flags.ts`):
1. **Built-in flags** — `--dangerously-skip-permissions`, `--verbose` (defined in `flags.ts`)
2. **Custom flags** — User-added flags stored in global settings
3. **Per-project overrides** — Each project can override any flag to On/Off/Global (`FlagOverrides` = `Record<string, boolean | undefined>`)

`resolveFlags()` merges global state with per-project overrides to produce the final `string[]` of flags passed to the Rust backend.

### Per-Project Launch Options

Beyond flags, each project carries optional launch settings (`src/types/index.ts`):
- **`tabTitle`** — terminal tab/window title; defaults to the project name. Passed to `wt` as `--title` + `--suppressApplicationTitle` so Claude Code's own title updates don't overwrite it.
- **`dynamicTitle`** — when true, `--suppressApplicationTitle` is omitted so Claude Code's dynamic status titles take over after launch.
- **`modelInTitle`** — when true, the launcher also omits `--suppressApplicationTitle` (so the OSC title can be set) and records the project name in `~/.claude/launcher-tab-names.json`. See **Live Model in Tab Title** below.
- **`model`** — passed as `--model=<id>`; defaults to `DEFAULT_MODEL` (`claude-opus-4-8`) in `src/utils/models.ts`. An empty string means "no `--model` flag" (CLI default).
- **`color`** — hex tab color, passed as `--tabColor`.

### Live Model in Tab Title

Keeps a tab titled `"<name> — <model>"` and updates it live when the user swaps models mid-session (`/model`). The launcher can't observe a running session, so the update happens inside it via a Claude Code **statusLine** script (hooks only receive the model at `SessionStart`, statusLine receives `model.display_name`/`model.id` on every render).

- **Installer** — `install_model_title_statusline` (Rust command, mirrors `install_chime_hooks`): writes `~/.claude/scripts/launcher-statusline.ps1` and points `settings.json` → `statusLine` at it. Idempotent, backs up `settings.json`, and preserves any pre-existing statusLine by chaining it (remembered in `launcher-statusline-inner.txt` so re-installs don't drop it). UI: Settings → "Install model-in-title statusline".
- **statusLine script** — reads stdin JSON for `model.display_name` + cwd, looks the custom name up in `launcher-tab-names.json` (keyed by normalized path; falls back to the folder name), prints the visible status text, then emits `ESC]0;<name> — <model>BEL`.
- **Critical interaction** — `--suppressApplicationTitle` makes Windows Terminal ignore *all* application title changes, including the OSC. So `modelInTitle` (like `dynamicTitle`) must leave the title un-suppressed for it to work.
- **Why a path→name map, not an env var** — `wt.exe` env vars don't reliably reach a new tab when an existing WT window services the request, so the name is passed via the map file (written by `upsert_tab_name` on launch) and looked up by cwd instead.

### Multi-Agent Support (Claude Code + Codex)

Each project declares which agent CLI it runs via `Project.agentId` (optional; absent
reads as `"claude"`, so pre-multi-agent projects need no migration). See
[docs/Multi-Agent.md](docs/Multi-Agent.md) for the full design.

- **`src/agents/`** is the single source of truth for everything that differs between
  agents: flag catalog, model list, subcommand, clear command, and a `capabilities` set.
  The UI asks a definition what to render; the services ask it how to build args. **Rust
  never branches on which agent it is** — it receives a resolved `agent_path`,
  `subcommand` and `flags[]`. Adding an agent should be one TS file plus a capability
  audit, not a Rust change.
- **`capabilities` gates Claude-only features** (model-in-title statusline, chimes via
  `~/.claude` hooks, `CLAUDE_CODE_*` renderer vars, model sniffing). Anything false
  **hides its UI** rather than no-oping — a button that does nothing is worse than none.
  `LaunchRequest.claude_features` carries this to Rust as one boolean.
- **Codex's surface is perishable.** It self-updates; during development this machine
  went 0.101.0 → 0.144.6 in an afternoon and `--full-auto` was removed, which would have
  broken any launch that used it. `codex --help` is the only authority — not docs, which
  were wrong about `--yolo` (doesn't exist) and `--ask-for-approval`'s value list. The
  model field is deliberately **free text with suggestions**, since
  `~/.codex/models_cache.json` is server-refreshed and changed shape within hours.
- **Codex status uses its `notify` callback, not OSC 9.** The binary has one untyped OSC 9
  emitter and no `approval-requested` string at all, so OSC 9 can't distinguish states.
  The callback is injected **per-launch** via `--config=notify=[...]`, so
  `~/.codex/config.toml` is never modified. Consequence: Codex sessions reach `complete`
  but **never `waiting`** — no approval-time event exists. Off by default
  (`agentNotifyHook`) and unverified against a live turn.

### Launch Strategy (Rust)

`launch_claude` in `lib.rs` tries Windows Terminal first (`wt new-tab --profile ... -d ... -- claude ...`), waits 500ms to check for immediate failure, then falls back to `pwsh -NoExit -WorkingDirectory ... -Command ...`. The `CLAUDECODE` env var is removed to prevent nested detection.

### Fullscreen-Repaint Fix

Claude Code's fullscreen TUI renderer intermittently leaves stale glyphs from the previous frame on Windows Terminal (anthropics/claude-code#69619); `CLAUDE_CODE_ALT_SCREEN_FULL_REPAINT=1` fixes it by forcing whole-screen repaints. The launcher installs this at the *Claude Code* level rather than per launch path: `ensure_full_repaint_env` (called best-effort on every `launch_claude`) persists it as a **user-level Windows environment variable** (`HKCU\Environment → CLAUDE_CODE_ALT_SCREEN_FULL_REPAINT=1`) so every future terminal — and thus every Claude session, including ones not launched by this app — inherits it in its real process env before claude starts. It reads HKCU directly (a cheap, spawn-free `winreg` read) and only writes when the var is unset/empty, so it's a no-op after the first launch and respects an existing value (a user can pin `"0"` to opt out). The write goes through .NET's `SetEnvironmentVariable` via PowerShell, which persists the key **and** broadcasts `WM_SETTINGCHANGE` so already-running Explorer refreshes its env cache; already-open WT windows still only pick it up after they restart (a process's env block is fixed at spawn).

**Why HKCU, not `~/.claude/settings.json` (which is what v2.3.2 and earlier used):** settings.json has many other writers — Claude Code's own config writes (`feedbackSurveyState`, `model`), claude-mem, manual edits — that rewrite the whole file from their in-memory copy and silently drop our injected `env` key. Observed in the wild on 2026-07-06: the var was gone from a live settings.json despite the launcher having written it. A registry var can't be clobbered that way, and it sidesteps the unverified risk that Claude reads renderer vars *before* applying settings.json `env` (the docs carve out NO_COLOR/FORCE_COLOR as read too early). Belt-and-suspenders on top of the persisted var: the `wt` spawn and the pwsh fallback also set the var via `.env()` on their direct child (covering the fresh-wt case before the HKCU var has propagated to a new shell session). The IDE PTY does the opposite — it `env_remove`s the var for **both** renderer branches, because the stale-glyph bug it fixes is Windows Terminal's, and in the embedded xterm terminal per-frame full repaints only multiply rendering load (see the emulation contract below).

### IDE-Mode Terminal Emulation Contract

The IDE terminal is xterm.js over ConPTY (`portable_pty`), running Claude Code's fullscreen TUI. Nearly every IDE-Mode rendering bug we've shipped fixes for traces back to one of three mismatches between that stack and what Claude Code expects, so **check these three layers before adding a new point fix**:

1. **Width tables.** Claude Code measures text with `Bun.stringWidth` (modern Unicode, `ambiguousIsNarrow`), and since ~v2.1.187 it positions the *real* terminal cursor at the input caret (server-side `tengu_native_cursor` gate; `CLAUDE_CODE_NATIVE_CURSOR=1` forces it on, accessibility mode implies it). xterm.js's built-in width provider is Unicode 6. The fix (mirroring VS Code, whose terminal defaults to `terminal.integrated.unicodeVersion: "11"`): load `@xterm/addon-unicode11` and set `term.unicode.activeVersion = "11"` after loading, plus pass `windowsPty: { backend: "conpty", buildNumber }` (build read via the `get_os_build` command) so xterm applies its ConPTY resize/reflow heuristics. A width disagreement shows up as the cursor rendering N columns away from the end of typed text.
2. **WebGL renderer fragility under WebView2.** The glyph-atlas corruption, column-0 clipping, and the repaint machinery (Refresh button, turn-boundary auto-repaint, deferred addon load) are all symptoms of `@xterm/addon-webgl` in WebView2. Anthropic's own `/terminal-setup` for VS Code sets `terminal.integrated.gpuAcceleration: "off"` for the same class of bug. As of v2.4.0 the IDE terminal defaults to the **DOM renderer**; WebGL is an opt-in setting (`ideGpu`). If WebGL trouble recurs, the answer is the DOM renderer, not more repaint hooks.
3. **ConPTY re-synthesis.** In-box ConPTY (v1) does not pass VT through: it keeps its own buffer and re-emits output/cursor positions using conhost's width tables. Windows Terminal 1.22+ ships a rewritten ConPTY (grapheme-aware, near-passthrough). As of v2.4.0 we bundle that rewrite: `src-tauri/conpty/` holds `conpty.dll` + `OpenConsole.exe` (NuGet `Microsoft.Windows.Console.ConPTY`, see the README there), placed next to the exe by `bundle.resources` — `portable_pty` prefers a sideloaded `conpty.dll` over kernel32 automatically. Note this ConPTY sends DA1 (`CSI c`) at startup and stalls without a response; xterm.js answers it by default, so don't swallow parser traffic.

Also relevant: `CLAUDE_CODE_ALT_SCREEN_FULL_REPAINT=1` (installed machine-wide via HKCU for Windows Terminal) forces whole-screen redraws every frame, which multiplies xterm rendering load — the IDE PTY spawn strips it for that reason. Claude Code's renderer env surface also includes `CLAUDE_CODE_NO_FLICKER` (fullscreen), `CLAUDE_CODE_DISABLE_ALTERNATE_SCREEN` (classic), `CLAUDE_CODE_DISABLE_MOUSE[_CLICKS]`, `CLAUDE_CODE_SCROLL_SPEED`, and `CLAUDE_CODE_DEBUG_REPAINTS`.

### Security

The Rust backend validates all inputs before execution: flags must match `--[a-zA-Z][a-zA-Z0-9-]*` (with optional `=value`), paths and profiles are checked for shell metacharacters. The pwsh fallback uses PowerShell's call operator (`&`) with individually quoted arguments rather than string interpolation.

### Component Organization

```
src/components/
├── layout/       # Layout, TitleBar, StatusBar
├── projects/     # ProjectList, ProjectRow, RecentCards, RecentCard, AddProjectDialog
├── settings/     # SettingsModal, ProjectFlagsModal, FlagToggle
└── shared/       # Modal (reusable base)
```

### Version Management

Version must be updated in three places:
- `package.json` → `version`
- `src-tauri/Cargo.toml` → `version`
- `src-tauri/tauri.conf.json` → `version`

The frontend accesses version at runtime via the `__APP_VERSION__` global defined in `vite.config.ts` (sourced from `package.json`).

### Auto-Updater

Uses `tauri-plugin-updater` + `tauri-plugin-process` for in-app updates. On startup, the app fetches `latest.json` from the latest GitHub release, compares versions, and offers a one-click download → install → relaunch flow. Update artifacts are signed with minisign.

- **Hook**: `src/hooks/useUpdateChecker.ts` — calls `check()` from the updater plugin, tracks download progress, triggers `relaunch()`
- **UI**: `src/components/layout/StatusBar.tsx` — shows update button, progress bar, or error
- **Config**: `plugins.updater` in `tauri.conf.json` — public key + endpoint
- **Endpoint**: `https://github.com/arris138/Claudelauncher/releases/latest/download/latest.json`

## Deployment

### Signing Keys

Updates require cryptographic signing via minisign. Keys were generated with:

```bash
pnpm tauri signer generate -w ~/.tauri/claude-launcher.key
```

- **Private key**: `~/.tauri/claude-launcher.key` (never commit this)
- **Public key**: Embedded in `src-tauri/tauri.conf.json` → `plugins.updater.pubkey`
- **Password**: Stored in `.env` as `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` (gitignored)

### Building a Release

```bash
# Load signing credentials
export TAURI_SIGNING_PRIVATE_KEY=$(cat ~/.tauri/claude-launcher.key)
source .env   # .env uses `export`, so the password reaches the build's child process

# Build
pnpm tauri build
```

> **Critical:** `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` must be **exported**, not just set
> as a shell var. If it isn't, `pnpm tauri build` compiles and bundles fine but then
> **hangs indefinitely** at the updater-signing step waiting for the password on stdin
> (which never comes in a non-interactive shell) — no `.sig` is produced. The `.env`
> line is prefixed with `export` for this reason. If you ever hit the hang, you don't
> need to rebuild: sign the already-built installer directly with
> `pnpm tauri signer sign -f ~/.tauri/claude-launcher.key -p '<password>' "<path to ...-setup.exe>"`,
> which writes the `.sig` instantly.

This produces in `src-tauri/target/release/bundle/`:
- `nsis/Claude Launcher_X.Y.Z_x64-setup.exe` + `.sig`
- `msi/Claude Launcher_X.Y.Z_x64_en-US.msi` + `.sig`

### Publishing a Release

1. Bump version in all three places (see Version Management above)
2. Build with signing keys as shown above
3. Generate `latest.json` with the NSIS `.sig` content and correct download URL
4. Create a GitHub release (`gh release create vX.Y.Z`) and upload:
   - The NSIS `.exe` installer
   - The MSI installer
   - `latest.json`

   **Asset naming:** the bundle outputs `Claude Launcher_X.Y.Z_...` (spaced/cased), but
   release assets are uploaded as lowercase **`claude-launcher_X.Y.Z_x64-setup.exe`** /
   `claude-launcher_X.Y.Z_x64_en-US.msi`. The `url` in `latest.json` points at the
   `claude-launcher_...-setup.exe` asset, so copy/rename the files to those names before
   uploading — the URL and the uploaded asset name must match exactly or the updater 404s.

The `latest.json` file must contain `version`, `notes`, `pub_date`, and a `platforms.windows-x86_64` object with `signature` (base64 content of the `.sig` file) and `url` (GitHub download URL for the NSIS `.exe`). Existing installs on v1.5.0+ will auto-detect the new release.
