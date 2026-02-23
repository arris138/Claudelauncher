import { useState, useEffect, useCallback } from "react";
import type { GlobalSettings } from "../types";
import { loadAppData, saveSettings } from "../services/store";
import { detectClaudePath } from "../services/launcher";

export function useSettings() {
  const [settings, setSettings] = useState<GlobalSettings | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const data = await loadAppData();
      let s = data.settings;
      if (s.claudePath === "claude") {
        try {
          const detected = await detectClaudePath();
          s = { ...s, claudePath: detected };
          await saveSettings(s);
        } catch {
          /* keep default */
        }
      }
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
    async (flagName: string) => {
      if (!settings) return;
      const updated = {
        ...settings,
        globalFlags: settings.globalFlags.map((gf) =>
          gf.flagName === flagName ? { ...gf, enabled: !gf.enabled } : gf
        ),
      };
      setSettings(updated);
      await saveSettings(updated);
    },
    [settings]
  );

  const addCustomFlag = useCallback(
    async (flag: string) => {
      if (!settings) return;
      if (settings.customFlags.includes(flag)) return;
      const updated = {
        ...settings,
        customFlags: [...settings.customFlags, flag],
      };
      setSettings(updated);
      await saveSettings(updated);
    },
    [settings]
  );

  const removeCustomFlag = useCallback(
    async (flag: string) => {
      if (!settings) return;
      const updated = {
        ...settings,
        customFlags: settings.customFlags.filter((f) => f !== flag),
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
