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

  // Agents with no effort concept have neither the builder nor a default, so
  // this contributes nothing rather than needing an id check.
  const effortFlag = agent.buildEffortFlag?.(
    project.effort ?? agent.defaultEffort ?? ""
  );
  if (effortFlag) flags.push(effortFlag);

  const env = agent.buildEnv?.({
    model: project.model ?? agent.defaultModel,
    contextWindow: project.modelContextWindow,
  }) ?? [];

  return {
    agent,
    flags,
    env,
    agentPath: agentPath(settings, agent.id),
    subcommand: agent.subcommand,
    // The env var the project's API key goes into, and the credential to look
    // it up by. The key itself stays in the Windows Credential Manager and is
    // resolved in Rust at spawn time, so it never enters the JS heap.
    secretEnvVar: agent.secretEnvVar ?? null,
    secretRef: agent.secretEnvVar ? project.id : null,
    // Gated on the capability rather than the agent id, because the OpenRouter
    // agent *is* the Claude Code binary pointed elsewhere: it wants the
    // renderer vars and the nested-session suppression just as much. The
    // statusLine map stays out of reach via `modelInTitle`, which it declares
    // false.
    claudeFeatures: agent.capabilities.claudeRendererEnv,
    // Opt-in, and only for agents that actually have a notify mechanism.
    notifyHook:
      (settings.agentNotifyHook ?? false) && agent.capabilities.notifyHook,
  };
}

export async function launchProject(
  project: Project,
  settings: GlobalSettings
): Promise<LaunchResult> {
  const { flags, env, agentPath, subcommand, claudeFeatures, notifyHook, secretEnvVar, secretRef } =
    resolveAgentRequest(project, settings);

  const result = await invoke<LaunchResult>("launch_agent", {
    request: {
      agentPath,
      projectPath: project.path,
      terminalProfile: settings.terminalProfile,
      flags,
      env,
      secretEnvVar,
      secretRef,
      subcommand,
      claudeFeatures,
      notifyHook,
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

/**
 * Open a plain Command Prompt or PowerShell window in the user's home dir,
 * elevated (Run as administrator), so each call raises a UAC prompt.
 */
export async function launchShell(shell: "cmd" | "pwsh"): Promise<LaunchResult> {
  return invoke<LaunchResult>("launch_shell", { shell });
}
