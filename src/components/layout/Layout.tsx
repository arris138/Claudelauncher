import TitleBar from "./TitleBar";

interface LayoutProps {
  onSettingsClick: () => void;
  children: React.ReactNode;
}

export default function Layout({ onSettingsClick, children }: LayoutProps) {
  return (
    <div className="min-h-screen bg-gray-900 text-gray-100 flex flex-col">
      <TitleBar onSettingsClick={onSettingsClick} />
      <main className="flex-1 overflow-y-auto px-6 py-4 space-y-6">
        {children}
      </main>
    </div>
  );
}
