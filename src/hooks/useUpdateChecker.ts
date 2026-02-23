import { useState, useEffect } from "react";

const GITHUB_REPO = "arris138/Claudelauncher";
const CURRENT_VERSION = __APP_VERSION__;

interface UpdateState {
  currentVersion: string;
  latestVersion: string | null;
  updateAvailable: boolean;
  releaseUrl: string | null;
  checking: boolean;
}

function compareVersions(current: string, latest: string): boolean {
  const c = current.replace(/^v/, "").split(".").map(Number);
  const l = latest.replace(/^v/, "").split(".").map(Number);
  for (let i = 0; i < Math.max(c.length, l.length); i++) {
    const cv = c[i] ?? 0;
    const lv = l[i] ?? 0;
    if (lv > cv) return true;
    if (lv < cv) return false;
  }
  return false;
}

export function useUpdateChecker() {
  const [state, setState] = useState<UpdateState>({
    currentVersion: CURRENT_VERSION,
    latestVersion: null,
    updateAvailable: false,
    releaseUrl: null,
    checking: true,
  });

  useEffect(() => {
    let cancelled = false;

    async function check() {
      try {
        const resp = await fetch(
          `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`,
          { headers: { Accept: "application/vnd.github.v3+json" } }
        );
        if (!resp.ok) throw new Error(`GitHub API ${resp.status}`);
        const data = await resp.json();
        const tag: string = data.tag_name ?? "";
        const url: string = data.html_url ?? "";

        if (!cancelled) {
          setState({
            currentVersion: CURRENT_VERSION,
            latestVersion: tag.replace(/^v/, ""),
            updateAvailable: compareVersions(CURRENT_VERSION, tag),
            releaseUrl: url,
            checking: false,
          });
        }
      } catch {
        if (!cancelled) {
          setState((s) => ({ ...s, checking: false }));
        }
      }
    }

    check();
    return () => { cancelled = true; };
  }, []);

  return state;
}
