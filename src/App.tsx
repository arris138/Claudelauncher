import { useState } from "react";
import AddProjectDialog from "./components/projects/AddProjectDialog";
import EditProjectDialog from "./components/projects/EditProjectDialog";
import SettingsModal from "./components/settings/SettingsModal";
import IdeView from "./components/ide/IdeView";
import { useProjects } from "./hooks/useProjects";
import { useSettings } from "./hooks/useSettings";
import { useUpdateChecker } from "./hooks/useUpdateChecker";
import { launchProject } from "./services/launcher";
import type { Project } from "./types";
import "./theme/chromeRust.css";

export default function App() {
  const projectsHook = useProjects();
  const settingsHook = useSettings();
  const updateInfo = useUpdateChecker();
  const [showSettings, setShowSettings] = useState(false);
  const [showAddProject, setShowAddProject] = useState(false);
  const [editingProject, setEditingProject] = useState<string | null>(null);
  const [launchError, setLaunchError] = useState<string | null>(null);

  async function handleLaunch(project: Project) {
    if (!settingsHook.settings) return;
    setLaunchError(null);
    try {
      const result = await launchProject(project, settingsHook.settings);
      if (result.success) {
        await projectsHook.updateLastLaunched(project.id);
      } else {
        setLaunchError(result.error ?? "Launch failed — check logs in Settings");
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setLaunchError(`Invoke error: ${message} — check logs in Settings`);
    }
  }

  if (projectsHook.loading || settingsHook.loading || !settingsHook.settings) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center">
        <div className="text-gray-400 text-sm">Loading...</div>
      </div>
    );
  }

  const projectToEdit = editingProject
    ? projectsHook.projects.find((p) => p.id === editingProject)
    : null;

  // One shell for both modes. It stays mounted for the life of the app —
  // sessions and their PTYs live inside it, so anything that unmounted it
  // would kill every running session. The Launcher/IDE toggle only swaps
  // which stage fills the frame.
  return (
    <>
      <IdeView
        mode={settingsHook.settings.uiMode}
        onSetMode={(uiMode) => settingsHook.updateSettings({ uiMode })}
        projects={projectsHook.projects}
        settings={settingsHook.settings}
        onLaunched={projectsHook.updateLastLaunched}
        onUpdateSettings={settingsHook.updateSettings}
        onOpenSettings={() => setShowSettings(true)}
        onAddProject={() => setShowAddProject(true)}
        recentProjects={projectsHook.recentProjects}
        sort={projectsHook.sort}
        updateInfo={updateInfo}
        launchError={launchError}
        onSortChange={projectsHook.setSort}
        onLaunchTerminal={handleLaunch}
        onEditProject={setEditingProject}
        onRemoveProject={projectsHook.removeProject}
        onDismissError={() => setLaunchError(null)}
      />

      {showAddProject && (
        <AddProjectDialog
          onAdd={projectsHook.addProject}
          onClose={() => setShowAddProject(false)}
        />
      )}

      {showSettings && (
        <SettingsModal
          settings={settingsHook.settings}
          onUpdateSettings={settingsHook.updateSettings}
          onToggleGlobalFlag={settingsHook.toggleGlobalFlag}
          onAddCustomFlag={settingsHook.addCustomFlag}
          onRemoveCustomFlag={settingsHook.removeCustomFlag}
          onClose={() => setShowSettings(false)}
        />
      )}

      {projectToEdit && (
        <EditProjectDialog
          project={projectToEdit}
          settings={settingsHook.settings}
          onSave={projectsHook.updateProject}
          onClose={() => setEditingProject(null)}
        />
      )}
    </>
  );
}
