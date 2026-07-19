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
 * Mirror the legacy flat settings into the agent-keyed maps under the default
 * ("claude") agent.
 *
 * The flat fields are still the authoritative ones that the rest of the app
 * reads and writes — the agent-keyed maps are written but not yet read. So this
 * runs on every load *and* every save rather than only when the target is
 * absent: if it ran once at first load, any flag the user toggled afterwards
 * would leave `agentFlags.claude` holding a stale snapshot, and Phase 3 would
 * silently switch reads over to it. Deleted in Phase 6 along with the flat
 * fields, at which point the agent-keyed maps become authoritative.
 */
function syncLegacySettings(s: GlobalSettings): GlobalSettings {
  const id = DEFAULT_AGENT_ID;
  return {
    ...s,
    agentPaths: { ...s.agentPaths, [id]: s.claudePath },
    agentFlags: { ...s.agentFlags, [id]: s.globalFlags },
    agentCustomFlags: { ...s.agentCustomFlags, [id]: s.customFlags },
    agentSubcommands: { ...s.agentSubcommands, [id]: s.remoteControl ?? false },
  };
}

export async function loadAppData(): Promise<AppData> {
  try {
    const store = await getStore();
    const projects = await store.get<Project[]>("projects");
    const settings = await store.get<GlobalSettings>("settings");
    return {
      projects: projects ?? DEFAULT_APP_DATA.projects,
      settings: syncLegacySettings(
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
  await store.set("settings", syncLegacySettings(settings));
}
