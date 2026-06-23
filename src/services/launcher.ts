import { invoke } from "@tauri-apps/api/core";
import type { Project, GlobalSettings, LaunchResult } from "../types";
import { resolveFlags } from "../utils/flags";
import { DEFAULT_MODEL } from "../utils/models";

export async function launchProject(
  project: Project,
  settings: GlobalSettings
): Promise<LaunchResult> {
  const effectiveFlags = resolveFlags(settings, project.flagOverrides);

  const model = project.model ?? DEFAULT_MODEL;
  if (model) {
    effectiveFlags.push(`--model=${model}`);
  }

  const result = await invoke<LaunchResult>("launch_claude", {
    request: {
      claudePath: settings.claudePath,
      projectPath: project.path,
      terminalProfile: settings.terminalProfile,
      flags: effectiveFlags,
      remoteControl: settings.remoteControl ?? false,
      preLaunchCommand: project.preLaunchCommand ?? null,
      tabColor: project.color ?? null,
      tabTitle: project.tabTitle?.trim() || project.name,
      dynamicTitle: project.dynamicTitle ?? false,
      modelInTitle: project.modelInTitle ?? false,
    },
  });

  return result;
}

export async function detectClaudePath(): Promise<string> {
  return invoke<string>("detect_claude_path");
}

/** Open a plain Command Prompt or PowerShell window in the user's home dir. */
export async function launchShell(shell: "cmd" | "pwsh"): Promise<LaunchResult> {
  return invoke<LaunchResult>("launch_shell", { shell });
}
