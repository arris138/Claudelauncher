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

### Update Checker

`src/hooks/useUpdateChecker.ts` checks GitHub releases API on startup. CSP in `tauri.conf.json` allows `connect-src` to `https://api.github.com`.
