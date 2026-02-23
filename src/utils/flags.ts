import type { FlagDefinition, GlobalSettings, FlagOverrides } from "../types";

export const BUILT_IN_FLAGS: FlagDefinition[] = [
  {
    name: "--dangerously-skip-permissions",
    label: "Skip Permissions",
    description:
      "Skip the permission prompt for tool use (use with caution)",
  },
  {
    name: "--verbose",
    label: "Verbose Output",
    description: "Enable verbose logging output",
  },
];

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
