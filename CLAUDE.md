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
| `launch_shell` | Open an elevated Cmd/PowerShell window in the user's home dir |
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
- **`model`** — passed as `--model=<id>`; defaults to `DEFAULT_MODEL` (`claude-opus-5`) in `src/utils/models.ts`. An empty string means "no `--model` flag" (CLI default).
- **`color`** — hex tab color, passed as `--tabColor`.

### Live Model in Tab Title

Keeps a tab titled `"<name> — <model>"` and updates it live when the user swaps models mid-session (`/model`). The launcher can't observe a running session, so the update happens inside it via a Claude Code **statusLine** script (hooks only receive the model at `SessionStart`, statusLine receives `model.display_name`/`model.id` on every render).

- **Installer** — `install_model_title_statusline` (Rust command, mirrors `install_chime_hooks`): writes `~/.claude/scripts/launcher-statusline.ps1` and points `settings.json` → `statusLine` at it. Idempotent, backs up `settings.json`, and preserves any pre-existing statusLine by chaining it (remembered in `launcher-statusline-inner.txt` so re-installs don't drop it). UI: Settings → "Install model-in-title statusline".
- **statusLine script** — reads stdin JSON for `model.display_name` + cwd, looks the custom name up in `launcher-tab-names.json` (keyed by normalized path; falls back to the folder name), prints the visible status text, then emits `ESC]0;<name> — <model>BEL`.
- **Critical interaction** — `--suppressApplicationTitle` makes Windows Terminal ignore *all* application title changes, including the OSC. So `modelInTitle` (like `dynamicTitle`) must leave the title un-suppressed for it to work.
- **Why a path→name map, not an env var** — this was originally attributed to `wt.exe` env vars not reaching a new tab when an existing WT window services the request. **That is not true on Windows Terminal 1.24.11911.0**, measured directly on 2026-09-20: a probe var set on the spawned `wt.exe` reached the new tab in all three cases, including with a persistent WT window already open to service the request. Whatever the original symptom was, the environment block is forwarded. The map file (written by `upsert_tab_name` on launch, looked up by cwd) still works and is still what ships, so there is no reason to rewrite it — but don't repeat the env claim as a reason to avoid env vars elsewhere. The OpenRouter agent relies on that forwarding (see **OpenRouter models** below).

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

### OpenRouter models

A third agent, `openrouter`, runs **models from OpenRouter through the Claude
Code binary**. It is not a separate CLI: OpenRouter is a model router with an
HTTP endpoint, and the launcher's abstraction is "spawn a binary in a
directory", so `src/agents/openrouter.ts` reuses `claude` as the host and
redirects it with `ANTHROPIC_BASE_URL=https://openrouter.ai/api`.

That works because **OpenRouter serves an Anthropic-shaped `/v1/messages`**, not
merely an OpenAI-shaped one. Verified 2026-09-20 against the live endpoint: a
request carrying an `input_schema` tool came back with `thinking` and `tool_use`
blocks and `stop_reason: "tool_use"`. `src-tauri/tests/openrouter_launch.rs` is
the end-to-end proof and needs a funded key:

```
OPENROUTER_TEST_KEY=sk-or-v1-... cargo test --test openrouter_launch -- --ignored --nocapture
```

Three findings from building it, each of which shaped the code:

- **An unmapped model is assumed to be 200k tokens.** Claude Code warns that a
  slug it doesn't recognise "isn't described by this version's model catalog"
  and auto-compacts at 200k regardless of the model's real window. `buildEnv`
  sets `CLAUDE_CODE_MAX_CONTEXT_TOKENS` from the catalog's `context_length`,
  which the integration test asserts on (a 1.31M model reporting
  `"contextWindow":1310720` rather than `200000`). Claude Code also mentions
  `modelOverrides` / `behavesAs` on a `modelPicker` row, which would suppress
  the warning banner too; not implemented.
- **The cost readout is wrong by roughly 340x.** Claude Code prices unknown
  models at Anthropic rates: it reported `$0.449` for a session whose real
  OpenRouter spend, measured against the `/api/v1/key` usage counter, was about
  `$0.0013`. Nothing in the launcher can fix that, so `ModelField` says so.
- **Tool calling working is not the loop working.** Across identical prompts,
  `z-ai/glm-5.3-flash` and `openai/gpt-oss-120b` answered cleanly in two turns,
  while `deepseek/deepseek-v4-flash` made the tool call correctly then returned
  an **empty final message on two runs out of three**. Price and context window
  predict none of this. The integration test originally used v4-flash and
  failed for exactly this reason. Treat the picker as candidates, not
  endorsements.

**API keys are per project, in the Windows Credential Manager** (`secrets.rs`,
service `claude-launcher`, keyed by project id). There is deliberately **no
command that reads a key back** — the frontend can write one and ask whether one
exists, nothing more. Launches send the project id; Rust resolves the value just
before spawn. So a key never enters the JS heap, devtools, or the launch log,
and `describe_env` logs variable *names* only (there is a test pinning that).
`removeProject` deletes the credential with the project.

**Model list is fetched, not shipped.** `src/services/openrouterCatalog.ts`
pulls `openrouter.ai/api/v1/models` (no auth needed), caches for an hour, and
falls back to a baked snapshot when offline.

> **`connect-src` in `tauri.conf.json` is load-bearing.** Any new remote origin
> the renderer fetches must be added there or the request is blocked with a bare
> `TypeError: Failed to fetch`. This nearly shipped broken: the catalog fetch
> would have failed silently and fallen back to the baked ten forever, looking
> exactly like a working feature. Confirmed both ways against the real policy
> strings (pre-fix `BLOCKED`, shipped `ALLOWED models=446`). CORS is not a
> concern here — OpenRouter answers `Access-Control-Allow-Origin: *`.

Filter rules that came from reading the live data rather than from first
principles:

- **`:batch` variants are excluded.** They are 20-40% cheaper, so they float to
  the top of any price sort, and they are asynchronous — eleven pass a naive
  price filter and every one would hang an interactive session.
- **`tools` required, `reasoning` required.** The reasoning rule excludes all
  three purpose-built coders (`qwen3-coder-next`, `qwen3-coder-flash`,
  `codestral-2508`), which are code-tuned but expose no reasoning parameter.
  `requireReasoning: false` gets them back.
- **Free models bypass the price ceiling** and sort to the top of the picker.
  They are rate-limited and need prompt logging enabled on the OpenRouter
  account, which the UI states.

**Coding-benchmark ranking, not price order.** The picker does not show the
whole filtered catalog (~76 models at a glance is noise); it shows a free top-5
and a paid top-15 ordered by coding quality. The quality signal comes from the
**locally-authenticated `claude` CLI**: `rank_coding_models` (Rust) asks Sonnet
in print mode to score every candidate for agentic coding, once a week. The
prompt travels on **stdin** (a cmd.exe wrapper re-parses quoted newlines
badly), with `--strict-mcp-config` so the pass doesn't connect the user's MCP
servers and `--no-session-persistence` so it never pollutes `--resume`. No API
key is collected and nothing crosses the renderer's network stack, so
`connect-src` stays untouched.
- `src/services/codingRankings.ts` — cache in the store JSON under
  `model_rankings` (`{at, scores}`), 7-day TTL, one failed attempt per session
  so a broken CLI can't re-spawn on every dialog, `parseScores` accepts only
  ids that were actually offered, `selectForPicker` caps at
  `FREE_PICKS`/`PAID_PICKS`.
- A project pinned to a model that missed the cut still displays it, labeled
  "outside the top picks" — the picker never lies about what will launch.
- With no ranking (offline, missing or too-old CLI, parse miss) the picker
  degrades to the old full price-ordered list. The list stays long; it never
  breaks.
- Scores are one model's recall of public benchmarks, re-derived weekly with
  visible run-to-run jitter. Treat the ordering as a shortlist generator, not
  a leaderboard.

**Usage chips.** OpenRouter money lives in the status bar, and every request
is made Rust-side (`src-tauri/src/openrouter.rs`) so keys never reach the
renderer and `connect-src` is untouched.
- **Per session, IDE stage** (`SessionUsageChip`): spend on the active
  session's project key since that session started. The baseline
  (`Session.usageAtStart`) is captured in `useSessions.createSession`, not at
  chip mount, so switching tabs cannot rewind the number; `/api/v1/key` is
  polled every 60s and the delta shown. It is key-wide — two sessions sharing
  a key each include both sessions' spend — because OpenRouter has no
  per-session attribution, and the tooltip says so.
- **Board, launcher stage** (`LauncherUsageChip`): rolling 14-day spend plus
  true account balance when a management key is stored; otherwise this-UTC-week
  summed across the *distinct* project keys (projects sharing a key are
  deduped Rust-side so the number isn't multiplied). The weekly fallback
  exists because `/api/v1/key` only reports fixed Monday/month windows —
  `GET /api/v1/activity` and `/credits` are management-key-only.
- The **management key** is an optional account-level credential under the
  fixed reference `openrouter-management` in the same keyring service,
  entered in Settings → OpenRouter and write-only like project keys. Its
  absence is the `Ok(None)` fallback signal; a present-but-rejected key still
  leaves the per-key numbers working, with the error in the chip tooltip.
  Both ends build the reference from string parts because the intact literal
  has once arrived in source mangled (see `codingRankings.ts`).

`useFreeModelWatch` reports free models added since the user last looked, using
the catalog's `created` unix timestamp against a watermark in settings. It is a
real diff, not a heuristic, and the watermark is **seeded on first sight** so a
fresh install doesn't announce all twenty-one free models as news. It also warns
when a model a project is pinned to carries an `expiration_date` within 14 days
— that field is populated for paid models too, so the function is
`expiringModels`, not `expiringFreeModels`.

**What the agent gives up.** `modelInTitle` is off because the statusLine
renders `model.display_name`, which for a routed slug is blank or the raw id;
`modelSniffing` is off because the banner matcher expects Anthropic display
names. `claudeFeatures` is now gated on `capabilities.claudeRendererEnv` rather
than `agent.id === "claude"`, because this agent *is* the Claude Code binary and
wants the renderer vars.

### Remote Control

Claude projects launch with `--remote-control` on by default. It is an ordinary
entry in `claudeAgent.flags` carrying `defaultEnabled: true`, so it inherits the
whole three-tier system for free: a global toggle in Settings, and a per-project
On/Off/Global override in the Edit dialog. `defaultEnabled` is read by
`agentGlobalFlags`, which only stores flags the user has actually touched, so the
flag arrives switched on for existing installs and not just fresh ones.

**Do not route this through `claude remote-control`.** v1.2.0 through v3.0.1 did,
via `agentSubcommands` and `claudeAgent.subcommand`. That hidden subcommand is a
headless bridge *host* for driving sessions from claude.ai, not a coding session,
and its option set is `--name / --spawn / --capacity / --permission-mode`. It
rejects the flags the launcher appends, so the toggle could only ever produce:

```
$ claude remote-control --dangerously-skip-permissions --model=claude-opus-5
Error: Unknown argument: --dangerously-skip-permissions
```

The session flag is the right surface, and is what `/rc` inside a running session
maps to. `claudeAgent.subcommand` is now `null`; the Rust `subcommand` plumbing
and `is_safe_subcommand` stay for a future agent that wants one.

Two constraints worth keeping in mind:

- **There is no `--no-remote-control`.** Off means not passing the flag. So a
  user-scope `remoteControlAtStartup: true` in `~/.claude/settings.json` would
  override the launcher's off switch with no way back, which is why the launcher
  owns the default instead of that setting. The setting is also refused from
  project or local scope: the CLI prints "repo-scoped settings cannot enable
  Remote Control".
- **`--remote-control [name]` takes an optional positional value.** The CLI
  swallows the next argument as the session name if it does not start with `-`.
  Every argument the launcher builds starts with `--`, and `is_safe_flag` enforces
  it, so nothing can currently land in that slot. Anything that appends a bare
  word to the argv has to account for it.

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

### IDE-Mode Terminal Links

`src/components/ide/terminalLinks.ts` registers one xterm link provider for URLs, file paths and markdown `[label](target)` links. Ctrl or Cmd plus click opens them through the shell plugin's `open`. Links exist only in the embedded IDE terminals. The top bar Cmd and PS buttons open an external Windows Terminal, where nothing is clickable.

- **`plugins.shell.open` in `tauri.conf.json` is load-bearing.** The shell plugin validates every `open` argument against that regex. Left unset it allows only http(s), mailto and tel, so every file path is rejected. v2.5.5 through v3.0.0 shipped that way: paths underlined, Ctrl+click did nothing, and a `.catch(() => {})` hid the rejection. The regex now also allows drive-letter and UNC paths. Do not remove it, and do not swallow `open` errors again.
- **Executables are refused in the frontend** (`EXECUTABLE_RE`). `open` hands the path to the Windows shell, which runs an `.exe`, `.bat`, `.ps1` or `.lnk` rather than viewing it, and terminal output is untrusted text.
- **The terminal prints plain text.** Claude Code emits markdown links, which arrive as literal brackets and parens. The provider claims the whole `[label](target)` span as one link and pre-claims its range so the URL and path passes cannot also match the target. A target containing whitespace is skipped, which keeps code like `handlers[key](event)` from matching.
- **Testing needs a real agent session.** Have a Claude session in the IDE pane print the link inside a fenced code block, because the TUI reformats a bare markdown link.
- **`tauri build`, never bare `cargo build --release`.** Only the Tauri CLI sets the flags that embed `dist/`. A bare cargo build falls back to `devUrl` and shows a localhost connection error. Use `pnpm tauri build --no-bundle` for a quick unsigned test exe.

### Security

The Rust backend validates all inputs before execution: flags must match `--[a-zA-Z][a-zA-Z0-9-]*` (with optional `=value`), paths and profiles are checked for shell metacharacters. The pwsh fallback uses PowerShell's call operator (`&`) with individually quoted arguments rather than string interpolation.

### One Shell, Two Stages

Both modes share a single frame. `IdeView` **is** the shell: it renders the mode
bar, the session rail and the status bar, and the Launcher/IDE toggle only swaps
which stage fills the middle. `App.tsx` mounts it once, for the life of the app,
and owns nothing but the hooks and the three dialogs.

- **Never unmount the shell.** Sessions and their PTYs live inside its
  `<Terminal>` components. The terminal stage is hidden with the `hidden`
  attribute (`.ide .stage[hidden] { display: none }`) while the board is up —
  the same trick the old `.ide-hidden` class played on the whole view.
- **`useSessions` is called once**, in the shell. That's why the board can show
  LIVE chips and per-project session counts without a second copy of the state.
- **Adding a project lives in the top bar**, so it's reachable from the terminal
  stage too, with a second door at the top of the Jack In picker
  (`onNewProject`) that creates a project and jacks into it in one move.
- **One button family in the top bar.** `.barbtn` (mode bar) and `.tbtn` (stage
  bars) share height, border, radius and type; only the primary action carries
  the rust fill. Don't add a fourth button style.
- **`.ide` sets `isolation: isolate`** so its grain overlay (`z-index: 9999`)
  and picker scrim can't paint over the app-level dialogs, which are DOM
  siblings of the shell. It also pins `grid-template-columns: minmax(0, 1fr)`,
  without which a wide project table auto-sizes the implicit column and pushes
  the mode bar's right-hand buttons off screen.
- **The project table is auto-layout.** `table-layout: fixed` fought the column
  widths (the name column collapsed to zero); instead the one unbounded thing,
  the name and its path, is capped by `.pname .txt { max-width: 46ch }`, and
  narrow windows drop Created (`max-width: 1120px`) then Agent (`940px`) rather
  than letting the row actions slide off the edge.

### Component Organization

```
src/components/
├── ide/          # IdeView (the shell), SessionRail, Terminal, FilesDrawer, JackInPicker
├── launcher/     # LauncherStage (the project board)
├── projects/     # AddProjectDialog, EditProjectDialog, ColorPicker, ModelField, EffortField
├── settings/     # SettingsModal, FlagToggle
└── shared/       # Modal (reusable base)
```

The dialogs are still Tailwind; everything in the shell is styled by
`src/theme/chromeRust.css`.

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

The `latest.json` file must contain `version`, `notes`, `pub_date`, and a `platforms.windows-x86_64` object with `signature` and `url` (GitHub download URL for the NSIS `.exe`). `signature` is the **verbatim text content of the `.sig` file, not base64-of-the-file** — tauri already writes the `.sig` as one base64 blob (`base64 -d` of it yields the `untrusted comment:` text). Wrapping it in `base64` again produces a field that decodes to base64 instead of `untrusted comment:` and the updater rejects the update; caught on v4.1.0 by decoding the field once and checking its first words. Existing installs on v1.5.0+ will auto-detect the new release.
