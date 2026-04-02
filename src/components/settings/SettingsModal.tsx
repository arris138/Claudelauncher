import { useState, useEffect } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import { FolderOpen, Plus, X, FileText, RefreshCw } from "lucide-react";
import Modal from "../shared/Modal";
import FlagToggle from "./FlagToggle";
import { BUILT_IN_FLAGS } from "../../utils/flags";
import { getLogPath, readLog, openLogFolder } from "../../services/log";
import type { GlobalSettings } from "../../types";

interface SettingsModalProps {
  settings: GlobalSettings;
  onUpdateSettings: (partial: Partial<GlobalSettings>) => void;
  onToggleGlobalFlag: (flagName: string) => void;
  onAddCustomFlag: (flag: string) => void;
  onRemoveCustomFlag: (flag: string) => void;
  onClose: () => void;
}

type SettingsTab = "general" | "logs";

export default function SettingsModal({
  settings,
  onUpdateSettings,
  onToggleGlobalFlag,
  onAddCustomFlag,
  onRemoveCustomFlag,
  onClose,
}: SettingsModalProps) {
  const [newFlag, setNewFlag] = useState("");
  const [tab, setTab] = useState<SettingsTab>("general");
  const [logPath, setLogPath] = useState("");
  const [logContent, setLogContent] = useState("");
  const [logLoading, setLogLoading] = useState(false);
  const [terminalProfiles, setTerminalProfiles] = useState<string[]>([]);

  useEffect(() => {
    getLogPath().then(setLogPath).catch(() => {});
    invoke<string[]>("list_terminal_profiles")
      .then(setTerminalProfiles)
      .catch(() => setTerminalProfiles(["PowerShell", "Command Prompt"]));
  }, []);

  async function handleLoadLog() {
    setLogLoading(true);
    try {
      const content = await readLog(200);
      setLogContent(content);
    } catch (e) {
      setLogContent(`Error reading log: ${e}`);
    }
    setLogLoading(false);
  }

  async function handleBrowseClaude() {
    const selected = await open({
      multiple: false,
      filters: [{ name: "Executable", extensions: ["exe", "*"] }],
    });
    if (selected) {
      onUpdateSettings({ claudePath: selected as string });
    }
  }

  function handleAddFlag(e: React.FormEvent) {
    e.preventDefault();
    const flag = newFlag.trim();
    if (!flag) return;
    const formatted = flag.startsWith("--") ? flag : `--${flag}`;
    // Validate flag: --name or --name=value, no shell metacharacters
    if (!/^--[a-zA-Z][a-zA-Z0-9-]*(=[^;|&`$(){}<>!\n\r]*)?$/.test(formatted)) {
      return;
    }
    onAddCustomFlag(formatted);
    setNewFlag("");
  }

  return (
    <Modal title="Settings" onClose={onClose}>
      {/* Tabs */}
      <div className="flex gap-1 mb-4 border-b border-gray-700 -mt-2">
        <button
          onClick={() => setTab("general")}
          className={`px-3 py-2 text-sm font-medium transition-colors border-b-2 ${
            tab === "general"
              ? "text-amber-400 border-amber-400"
              : "text-gray-400 border-transparent hover:text-gray-200"
          }`}
        >
          General
        </button>
        <button
          onClick={() => {
            setTab("logs");
            if (!logContent) handleLoadLog();
          }}
          className={`px-3 py-2 text-sm font-medium transition-colors border-b-2 flex items-center gap-1.5 ${
            tab === "logs"
              ? "text-amber-400 border-amber-400"
              : "text-gray-400 border-transparent hover:text-gray-200"
          }`}
        >
          <FileText size={14} />
          Logs
        </button>
      </div>

      {tab === "general" && (
        <div className="space-y-6">
          {/* Claude Path */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">
              Claude Path
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={settings.claudePath}
                onChange={(e) =>
                  onUpdateSettings({ claudePath: e.target.value })
                }
                placeholder="C:\Users\username\.local\bin\claude.exe"
                className="flex-1 bg-gray-900 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white font-mono
                           placeholder-gray-600 placeholder:italic
                           focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500"
              />
              <button
                onClick={handleBrowseClaude}
                className="px-3 py-2 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded-lg transition-colors"
              >
                <FolderOpen size={16} />
              </button>
            </div>
            <p className="text-xs text-gray-500 mt-1 italic">
              Full path to claude.exe (e.g., C:\Users\you\.local\bin\claude.exe)
            </p>
          </div>

          {/* Terminal Profile */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">
              Terminal Profile
            </label>
            <select
              value={settings.terminalProfile}
              onChange={(e) =>
                onUpdateSettings({ terminalProfile: e.target.value })
              }
              className="w-full bg-gray-900 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white
                         focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500
                         appearance-none cursor-pointer"
              style={{
                backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%239ca3af' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E")`,
                backgroundRepeat: "no-repeat",
                backgroundPosition: "right 12px center",
              }}
            >
              {terminalProfiles.map((profile) => (
                <option key={profile} value={profile}>
                  {profile}
                </option>
              ))}
              {settings.terminalProfile &&
                !terminalProfiles.includes(settings.terminalProfile) && (
                  <option value={settings.terminalProfile}>
                    {settings.terminalProfile}
                  </option>
                )}
            </select>
            <p className="text-xs text-gray-500 mt-1">
              Windows Terminal profile to use when launching sessions
            </p>
          </div>

          {/* Remote Control */}
          <div>
            <FlagToggle
              label="Remote Control"
              description="Launch sessions in remote control mode (claude remote-control)"
              enabled={settings.remoteControl ?? false}
              onToggle={() =>
                onUpdateSettings({ remoteControl: !settings.remoteControl })
              }
            />
          </div>

          {/* Global Flags */}
          <div>
            <h3 className="text-sm font-medium text-gray-300 mb-2">
              Global Flags
            </h3>
            <div className="space-y-1">
              {settings.globalFlags.map((gf) => {
                const def = BUILT_IN_FLAGS.find((f) => f.name === gf.flagName);
                return (
                  <FlagToggle
                    key={gf.flagName}
                    label={def?.label ?? gf.flagName}
                    description={def?.description ?? gf.flagName}
                    enabled={gf.enabled}
                    onToggle={() => onToggleGlobalFlag(gf.flagName)}
                  />
                );
              })}
            </div>
          </div>

          {/* Custom Flags */}
          <div>
            <h3 className="text-sm font-medium text-gray-300 mb-2">
              Custom Flags
            </h3>
            {settings.customFlags.length > 0 && (
              <div className="space-y-1 mb-3">
                {settings.customFlags.map((flag) => (
                  <div
                    key={flag}
                    className="flex items-center justify-between py-1.5 px-3 bg-gray-900 rounded-lg"
                  >
                    <span className="text-sm text-white font-mono">
                      {flag}
                    </span>
                    <button
                      onClick={() => onRemoveCustomFlag(flag)}
                      className="text-gray-500 hover:text-red-400 transition-colors p-0.5"
                    >
                      <X size={14} />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <form onSubmit={handleAddFlag} className="flex gap-2">
              <input
                type="text"
                value={newFlag}
                onChange={(e) => setNewFlag(e.target.value)}
                placeholder="--my-custom-flag"
                className="flex-1 bg-gray-900 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white font-mono
                           placeholder-gray-500 focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500"
              />
              <button
                type="submit"
                disabled={!newFlag.trim()}
                className="px-3 py-2 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded-lg transition-colors
                           disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Plus size={16} />
              </button>
            </form>
          </div>
        </div>
      )}

      {tab === "logs" && (
        <div className="space-y-4">
          {/* Log File Path */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">
              Log File Location
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={logPath}
                readOnly
                className="flex-1 bg-gray-900 border border-gray-600 rounded-lg px-3 py-2 text-xs text-gray-400 font-mono"
              />
              <button
                onClick={openLogFolder}
                className="px-3 py-2 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded-lg transition-colors"
                title="Open log folder in Explorer"
              >
                <FolderOpen size={16} />
              </button>
            </div>
          </div>

          {/* Log Viewer */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-medium text-gray-300">
                Recent Log Entries
              </h3>
              <button
                onClick={handleLoadLog}
                disabled={logLoading}
                className="flex items-center gap-1 text-xs text-amber-400 hover:text-amber-300 transition-colors"
              >
                <RefreshCw
                  size={12}
                  className={logLoading ? "animate-spin" : ""}
                />
                Refresh
              </button>
            </div>
            <pre className="bg-gray-950 border border-gray-700 rounded-lg p-3 text-xs text-gray-300 font-mono overflow-auto max-h-64 whitespace-pre-wrap">
              {logContent || "Click Refresh to load log entries."}
            </pre>
          </div>
        </div>
      )}
    </Modal>
  );
}
