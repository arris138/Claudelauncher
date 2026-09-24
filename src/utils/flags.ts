import type { GlobalSettings, FlagOverrides, AgentId } from "../types";
import { EFFORT_INHERIT, type AgentDefinition } from "../agents/types";
import { getAgent, DEFAULT_AGENT_ID } from "../agents/registry";

/**
 * The agent's global flag state, seeded from its flag catalog when the user has
 * never touched it. Seeding here (rather than in DEFAULT_SETTINGS) means adding
 * a flag to an agent definition makes it appear for existing users too — and a
 * flag marked `defaultEnabled` arrives switched on for them, not just for a
 * fresh install.
 */
export function agentGlobalFlags(
  settings: GlobalSettings,
  agentId: AgentId = DEFAULT_AGENT_ID
) {
  const agent = getAgent(agentId);
  const stored = settings.agentFlags?.[agentId];
  return agent.flags.map((def) => ({
    flagName: def.name,
    enabled:
      stored?.find((s) => s.flagName === def.name)?.enabled ??
      def.defaultEnabled ??
      false,
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

/** The agent's global default effort: the Settings choice, else its built-in default. */
export function globalEffort(
  settings: GlobalSettings,
  agent: AgentDefinition
): string {
  return settings.agentEffort?.[agent.id] ?? agent.defaultEffort ?? "";
}

/** Display label for the agent's current global effort, for "Global default (...)" options. */
export function effortLabel(
  settings: GlobalSettings,
  agent: AgentDefinition
): string {
  const value = globalEffort(settings, agent);
  return agent.efforts?.find((o) => o.value === value)?.label ?? value;
}

/** The effort a launch actually uses, resolving a project's "inherit" against the global default. */
export function resolveEffort(
  projectEffort: string | undefined,
  settings: GlobalSettings,
  agent: AgentDefinition
): string {
  if (projectEffort === undefined || projectEffort === EFFORT_INHERIT) {
    return globalEffort(settings, agent);
  }
  return projectEffort;
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
