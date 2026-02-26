export interface Project {
  id: string;
  name: string;
  path: string;
  flagOverrides: FlagOverrides;
  createdAt: string;
  lastLaunchedAt: string | null;
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
