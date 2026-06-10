export interface Project {
  id: string;
  name: string;
  path: string;
  flagOverrides: FlagOverrides;
  preLaunchCommand?: string;
  createdAt: string;
  lastLaunchedAt: string | null;
  /** Hex color (`#rrggbb`) used for the terminal tab and UI accent. */
  color?: string;
  /** Terminal tab/window title. Falls back to the project name when unset. */
  tabTitle?: string;
  /** When true, let Claude Code's own dynamic titles replace the tab title. */
  dynamicTitle?: boolean;
  /**
   * Model passed via --model. Unset falls back to DEFAULT_MODEL;
   * empty string means launch with no --model flag (CLI default).
   */
  model?: string;
}

export type FlagOverrides = Record<string, boolean | undefined>;

export interface FlagDefinition {
  name: string;
  label: string;
  description: string;
}

export interface GlobalFlagState {
  flagName: string;
  enabled: boolean;
}

export interface GlobalSettings {
  claudePath: string;
  terminalProfile: string;
  globalFlags: GlobalFlagState[];
  customFlags: string[];
  remoteControl: boolean;
}

export interface AppData {
  projects: Project[];
  settings: GlobalSettings;
}

export type SortField = "name" | "lastLaunchedAt" | "createdAt";
export type SortDirection = "asc" | "desc";

export interface SortConfig {
  field: SortField;
  direction: SortDirection;
}

export interface LaunchResult {
  success: boolean;
  command: string;
  error: string | null;
}
