import { useState, useEffect, useCallback } from "react";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

const CURRENT_VERSION = __APP_VERSION__;

export interface UpdateState {
  currentVersion: string;
  latestVersion: string | null;
  updateAvailable: boolean;
  checking: boolean;
  downloading: boolean;
  progress: number; // 0-100
  error: string | null;
  install: (() => Promise<void>) | null;
}

export function useUpdateChecker() {
  const [state, setState] = useState<UpdateState>({
    currentVersion: CURRENT_VERSION,
    latestVersion: null,
    updateAvailable: false,
    checking: true,
    downloading: false,
    progress: 0,
    error: null,
    install: null,
  });

  const startUpdate = useCallback((update: Update) => {
    return async () => {
      setState((s) => ({ ...s, downloading: true, progress: 0, error: null }));
      try {
        let totalBytes = 0;
        let downloadedBytes = 0;

        await update.downloadAndInstall((event) => {
          if (event.event === "Started") {
            totalBytes = event.data.contentLength ?? 0;
          } else if (event.event === "Progress") {
            downloadedBytes += event.data.chunkLength;
            const pct = totalBytes > 0 ? Math.round((downloadedBytes / totalBytes) * 100) : 0;
            setState((s) => ({ ...s, progress: pct }));
          } else if (event.event === "Finished") {
            setState((s) => ({ ...s, progress: 100 }));
          }
        });

        await relaunch();
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setState((s) => ({ ...s, downloading: false, error: message }));
      }
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function checkForUpdate() {
      try {
        const update = await check();
        if (cancelled) return;

        if (update) {
          setState((s) => ({
            ...s,
            latestVersion: update.version,
            updateAvailable: true,
            checking: false,
            install: startUpdate(update),
          }));
        } else {
          setState((s) => ({ ...s, checking: false }));
        }
      } catch {
        if (!cancelled) {
          setState((s) => ({ ...s, checking: false }));
        }
      }
    }

    checkForUpdate();
    return () => { cancelled = true; };
  }, [startUpdate]);

  return state;
}
