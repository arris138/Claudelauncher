import TitleBar from "./TitleBar";
import StatusBar from "./StatusBar";
import type { UpdateState } from "../../hooks/useUpdateChecker";

interface LayoutProps {
  onSettingsClick: () => void;
  updateInfo?: UpdateState;
  children: React.ReactNode;
}

export default function Layout({ onSettingsClick, updateInfo, children }: LayoutProps) {
  return (
    <div className="min-h-screen bg-gray-900 text-gray-100 flex flex-col">
      <TitleBar onSettingsClick={onSettingsClick} />
      <main className="flex-1 overflow-y-auto px-6 py-4 space-y-6">
        {children}
      </main>
      {updateInfo && <StatusBar {...updateInfo} />}
    </div>
  );
}
