import type { GlobalSettings, FlagOverrides, AgentId } from "../types";
import type { AgentDefinition } from "../agents/types";
import { getAgent, DEFAULT_AGENT_ID } from "../agents/registry";

/**
 * The agent's global flag state, seeded from its flag catalog when the user has
 * never touched it. Seeding here (rather than in DEFAULT_SETTINGS) means adding
 * a flag to an agent definition makes it appear for existing users too.
 */
export function agentGlobalFlags(
  settings: GlobalSettings,
  agentId: AgentId = DEFAULT_AGENT_ID
) {
  const agent = getAgent(agentId);
  const stored = settings.agentFlags?.[agentId];
  return agent.flags.map((def) => ({
    flagName: def.name,
    enabled: stored?.find((s) => s.flagName === def.name)?.enabled ?? false,
  }));
}

/** The agent's user-added custom flags. */
export function agentCustomFlags(
  settings: GlobalSettings,
  agentId: AgentId = DEFAULT_AGENT_ID
): string[] {
  return settings.agentCustomFlags?.[agentId] ?? [];
}

/** The agent's configured executable path, falling back to its bare command name. */
export function agentPath(
  settings: GlobalSettings,
  agentId: AgentId = DEFAULT_AGENT_ID
): string {
  return settings.agentPaths?.[agentId] || getAgent(agentId).defaultBinary;
}

/**
 * Merge an agent's global flag state with a project's per-flag overrides.
 * Overrides are keyed by flag name, so they only ever match flags belonging to
 * the agent the project is configured for.
 */
export function resolveFlags(
  agent: AgentDefinition,
  settings: GlobalSettings,
  overrides: FlagOverrides
): string[] {
  const result: string[] = [];

  for (const gf of agentGlobalFlags(settings, agent.id)) {
    const override = overrides[gf.flagName];
    const isEnabled = override !== undefined ? override : gf.enabled;
    if (isEnabled) {
      result.push(gf.flagName);
    }
  }

  for (const customFlag of agentCustomFlags(settings, agent.id)) {
    const override = overrides[customFlag];
    const isEnabled = override !== undefined ? override : true;
    if (isEnabled) {
      result.push(customFlag);
    }
  }

  return result;
}

/**
 * Back-compat shim.
 *
 * @deprecated Use `getAgent(id).flags` instead.
 */
export const BUILT_IN_FLAGS = getAgent(DEFAULT_AGENT_ID).flags;
