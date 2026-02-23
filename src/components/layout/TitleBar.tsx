import { Settings } from "lucide-react";

interface TitleBarProps {
  onSettingsClick: () => void;
}

export default function TitleBar({ onSettingsClick }: TitleBarProps) {
  return (
    <div className="flex items-center justify-between px-6 py-4 border-b border-gray-800">
      <h1 className="text-xl font-bold text-white tracking-tight">
        Claude Launcher
      </h1>
      <button
        onClick={onSettingsClick}
        className="text-gray-400 hover:text-amber-400 transition-colors p-2 rounded-lg hover:bg-gray-800"
        title="Settings"
      >
        <Settings size={22} />
      </button>
    </div>
  );
}
