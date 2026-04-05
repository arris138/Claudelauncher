import { Download, Loader2 } from "lucide-react";
import type { UpdateState } from "../../hooks/useUpdateChecker";

type StatusBarProps = UpdateState;

export default function StatusBar({
  currentVersion,
  updateAvailable,
  latestVersion,
  downloading,
  progress,
  error,
  install,
}: StatusBarProps) {
  return (
    <div className="flex items-center justify-between px-6 py-2 border-t border-gray-800 text-xs text-gray-500">
      <div>
        {error && (
          <span className="text-red-400">Update failed: {error}</span>
        )}
        {!error && downloading && (
          <span className="inline-flex items-center gap-1.5 text-amber-400">
            <Loader2 size={12} className="animate-spin" />
            Downloading update… {progress}%
          </span>
        )}
        {!error && !downloading && updateAvailable && install && (
          <button
            onClick={install}
            className="inline-flex items-center gap-1.5 text-amber-400 hover:text-amber-300 transition-colors"
          >
            <Download size={12} />
            Update available: v{latestVersion} — click to install
          </button>
        )}
      </div>
      <span>v{currentVersion}</span>
    </div>
  );
}
