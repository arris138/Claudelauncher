import { open } from "@tauri-apps/plugin-shell";
import { Download } from "lucide-react";

interface StatusBarProps {
  currentVersion: string;
  updateAvailable: boolean;
  latestVersion: string | null;
  releaseUrl: string | null;
}

export default function StatusBar({
  currentVersion,
  updateAvailable,
  latestVersion,
  releaseUrl,
}: StatusBarProps) {
  return (
    <div className="flex items-center justify-between px-6 py-2 border-t border-gray-800 text-xs text-gray-500">
      <div>
        {updateAvailable && releaseUrl && (
          <button
            onClick={() => open(releaseUrl)}
            className="inline-flex items-center gap-1.5 text-amber-400 hover:text-amber-300 transition-colors"
          >
            <Download size={12} />
            Update available: v{latestVersion}
          </button>
        )}
      </div>
      <span>v{currentVersion}</span>
    </div>
  );
}
