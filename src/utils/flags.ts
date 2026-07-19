import type { FlagDefinition, GlobalSettings, FlagOverrides } from "../types";
import { claudeAgent } from "../agents/registry";

/**
 * Back-compat shim. The flag catalog now lives on the agent definition
 * (`src/agents/claude.ts`); this re-export keeps existing call sites working
 * until they are switched over to `getAgent(project.agentId).flags` in Phase 3.
 *
 * @deprecated Use `getAgent(id).flags` instead.
 */
export const BUILT_IN_FLAGS: FlagDefinition[] = claudeAgent.flags;

export function resolveFlags(
  settings: GlobalSettings,
  overrides: FlagOverrides
): string[] {
  const result: string[] = [];

  for (const gf of settings.globalFlags) {
    const override = overrides[gf.flagName];
    const isEnabled = override !== undefined ? override : gf.enabled;
    if (isEnabled) {
      result.push(gf.flagName);
    }
  }

  for (const customFlag of settings.customFlags) {
    const override = overrides[customFlag];
    const isEnabled = override !== undefined ? override : true;
    if (isEnabled) {
      result.push(customFlag);
    }
  }

  return result;
}
