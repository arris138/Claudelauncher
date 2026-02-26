import { invoke } from "@tauri-apps/api/core";
import type { Project, GlobalSettings, LaunchResult } from "../types";
import { resolveFlags } from "../utils/flags";

export async function launchProject(
  project: Project,
  settings: GlobalSettings
): Promise<LaunchResult> {
  const effectiveFlags = resolveFlags(settings, project.flagOverrides);

  const result = await invoke<LaunchResult>("launch_claude", {
    request: {
      claudePath: settings.claudePath,
      projectPath: project.path,
      terminalProfile: settings.terminalProfile,
      flags: effectiveFlags,
      remoteControl: settings.remoteControl ?? false,
      preLaunchCommand: project.preLaunchCommand ?? null,
    },
  });

  return result;
}

export async function detectClaudePath(): Promise<string> {
  return invoke<string>("detect_claude_path");
}
