import type { AgentDefinition, AgentId } from "./types";
import { claudeAgent } from "./claude";
import { codexAgent } from "./codex";

/**
 * Every agent the launcher can spawn, in display order. Adding one here is the
 * whole registration step — no Rust change, no new IPC command.
 */
export const ALL_AGENTS: AgentDefinition[] = [claudeAgent, codexAgent];

/** The agent assumed for anything created before multi-agent support. */
export const DEFAULT_AGENT_ID: AgentId = "claude";

/**
 * Look up an agent definition, falling back to Claude for a missing or
 * unrecognised id. That fallback is what makes `Project.agentId` safe to leave
 * optional: pre-multi-agent projects have no id and must keep working, and a
 * project written by a newer build then opened by an older one must not crash.
 */
export function getAgent(id?: string | null): AgentDefinition {
  return ALL_AGENTS.find((a) => a.id === id) ?? claudeAgent;
}

/** True when `id` names an agent this build actually knows about. */
export function isKnownAgent(id?: string | null): id is AgentId {
  return ALL_AGENTS.some((a) => a.id === id);
}

export { claudeAgent, codexAgent };
export type { AgentDefinition, AgentId };
