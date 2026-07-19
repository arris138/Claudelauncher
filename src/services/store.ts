import { load } from "@tauri-apps/plugin-store";
import type { Project, GlobalSettings, AppData } from "../types";
import { DEFAULT_AGENT_ID } from "../agents/registry";

const STORE_FILE = "claude-launcher-data.json";

const DEFAULT_SETTINGS: GlobalSettings = {
  claudePath: "claude",
  terminalProfile: "PowerShell",
  globalFlags: [
    { flagName: "--dangerously-skip-permissions", enabled: false },
    { flagName: "--verbose", enabled: false },
  ],
  customFlags: [],
  remoteControl: false,
  uiMode: "launcher",
  ideRenderer: "fullscreen",
  ideGpu: false,
};

const DEFAULT_APP_DATA: AppData = {
  projects: [],
  settings: DEFAULT_SETTINGS,
};

let storeInstance: Awaited<ReturnType<typeof load>> | null = null;

async function getStore() {
  if (!storeInstance) {
    storeInstance = await load(STORE_FILE, {
      defaults: {
        projects: DEFAULT_APP_DATA.projects,
        settings: DEFAULT_APP_DATA.settings,
      },
      autoSave: true,
    });
  }
  return storeInstance;
}

/**
 * One-time migration of pre-multi-agent settings into the "claude" slot.
 *
 * As of Phase 3 the agent-keyed maps are authoritative, so this only seeds a
 * slot that doesn't exist yet — re-running it unconditionally would overwrite
 * the user's Claude settings with the frozen legacy copy on every load.
 */
function migrateLegacySettings(s: GlobalSettings): GlobalSettings {
  const id = DEFAULT_AGENT_ID;
  const out = { ...s };
  if (s.claudePath && out.agentPaths?.[id] === undefined) {
    out.agentPaths = { ...out.agentPaths, [id]: s.claudePath };
  }
  if (s.globalFlags && out.agentFlags?.[id] === undefined) {
    out.agentFlags = { ...out.agentFlags, [id]: s.globalFlags };
  }
  if (s.customFlags && out.agentCustomFlags?.[id] === undefined) {
    out.agentCustomFlags = { ...out.agentCustomFlags, [id]: s.customFlags };
  }
  if (out.agentSubcommands?.[id] === undefined) {
    out.agentSubcommands = {
      ...out.agentSubcommands,
      [id]: s.remoteControl ?? false,
    };
  }
  return out;
}

/**
 * Mirror the "claude" slot back onto the legacy flat fields on save.
 *
 * Nothing reads these any more, but a user who runs this build and then
 * reinstalls an older one would otherwise find their Claude path and flags
 * blank. Removed in Phase 6, one release after the agent-keyed maps shipped.
 */
function mirrorToLegacy(s: GlobalSettings): GlobalSettings {
  const id = DEFAULT_AGENT_ID;
  return {
    ...s,
    claudePath: s.agentPaths?.[id] ?? s.claudePath,
    globalFlags: s.agentFlags?.[id] ?? s.globalFlags,
    customFlags: s.agentCustomFlags?.[id] ?? s.customFlags,
    remoteControl: s.agentSubcommands?.[id] ?? s.remoteControl,
  };
}

export async function loadAppData(): Promise<AppData> {
  try {
    const store = await getStore();
    const projects = await store.get<Project[]>("projects");
    const settings = await store.get<GlobalSettings>("settings");
    return {
      projects: projects ?? DEFAULT_APP_DATA.projects,
      settings: migrateLegacySettings(
        settings ? { ...DEFAULT_SETTINGS, ...settings } : DEFAULT_SETTINGS
      ),
    };
  } catch {
    return DEFAULT_APP_DATA;
  }
}

export async function saveProjects(projects: Project[]): Promise<void> {
  const store = await getStore();
  await store.set("projects", projects);
}

export async function saveSettings(settings: GlobalSettings): Promise<void> {
  const store = await getStore();
  await store.set("settings", mirrorToLegacy(settings));
}
