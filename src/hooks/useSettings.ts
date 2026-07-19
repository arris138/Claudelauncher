import { useState, useEffect, useCallback } from "react";
import type { GlobalSettings, AgentId } from "../types";
import { loadAppData, saveSettings } from "../services/store";
import { detectAgentPath } from "../services/launcher";
import { ALL_AGENTS } from "../agents/registry";
import { agentGlobalFlags, agentCustomFlags } from "../utils/flags";

export function useSettings() {
  const [settings, setSettings] = useState<GlobalSettings | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const data = await loadAppData();
      let s = data.settings;

      // Auto-detect a path for any agent still sitting on its bare command
      // name, so a freshly installed agent is usable without visiting Settings.
      let changed = false;
      for (const agent of ALL_AGENTS) {
        const configured = s.agentPaths?.[agent.id];
        if (configured && configured !== agent.defaultBinary) continue;
        try {
          const detected = await detectAgentPath(agent.id);
          s = { ...s, agentPaths: { ...s.agentPaths, [agent.id]: detected } };
          changed = true;
        } catch {
          /* leave it on the bare command name and let PATH resolve it */
        }
      }
      if (changed) await saveSettings(s);

      setSettings(s);
      setLoading(false);
    })();
  }, []);

  const updateSettings = useCallback(
    async (partial: Partial<GlobalSettings>) => {
      if (!settings) return;
      const updated = { ...settings, ...partial };
      setSettings(updated);
      await saveSettings(updated);
    },
    [settings]
  );

  const toggleGlobalFlag = useCallback(
    async (agentId: AgentId, flagName: string) => {
      if (!settings) return;
      // Read through agentGlobalFlags so a flag added to an agent definition
      // after the user last saved is still togglable.
      const current = agentGlobalFlags(settings, agentId);
      const updated = {
        ...settings,
        agentFlags: {
          ...settings.agentFlags,
          [agentId]: current.map((gf) =>
            gf.flagName === flagName ? { ...gf, enabled: !gf.enabled } : gf
          ),
        },
      };
      setSettings(updated);
      await saveSettings(updated);
    },
    [settings]
  );

  const addCustomFlag = useCallback(
    async (agentId: AgentId, flag: string) => {
      if (!settings) return;
      const current = agentCustomFlags(settings, agentId);
      if (current.includes(flag)) return;
      const updated = {
        ...settings,
        agentCustomFlags: {
          ...settings.agentCustomFlags,
          [agentId]: [...current, flag],
        },
      };
      setSettings(updated);
      await saveSettings(updated);
    },
    [settings]
  );

  const removeCustomFlag = useCallback(
    async (agentId: AgentId, flag: string) => {
      if (!settings) return;
      const updated = {
        ...settings,
        agentCustomFlags: {
          ...settings.agentCustomFlags,
          [agentId]: agentCustomFlags(settings, agentId).filter(
            (f) => f !== flag
          ),
        },
      };
      setSettings(updated);
      await saveSettings(updated);
    },
    [settings]
  );

  return {
    settings,
    loading,
    updateSettings,
    toggleGlobalFlag,
    addCustomFlag,
    removeCustomFlag,
  };
}
