import { useState } from "react";
import Layout from "./components/layout/Layout";
import RecentCards from "./components/projects/RecentCards";
import ProjectList from "./components/projects/ProjectList";
import AddProjectDialog from "./components/projects/AddProjectDialog";
import SettingsModal from "./components/settings/SettingsModal";
import ProjectFlagsModal from "./components/settings/ProjectFlagsModal";
import { useProjects } from "./hooks/useProjects";
import { useSettings } from "./hooks/useSettings";
import { launchProject } from "./services/launcher";
import type { Project } from "./types";

export default function App() {
  const projectsHook = useProjects();
  const settingsHook = useSettings();
  const [showSettings, setShowSettings] = useState(false);
  const [showAddProject, setShowAddProject] = useState(false);
  const [editingProjectFlags, setEditingProjectFlags] = useState<string | null>(
    null
  );
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

  if (projectsHook.loading || settingsHook.loading) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center">
        <div className="text-gray-400 text-sm">Loading...</div>
      </div>
    );
  }

  const editingProject = editingProjectFlags
    ? projectsHook.projects.find((p) => p.id === editingProjectFlags)
    : null;

  return (
    <Layout onSettingsClick={() => setShowSettings(true)}>
      {/* Error toast */}
      {launchError && (
        <div className="bg-red-900/50 border border-red-700 rounded-lg px-4 py-3 text-sm text-red-200 flex items-center justify-between">
          <span>Launch failed: {launchError}</span>
          <button
            onClick={() => setLaunchError(null)}
            className="text-red-400 hover:text-red-200 ml-4"
          >
            Dismiss
          </button>
        </div>
      )}

      <RecentCards
        projects={projectsHook.recentProjects}
        onLaunch={handleLaunch}
      />

      <ProjectList
        projects={projectsHook.projects}
        sort={projectsHook.sort}
        onSortChange={projectsHook.setSort}
        onLaunch={handleLaunch}
        onEditFlags={setEditingProjectFlags}
        onRemove={projectsHook.removeProject}
        onAddProject={() => setShowAddProject(true)}
      />

      {showAddProject && (
        <AddProjectDialog
          onAdd={projectsHook.addProject}
          onClose={() => setShowAddProject(false)}
        />
      )}

      {showSettings && settingsHook.settings && (
        <SettingsModal
          settings={settingsHook.settings}
          onUpdateSettings={settingsHook.updateSettings}
          onToggleGlobalFlag={settingsHook.toggleGlobalFlag}
          onAddCustomFlag={settingsHook.addCustomFlag}
          onRemoveCustomFlag={settingsHook.removeCustomFlag}
          onClose={() => setShowSettings(false)}
        />
      )}

      {editingProject && settingsHook.settings && (
        <ProjectFlagsModal
          project={editingProject}
          settings={settingsHook.settings}
          onSave={(overrides) =>
            projectsHook.updateFlagOverrides(editingProject.id, overrides)
          }
          onClose={() => setEditingProjectFlags(null)}
        />
      )}
    </Layout>
  );
}
