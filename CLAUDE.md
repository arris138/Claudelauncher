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

Output:
- **Portable exe**: `src-tauri/target/release/claude-launcher.exe`
- **NSIS installer**: `src-tauri/target/release/bundle/nsis/Claude Launcher_0.1.0_x64-setup.exe`
- **MSI installer**: `src-tauri/target/release/bundle/msi/Claude Launcher_0.1.0_x64_en-US.msi`

After building, create a shortcut to `src-tauri/target/release/claude-launcher.exe` in the project root directory for quick access.

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
