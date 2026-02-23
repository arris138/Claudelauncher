import { invoke } from "@tauri-apps/api/core";

export async function getLogPath(): Promise<string> {
  return invoke<string>("get_log_path");
}

export async function setLogPath(path: string): Promise<void> {
  await invoke("set_log_path", { path });
}

export async function readLog(tailLines?: number): Promise<string> {
  return invoke<string>("read_log", { tailLines });
}

export async function openLogFolder(): Promise<void> {
  await invoke("open_log_folder");
}
