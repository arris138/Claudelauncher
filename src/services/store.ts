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
  uiMode: "launcher",
  ideRenderer: "classic",
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
  return out;
}

/**
 * Mirror the "claude" slot back onto the legacy flat fields on save.
 *
 * Nothing reads these any more, but a user who runs this build and then
 * reinstalls an older one would otherwise find their Claude path and flags
 * blank. Removed in Phase 6, one release after the agent-keyed maps shipped.
 *
 * `remoteControl` is gone from this mirror: it drove the `claude remote-control`
 * subcommand, which never produced a working launch. A downgrade reads it as
 * false, which is the behaviour that actually worked.
 */
function mirrorToLegacy(s: GlobalSettings): GlobalSettings {
  const id = DEFAULT_AGENT_ID;
  return {
    ...s,
    claudePath: s.agentPaths?.[id] ?? s.claudePath,
    globalFlags: s.agentFlags?.[id] ?? s.globalFlags,
    customFlags: s.agentCustomFlags?.[id] ?? s.customFlags,
  };
}

/**
 * One-time move of every IDE session to the classic renderer. Fullscreen
 * leaves xterm with no scrollback, so the terminal has no usable scrollbar.
 * Runs once, so a user who picks fullscreen again afterwards keeps it.
 */
async function migrateToClassicRenderer(
  store: Awaited<ReturnType<typeof getStore>>,
  projects: Project[],
  settings: GlobalSettings
): Promise<{ projects: Project[]; settings: GlobalSettings }> {
  if (settings.classicRendererMigrated) return { projects, settings };
  const nextSettings: GlobalSettings = {
    ...settings,
    ideRenderer: "classic",
    classicRendererMigrated: true,
  };
  const nextProjects = projects.map((p) => {
    if (p.ideRenderer !== "fullscreen") return p;
    const { ideRenderer: _drop, ...rest } = p;
    return rest;
  });
  await store.set("settings", mirrorToLegacy(nextSettings));
  await store.set("projects", nextProjects);
  return { projects: nextProjects, settings: nextSettings };
}

export async function loadAppData(): Promise<AppData> {
  try {
    const store = await getStore();
    const storedProjects = await store.get<Project[]>("projects");
    const storedSettings = await store.get<GlobalSettings>("settings");
    const { projects, settings } = storedSettings
      ? await migrateToClassicRenderer(
          store,
          storedProjects ?? DEFAULT_APP_DATA.projects,
          { ...DEFAULT_SETTINGS, ...storedSettings }
        )
      : {
          projects: storedProjects ?? DEFAULT_APP_DATA.projects,
          settings: { ...DEFAULT_SETTINGS, classicRendererMigrated: true },
        };
    return {
      projects,
      settings: migrateLegacySettings(settings),
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

/**
 * Generic key access for data beyond `projects`/`settings` — currently the
 * coding-benchmark rankings (`model_rankings`), which are cache rather than
 * user data and don't belong in the AppData type.
 */
export async function getStored<T>(key: string): Promise<T | null> {
  const store = await getStore();
  return (await store.get<T>(key)) ?? null;
}

export async function setStored<T>(key: string, value: T): Promise<void> {
  const store = await getStore();
  await store.set(key, value);
}
