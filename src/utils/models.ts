import { claudeAgent } from "../agents/registry";
import type { ModelOption } from "../agents/types";

/**
 * Back-compat shims. The model list now lives on the agent definition
 * (`src/agents/claude.ts`); these re-exports keep existing call sites working
 * until they are switched over to `getAgent(project.agentId)` in Phase 3.
 *
 * @deprecated Use `getAgent(id).defaultModel` / `.models` instead.
 */

/** Model passed to Claude via --model when a project doesn't specify one. */
export const DEFAULT_MODEL = claudeAgent.defaultModel;

/** Selectable models for the per-project model picker. */
export const MODEL_OPTIONS: ModelOption[] = claudeAgent.models;
