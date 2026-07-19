import { invoke, Channel } from "@tauri-apps/api/core";
import type { Project, GlobalSettings } from "../types";
import { resolveAgentRequest } from "./launcher";

/** Build the resolved flag list (incl. the model flag) for a project, as the wt path does. */
export function resolveSessionFlags(
  project: Project,
  settings: GlobalSettings
): string[] {
  return resolveAgentRequest(project, settings).flags;
}

/** Spawn an embedded PTY running the project's agent. Output streams via `onOutput`. */
export async function spawnPty(
  sessionId: string,
  project: Project,
  settings: GlobalSettings,
  flags: string[],
  cols: number,
  rows: number,
  onOutput: Channel<number[]>
): Promise<void> {
  const { agentPath, subcommand, claudeFeatures, notifyHook } =
    resolveAgentRequest(project, settings);
  await invoke("spawn_pty", {
    sessionId,
    cols,
    rows,
    onOutput,
    request: {
      agentPath,
      projectPath: project.path,
      terminalProfile: settings.terminalProfile,
      flags,
      subcommand,
      claudeFeatures,
      notifyHook,
      preLaunchCommand: project.preLaunchCommand ?? null,
      tabColor: project.color ?? null,
      tabTitle: project.tabTitle?.trim() || project.name,
      dynamicTitle: project.dynamicTitle ?? false,
      ideRenderer: project.ideRenderer ?? settings.ideRenderer ?? "fullscreen",
    },
  });
}

/** Windows build number (0 if unreadable) — feeds xterm.js's `windowsPty` hint. */
export function getOsBuild(): Promise<number> {
  return invoke<number>("get_os_build");
}

export function writePty(sessionId: string, data: string): Promise<void> {
  return invoke("write_pty", { sessionId, data });
}

export function resizePty(sessionId: string, cols: number, rows: number): Promise<void> {
  return invoke("resize_pty", { sessionId, cols, rows });
}

export function killPty(sessionId: string): Promise<void> {
  return invoke("kill_pty", { sessionId });
}

/** Ensure the IDE attention hooks (Stop/Notification → app) are installed. */
export function ensureIdeHooks(): Promise<string> {
  return invoke<string>("ensure_ide_hooks");
}

export interface DirEntryInfo {
  name: string;
  isDir: boolean;
}

export interface GitStatusEntry {
  path: string;
  status: "M" | "A" | "D";
}

export function readDirEntries(path: string): Promise<DirEntryInfo[]> {
  return invoke<DirEntryInfo[]>("read_dir_entries", { path });
}

export function gitStatus(cwd: string): Promise<GitStatusEntry[]> {
  return invoke<GitStatusEntry[]>("git_status", { cwd });
}

export function gitDiff(cwd: string, file: string): Promise<string> {
  return invoke<string>("git_diff", { cwd, file });
}
