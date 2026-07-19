import { useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { FolderOpen } from "lucide-react";
import Modal from "../shared/Modal";
import ColorPicker from "./ColorPicker";
import { agentGlobalFlags, agentCustomFlags } from "../../utils/flags";
import { PROJECT_COLORS } from "../../utils/colors";
import { ALL_AGENTS, getAgent } from "../../agents/registry";
import type {
  Project,
  GlobalSettings,
  FlagOverrides,
  IdeRenderer,
  AgentId,
} from "../../types";

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
    changes: {
      name: string;
      path: string;
      agentId: AgentId;
      flagOverrides: FlagOverrides;
      preLaunchCommand?: string;
      color?: string;
      tabTitle?: string;
      dynamicTitle?: boolean;
      modelInTitle?: boolean;
      model?: string;
      ideRenderer?: IdeRenderer;
    }
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
  const [color, setColor] = useState(project.color ?? PROJECT_COLORS[0]);
  const [tabTitle, setTabTitle] = useState(project.tabTitle ?? "");
  const [dynamicTitle, setDynamicTitle] = useState(project.dynamicTitle ?? false);
  const [modelInTitle, setModelInTitle] = useState(project.modelInTitle ?? false);
  const [agentId, setAgentId] = useState<AgentId>(getAgent(project.agentId).id);
  const [model, setModel] = useState(
    project.model ?? getAgent(project.agentId).defaultModel
  );
  const [ideRenderer, setIdeRenderer] = useState<IdeRenderer | "global">(
    project.ideRenderer ?? "global"
  );

  const agent = getAgent(agentId);

  const allFlags = [
    ...agentGlobalFlags(settings, agentId).map((gf) => ({
      name: gf.flagName,
      globalEnabled: gf.enabled,
    })),
    ...agentCustomFlags(settings, agentId).map((f) => ({
      name: f,
      globalEnabled: true,
    })),
  ];

  /**
   * Flag overrides are keyed by flag name and the model is an agent-specific
   * id, so both are meaningless under a different agent. Clear them rather than
   * carry values the new agent will never match. Title options that depend on a
   * capability the new agent lacks are cleared too, so a stale `true` can't
   * suppress title behaviour later.
   */
  function handleAgentChange(next: AgentId) {
    const nextAgent = getAgent(next);
    setAgentId(next);
    setOverrides({});
    setModel(nextAgent.defaultModel);
    if (!nextAgent.capabilities.modelInTitle) setModelInTitle(false);
  }

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
    onSave(project.id, {
      name: name.trim() || path.split(/[/\\]/).filter(Boolean).pop() || path,
      path: path.trim(),
      agentId,
      flagOverrides: overrides,
      preLaunchCommand: preLaunchCommand.trim() || undefined,
      color,
      tabTitle: tabTitle.trim() || undefined,
      dynamicTitle,
      modelInTitle,
      model,
      ideRenderer: ideRenderer === "global" ? undefined : ideRenderer,
    });
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

        <div>
          <label className="block text-sm font-medium text-gray-300 mb-1.5">
            Tab Color
          </label>
          <ColorPicker value={color} onChange={setColor} />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-300 mb-1">
            Tab Title
          </label>
          <input
            type="text"
            value={tabTitle}
            onChange={(e) => setTabTitle(e.target.value)}
            placeholder={name.trim() || "Defaults to project name"}
            className="w-full bg-gray-900 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white
                       placeholder-gray-500 focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500"
          />
          <p className="text-xs text-gray-500 mt-1">
            Shown as the terminal window/tab title. Leave blank to use the project name.
          </p>
          <label className="flex items-center gap-2 cursor-pointer select-none mt-2">
            <input
              type="checkbox"
              checked={dynamicTitle}
              onChange={(e) => setDynamicTitle(e.target.checked)}
              className="w-4 h-4 rounded border-gray-600 bg-gray-900 text-amber-500
                         focus:ring-amber-500 focus:ring-offset-0 cursor-pointer accent-amber-500"
            />
            <span className="text-sm text-gray-300">Use Claude's dynamic titles</span>
            <span className="text-xs text-gray-500">
              (Claude's status text replaces the tab title)
            </span>
          </label>
          {agent.capabilities.modelInTitle && (
            <>
              <label className="flex items-center gap-2 cursor-pointer select-none mt-2">
                <input
                  type="checkbox"
                  checked={modelInTitle}
                  onChange={(e) => setModelInTitle(e.target.checked)}
                  className="w-4 h-4 rounded border-gray-600 bg-gray-900 text-amber-500
                             focus:ring-amber-500 focus:ring-offset-0 cursor-pointer accent-amber-500"
                />
                <span className="text-sm text-gray-300">Show live model in tab title</span>
              </label>
              <p className="text-xs text-gray-500 mt-1 ml-6">
                Keeps the tab as <span className="font-mono">&quot;{(tabTitle.trim() || name.trim() || "Project")} — Opus&quot;</span> and
                updates it whenever you swap models mid-session. Requires the statusline
                installed once from Settings → Sound &amp; Status. Overrides the fixed title above.
              </p>
            </>
          )}
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-300 mb-1">
            Agent
          </label>
          <select
            value={agentId}
            onChange={(e) => handleAgentChange(e.target.value as AgentId)}
            className="w-full bg-gray-900 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white
                       focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500"
          >
            {ALL_AGENTS.map((a) => (
              <option key={a.id} value={a.id}>
                {a.label}
              </option>
            ))}
          </select>
          {agentId !== getAgent(project.agentId).id && (
            <p className="text-xs text-amber-400/80 mt-1">
              Switching agent clears this project&apos;s flag overrides and resets its model.
            </p>
          )}
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-300 mb-1">
            Model
          </label>
          <select
            value={model}
            onChange={(e) => setModel(e.target.value)}
            className="w-full bg-gray-900 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white
                       focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500"
          >
            {agent.models.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        {/* IDE Terminal Renderer */}
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-1">
            IDE Terminal Renderer
          </label>
          <select
            value={ideRenderer}
            onChange={(e) =>
              setIdeRenderer(e.target.value as IdeRenderer | "global")
            }
            className="w-full bg-gray-900 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white
                       focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500"
          >
            <option value="global">
              Global ({settings.ideRenderer === "classic" ? "Classic" : "Fullscreen"})
            </option>
            <option value="fullscreen">Fullscreen TUI (new)</option>
            <option value="classic">Classic (scrollback)</option>
          </select>
          <p className="text-xs text-gray-500 mt-1">
            Renderer for this project's IDE-mode sessions. Only affects embedded
            IDE Mode, not Windows Terminal launches.
          </p>
        </div>

        {/* Pre-Launch Command */}
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-1">
            Pre-Launch Command
          </label>
          <p className="text-xs text-gray-500 mb-2">
            Runs in the terminal before {agent.label} starts. Use for welcome scripts, environment setup, etc.
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
              const def = agent.flags.find((f) => f.name === flagName);
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
