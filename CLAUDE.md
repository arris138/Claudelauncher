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

### Launch Strategy (Rust)

`launch_claude` in `lib.rs` tries Windows Terminal first (`wt new-tab --profile ... -d ... -- claude ...`), waits 500ms to check for immediate failure, then falls back to `pwsh -NoExit -WorkingDirectory ... -Command ...`. The `CLAUDECODE` env var is removed to prevent nested detection.

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
source .env

# Build
pnpm tauri build
```

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

The `latest.json` file must contain `version`, `notes`, `pub_date`, and a `platforms.windows-x86_64` object with `signature` (base64 content of the `.sig` file) and `url` (GitHub download URL for the NSIS `.exe`). Existing installs on v1.5.0+ will auto-detect the new release.
