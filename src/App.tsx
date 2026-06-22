import { useState, useEffect } from "react";
import Layout from "./components/layout/Layout";
import RecentCards from "./components/projects/RecentCards";
import ProjectList from "./components/projects/ProjectList";
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

  // IDE Mode hosts live PTY sessions inside its <Terminal> components, so it
  // must stay MOUNTED across a switch to the Launcher view — unmounting it
  // would tear down every terminal and kill every running session. We mount it
  // lazily on first entry and keep it alive afterwards, hiding it (CSS) when
  // the Launcher view is showing.
  const inIde = settingsHook.settings?.uiMode === "ide";
  const [ideMounted, setIdeMounted] = useState(inIde);
  useEffect(() => {
    if (inIde) setIdeMounted(true);
  }, [inIde]);

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

  const projectToEdit = editingProject
    ? projectsHook.projects.find((p) => p.id === editingProject)
    : null;

  // IDE Mode takes over the whole window with its own chrome. It stays mounted
  // once entered (sessions/terminals live inside it) and is hidden via the
  // `visible` flag while the Launcher view is up, so switching views never
  // kills running sessions.
  return (
    <>
      {ideMounted && settingsHook.settings && (
        <IdeView
          visible={inIde}
          projects={projectsHook.projects}
          settings={settingsHook.settings}
          onExitIde={() => settingsHook.updateSettings({ uiMode: "launcher" })}
          onLaunched={projectsHook.updateLastLaunched}
        />
      )}

      {!inIde && (
        <Layout
          onSettingsClick={() => setShowSettings(true)}
          updateInfo={updateInfo}
          onEnterIde={() => settingsHook.updateSettings({ uiMode: "ide" })}
        >
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
            onEdit={setEditingProject}
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

          {projectToEdit && settingsHook.settings && (
            <EditProjectDialog
              project={projectToEdit}
              settings={settingsHook.settings}
              onSave={projectsHook.updateProject}
              onClose={() => setEditingProject(null)}
            />
          )}
        </Layout>
      )}
    </>
  );
}
