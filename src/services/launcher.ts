import { invoke } from "@tauri-apps/api/core";
import type { Project, GlobalSettings, LaunchResult, AgentId } from "../types";
import { resolveFlags, agentPath } from "../utils/flags";
import { getAgent } from "../agents/registry";

/**
 * Resolve the agent-specific half of a launch request. The backend receives
 * only the result — it never branches on which agent this is.
 */
export function resolveAgentRequest(project: Project, settings: GlobalSettings) {
  const agent = getAgent(project.agentId);
  const flags = resolveFlags(agent, settings, project.flagOverrides);

  const modelFlag = agent.buildModelFlag(project.model ?? agent.defaultModel);
  if (modelFlag) flags.push(modelFlag);

  // The subcommand belongs to the agent, but whether to send it is the user's
  // choice (Claude's remote-control toggle). Agents with no subcommand ignore it.
  const subcommandEnabled = settings.agentSubcommands?.[agent.id] ?? false;

  return {
    agent,
    flags,
    agentPath: agentPath(settings, agent.id),
    subcommand: subcommandEnabled ? agent.subcommand : null,
    claudeFeatures: agent.id === "claude",
  };
}

export async function launchProject(
  project: Project,
  settings: GlobalSettings
): Promise<LaunchResult> {
  const { flags, agentPath, subcommand, claudeFeatures } = resolveAgentRequest(
    project,
    settings
  );

  const result = await invoke<LaunchResult>("launch_agent", {
    request: {
      agentPath,
      projectPath: project.path,
      terminalProfile: settings.terminalProfile,
      flags,
      subcommand,
      claudeFeatures,
      preLaunchCommand: project.preLaunchCommand ?? null,
      tabColor: project.color ?? null,
      tabTitle: project.tabTitle?.trim() || project.name,
      dynamicTitle: project.dynamicTitle ?? false,
      modelInTitle: project.modelInTitle ?? false,
    },
  });

  return result;
}

export async function detectAgentPath(agentId: AgentId): Promise<string> {
  return invoke<string>("detect_agent_path", { agentId });
}

/** Open a plain Command Prompt or PowerShell window in the user's home dir. */
export async function launchShell(shell: "cmd" | "pwsh"): Promise<LaunchResult> {
  return invoke<LaunchResult>("launch_shell", { shell });
}
