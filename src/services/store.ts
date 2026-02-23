import { load } from "@tauri-apps/plugin-store";
import type { Project, GlobalSettings, AppData } from "../types";

const STORE_FILE = "claude-launcher-data.json";

const DEFAULT_SETTINGS: GlobalSettings = {
  claudePath: "claude",
  terminalProfile: "PowerShell",
  globalFlags: [
    { flagName: "--dangerously-skip-permissions", enabled: false },
    { flagName: "--verbose", enabled: false },
  ],
  customFlags: [],
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

export async function loadAppData(): Promise<AppData> {
  try {
    const store = await getStore();
    const projects = await store.get<Project[]>("projects");
    const settings = await store.get<GlobalSettings>("settings");
    return {
      projects: projects ?? DEFAULT_APP_DATA.projects,
      settings: settings
        ? { ...DEFAULT_SETTINGS, ...settings }
        : DEFAULT_APP_DATA.settings,
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
  await store.set("settings", settings);
}
