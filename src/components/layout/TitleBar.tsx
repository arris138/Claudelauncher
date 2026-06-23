import { Settings, TerminalSquare, Terminal, SquareChevronRight } from "lucide-react";
import { launchShell } from "../../services/launcher";

interface TitleBarProps {
  onSettingsClick: () => void;
  onEnterIde?: () => void;
}

export default function TitleBar({ onSettingsClick, onEnterIde }: TitleBarProps) {
  return (
    <div className="flex items-center justify-between px-6 py-4 border-b border-gray-800">
      <h1 className="text-xl font-bold text-white tracking-tight">
        Claude Launcher
      </h1>
      <div className="flex items-center gap-2">
        <button
          onClick={() => void launchShell("cmd")}
          className="launcher-mode-btn flex items-center gap-2"
          title="Open a Command Prompt window in your home directory"
        >
          <SquareChevronRight size={15} />
          Cmd
        </button>
        <button
          onClick={() => void launchShell("pwsh")}
          className="launcher-mode-btn flex items-center gap-2"
          title="Open a PowerShell window in your home directory"
        >
          <Terminal size={15} />
          PowerShell
        </button>
        {onEnterIde && (
          <button
            onClick={onEnterIde}
            className="launcher-mode-btn flex items-center gap-2"
            title="Open the multi-session IDE command center"
          >
            <TerminalSquare size={15} />
            IDE Mode
          </button>
        )}
        <button
          onClick={onSettingsClick}
          className="text-gray-400 hover:text-amber-400 transition-colors p-2 rounded-lg hover:bg-gray-800"
          title="Settings"
        >
          <Settings size={22} />
        </button>
      </div>
    </div>
  );
}
