# Claude Launcher

A Tauri v2 desktop app for launching Claude Code CLI from different project directories with configurable flags.

## Tech Stack
- **Backend**: Tauri v2 (Rust)
- **Frontend**: React + TypeScript + Vite
- **Styling**: Tailwind CSS v4
- **Plugins**: tauri-plugin-shell, tauri-plugin-dialog, tauri-plugin-store

## Development

```bash
pnpm install
pnpm tauri dev
```

## Build

```bash
pnpm tauri build
```

Output: `src-tauri/target/release/Claude Launcher.exe`

## Architecture

- `src/` — React frontend (TypeScript)
- `src-tauri/` — Rust backend (Tauri commands)
- Data persisted via `tauri-plugin-store` to local JSON

## Key Files
- `src/App.tsx` — Root component
- `src-tauri/src/lib.rs` — Rust commands (launch_claude, detect_claude_path)
- `src/hooks/useProjects.ts` — Project CRUD + sorting
- `src/hooks/useSettings.ts` — Global settings management
- `src/services/launcher.ts` — Launch integration
