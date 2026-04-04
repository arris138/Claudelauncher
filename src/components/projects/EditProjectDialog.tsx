import { useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { FolderOpen } from "lucide-react";
import Modal from "../shared/Modal";
import { BUILT_IN_FLAGS } from "../../utils/flags";
import type { Project, GlobalSettings, FlagOverrides } from "../../types";

type TriState = "global" | "on" | "off";

function getTriState(flagName: string, overrides: FlagOverrides): TriState {
  const val = overrides[flagName];
  if (val === undefined) return "global";
  return val ? "on" : "off";
}

function cycleTriState(current: TriState): TriState {
  if (current === "global") return "on";
  if (current === "on") return "off";
  return "global";
}

interface EditProjectDialogProps {
  project: Project;
  settings: GlobalSettings;
  onSave: (
    id: string,
    name: string,
    path: string,
    overrides: FlagOverrides,
    preLaunchCommand: string
  ) => void;
  onClose: () => void;
}

export default function EditProjectDialog({
  project,
  settings,
  onSave,
  onClose,
}: EditProjectDialogProps) {
  const [name, setName] = useState(project.name);
  const [path, setPath] = useState(project.path);
  const [overrides, setOverrides] = useState<FlagOverrides>({
    ...project.flagOverrides,
  });
  const [preLaunchCommand, setPreLaunchCommand] = useState(
    project.preLaunchCommand ?? ""
  );

  const allFlags = [
    ...settings.globalFlags.map((gf) => ({
      name: gf.flagName,
      globalEnabled: gf.enabled,
    })),
    ...settings.customFlags.map((f) => ({
      name: f,
      globalEnabled: true,
    })),
  ];

  function handleToggle(flagName: string) {
    const current = getTriState(flagName, overrides);
    const next = cycleTriState(current);
    const newOverrides = { ...overrides };
    if (next === "global") {
      delete newOverrides[flagName];
    } else {
      newOverrides[flagName] = next === "on";
    }
    setOverrides(newOverrides);
  }

  async function handleBrowse() {
    const selected = await open({ directory: true, multiple: false });
    if (selected) {
      setPath(selected as string);
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!path.trim()) return;
    onSave(
      project.id,
      name.trim() || path.split(/[/\\]/).filter(Boolean).pop() || path,
      path.trim(),
      overrides,
      preLaunchCommand.trim()
    );
    onClose();
  }

  return (
    <Modal title="Edit Project" onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-1">
            Project Name
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="My Project"
            className="w-full bg-gray-900 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white
                       placeholder-gray-500 focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-300 mb-1">
            Directory
          </label>
          <div className="flex gap-2">
            <input
              type="text"
              value={path}
              onChange={(e) => setPath(e.target.value)}
              placeholder="D:\Projects\my-project"
              className="flex-1 bg-gray-900 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white
                         placeholder-gray-500 focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500"
            />
            <button
              type="button"
              onClick={handleBrowse}
              className="px-3 py-2 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded-lg transition-colors flex items-center gap-1.5"
            >
              <FolderOpen size={16} />
              Browse
            </button>
          </div>
        </div>

        {/* Pre-Launch Command */}
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-1">
            Pre-Launch Command
          </label>
          <p className="text-xs text-gray-500 mb-2">
            Runs in the terminal before Claude starts. Use for welcome scripts, environment setup, etc.
          </p>
          <textarea
            value={preLaunchCommand}
            onChange={(e) => setPreLaunchCommand(e.target.value)}
            placeholder="e.g. bash T:/scripts/welcome.sh"
            rows={2}
            className="w-full bg-gray-900 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white font-mono
                       placeholder-gray-500 focus:border-amber-500 focus:ring-1 focus:ring-amber-500 resize-y"
          />
        </div>

        {/* Flags */}
        <div className="space-y-2">
          <p className="text-xs text-gray-400">
            Click to cycle: <span className="text-gray-500">Global</span> →{" "}
            <span className="text-green-400">On</span> →{" "}
            <span className="text-red-400">Off</span> → Global
          </p>

          {allFlags.length === 0 ? (
            <p className="text-sm text-gray-500 py-4 text-center">
              No flags configured. Add flags in Settings first.
            </p>
          ) : (
            allFlags.map(({ name: flagName, globalEnabled }) => {
              const state = getTriState(flagName, overrides);
              const def = BUILT_IN_FLAGS.find((f) => f.name === flagName);
              const effective =
                state === "global" ? globalEnabled : state === "on";

              return (
                <button
                  key={flagName}
                  type="button"
                  onClick={() => handleToggle(flagName)}
                  className="w-full flex items-center justify-between py-2 px-3 bg-gray-900 rounded-lg hover:bg-gray-800 transition-colors text-left"
                >
                  <div className="flex-1 mr-4">
                    <div className="text-sm text-white font-mono">
                      {def?.label ?? flagName}
                    </div>
                    <div className="text-xs text-gray-500 font-mono">{flagName}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span
                      className={`text-xs font-medium px-2 py-0.5 rounded ${
                        state === "global"
                          ? "bg-gray-700 text-gray-400"
                          : state === "on"
                          ? "bg-green-900/50 text-green-400"
                          : "bg-red-900/50 text-red-400"
                      }`}
                    >
                      {state === "global"
                        ? `Global (${globalEnabled ? "ON" : "OFF"})`
                        : state.toUpperCase()}
                    </span>
                    <span
                      className={`w-2 h-2 rounded-full ${
                        effective ? "bg-green-400" : "bg-gray-600"
                      }`}
                      title={effective ? "Will be active" : "Will be inactive"}
                    />
                  </div>
                </button>
              );
            })
          )}
        </div>

        <div className="flex justify-end gap-2 pt-2 border-t border-gray-700">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm text-gray-300 bg-gray-700 hover:bg-gray-600 rounded-lg transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!path.trim()}
            className="px-4 py-2 text-sm font-medium text-white bg-amber-600 hover:bg-amber-500
                       disabled:opacity-40 disabled:cursor-not-allowed rounded-lg transition-colors"
          >
            Save
          </button>
        </div>
      </form>
    </Modal>
  );
}
