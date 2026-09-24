import { useState, useEffect } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { open as shellOpen } from "@tauri-apps/plugin-shell";
import { invoke } from "@tauri-apps/api/core";
import { FolderOpen, Plus, X, FileText, RefreshCw, Bell, Tag } from "lucide-react";
import Modal from "../shared/Modal";
import FlagToggle from "./FlagToggle";
import { agentGlobalFlags, agentCustomFlags, agentPath, globalEffort } from "../../utils/flags";
import EffortField from "../projects/EffortField";
import { ALL_AGENTS, getAgent, DEFAULT_AGENT_ID } from "../../agents/registry";
import { getLogPath, readLog, openLogFolder } from "../../services/log";
import { hasProjectSecret, setProjectSecret } from "../../services/secrets";
import {
  OPENROUTER_DEFAULT_REF,
  OPENROUTER_MANAGEMENT_REF,
} from "../../services/openrouterUsage";
import type { GlobalSettings, AgentId } from "../../types";

interface SettingsModalProps {
  settings: GlobalSettings;
  onUpdateSettings: (partial: Partial<GlobalSettings>) => void;
  onToggleGlobalFlag: (agentId: AgentId, flagName: string) => void;
  onAddCustomFlag: (agentId: AgentId, flag: string) => void;
  onRemoveCustomFlag: (agentId: AgentId, flag: string) => void;
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
  const [agentId, setAgentId] = useState<AgentId>(DEFAULT_AGENT_ID);
  const [logPath, setLogPath] = useState("");
  const [logContent, setLogContent] = useState("");
  const [logLoading, setLogLoading] = useState(false);
  const [terminalProfiles, setTerminalProfiles] = useState<string[]>([]);
  const [chimeBusy, setChimeBusy] = useState(false);
  const [chimeStatus, setChimeStatus] = useState<{ ok: boolean; message: string } | null>(null);
  const [codexNotifyBusy, setCodexNotifyBusy] = useState(false);
  const [codexNotifyStatus, setCodexNotifyStatus] = useState<{ ok: boolean; message: string } | null>(null);
  const [statuslineBusy, setStatuslineBusy] = useState(false);
  const [statuslineStatus, setStatuslineStatus] = useState<{ ok: boolean; message: string } | null>(null);

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

  const agent = getAgent(agentId);

  function setAgentPath(value: string) {
    onUpdateSettings({
      agentPaths: { ...settings.agentPaths, [agentId]: value },
    });
  }

  async function handleBrowseAgent() {
    const selected = await open({
      multiple: false,
      filters: [{ name: "Executable", extensions: ["exe", "cmd", "*"] }],
    });
    if (selected) {
      setAgentPath(selected as string);
    }
  }

  async function handleInstallChimes() {
    setChimeBusy(true);
    setChimeStatus(null);
    try {
      const message = await invoke<string>("install_chime_hooks");
      setChimeStatus({ ok: true, message });
    } catch (e) {
      setChimeStatus({ ok: false, message: String(e) });
    }
    setChimeBusy(false);
  }

  async function handleInstallCodexNotify() {
    setCodexNotifyBusy(true);
    setCodexNotifyStatus(null);
    try {
      const message = await invoke<string>("install_codex_notify");
      setCodexNotifyStatus({ ok: true, message });
    } catch (e) {
      setCodexNotifyStatus({ ok: false, message: String(e) });
    }
    setCodexNotifyBusy(false);
  }

  async function handleInstallStatusline() {
    setStatuslineBusy(true);
    setStatuslineStatus(null);
    try {
      const message = await invoke<string>("install_model_title_statusline");
      setStatuslineStatus({ ok: true, message });
    } catch (e) {
      setStatuslineStatus({ ok: false, message: String(e) });
    }
    setStatuslineBusy(false);
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
    onAddCustomFlag(agentId, formatted);
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
          {/* Agent selector — scopes the path and flag sections below */}
          <div className="flex gap-1 p-1 bg-gray-900 rounded-lg">
            {ALL_AGENTS.map((a) => (
              <button
                key={a.id}
                onClick={() => setAgentId(a.id)}
                className={`flex-1 px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                  agentId === a.id
                    ? "bg-gray-700 text-amber-400"
                    : "text-gray-400 hover:text-gray-200"
                }`}
              >
                {a.label}
              </button>
            ))}
          </div>

          {/* Shared-quota note. The launcher's whole premise is many parallel
              sessions, which is weaker for agents billed from one rolling
              window — worth saying plainly rather than letting it surprise. */}
          {agent.id === "codex" && (
            <p className="text-xs text-gray-500 border-l-2 border-gray-700 pl-3">
              Codex CLI, web and IDE usage all draw on the same rolling usage
              window for your ChatGPT plan. Parallel Codex sessions compete for
              one allowance rather than getting one each.
            </p>
          )}

          {/* Agent Path */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">
              {agent.label} Path
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={agentPath(settings, agentId)}
                onChange={(e) => setAgentPath(e.target.value)}
                placeholder={agent.defaultBinary}
                className="flex-1 bg-gray-900 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white font-mono
                           placeholder-gray-600 placeholder:italic
                           focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500"
              />
              <button
                onClick={handleBrowseAgent}
                className="px-3 py-2 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded-lg transition-colors"
              >
                <FolderOpen size={16} />
              </button>
            </div>
            <p className="text-xs text-gray-500 mt-1 italic">
              Full path to the {agent.defaultBinary} executable. Leave as{" "}
              <span className="font-mono not-italic">{agent.defaultBinary}</span> to
              resolve it from PATH.
            </p>
          </div>

          {/* Default reasoning effort — projects follow this unless they pick their own */}
          {agent.efforts && (
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">
                Default Reasoning Effort
              </label>
              <EffortField
                agent={agent}
                value={globalEffort(settings, agent)}
                onChange={(next) =>
                  onUpdateSettings({
                    agentEffort: { ...settings.agentEffort, [agentId]: next },
                  })
                }
                help={`Applies to every ${agent.label} project and every model, unless a project sets its own in Edit Project. "No override" sends nothing and leaves ${agent.label}'s own config in charge.`}
              />
            </div>
          )}

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

          {/* IDE Terminal Renderer */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">
              IDE Terminal Renderer
            </label>
            <select
              value={settings.ideRenderer ?? "fullscreen"}
              onChange={(e) =>
                onUpdateSettings({
                  ideRenderer: e.target.value as GlobalSettings["ideRenderer"],
                })
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
              <option value="fullscreen">Fullscreen TUI (new)</option>
              <option value="classic">Classic (scrollback)</option>
            </select>
            <p className="text-xs text-gray-500 mt-1">
              How embedded IDE-mode sessions render. Fullscreen uses Claude's
              alt-screen TUI (pinned input, mouse support); Classic keeps the
              scrollback renderer. Per-project overrides win over this.
            </p>
          </div>

          {/* IDE GPU renderer */}
          <div>
            <FlagToggle
              label="GPU terminal renderer (WebGL)"
              description="Faster IDE-terminal drawing, but prone to stale/garbled glyphs under WebView2. Off uses the DOM renderer (recommended). Applies to newly opened sessions."
              enabled={settings.ideGpu ?? false}
              onToggle={() => onUpdateSettings({ ideGpu: !settings.ideGpu })}
            />
          </div>

          {/* Turn-completion callback (Codex-style notify) */}
          {agent.capabilities.notifyHook && (
            <div>
              <FlagToggle
                label="Turn-completion callback (experimental)"
                description={`Chime when ${agent.label} finishes a turn, in terminal tabs and IDE sessions, and show a real "complete" status in IDE mode instead of guessing from output. Passed per-launch — your ~/.codex/config.toml is never modified. Untested against a live turn: if nothing happens, turn it back off. There is no equivalent event for "needs input", so ${agent.label} sessions never blink for approval.`}
                enabled={settings.agentNotifyHook ?? false}
                onToggle={() =>
                  onUpdateSettings({
                    agentNotifyHook: !settings.agentNotifyHook,
                  })
                }
              />
              <button
                onClick={handleInstallCodexNotify}
                disabled={codexNotifyBusy}
                className="mt-2 flex items-center gap-2 px-3 py-2 bg-amber-600 hover:bg-amber-500 text-white text-sm font-medium rounded-lg transition-colors
                           disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Bell size={15} className={codexNotifyBusy ? "animate-pulse" : ""} />
                {codexNotifyBusy ? "Installing…" : `Install ${agent.label} chime`}
              </button>
              {codexNotifyStatus && (
                <p
                  className={`text-xs mt-2 ${
                    codexNotifyStatus.ok ? "text-green-400" : "text-red-400"
                  }`}
                >
                  {codexNotifyStatus.message}
                </p>
              )}
            </div>
          )}

          {/* Global Flags */}
          <div>
            <h3 className="text-sm font-medium text-gray-300 mb-2">
              {agent.label} Global Flags
            </h3>
            <div className="space-y-1">
              {agentGlobalFlags(settings, agentId).map((gf) => {
                const def = agent.flags.find((f) => f.name === gf.flagName);
                return (
                  <FlagToggle
                    key={gf.flagName}
                    label={def?.label ?? gf.flagName}
                    description={def?.description ?? gf.flagName}
                    enabled={gf.enabled}
                    onToggle={() => onToggleGlobalFlag(agentId, gf.flagName)}
                  />
                );
              })}
            </div>
          </div>

          {/* Custom Flags */}
          <div>
            <h3 className="text-sm font-medium text-gray-300 mb-2">
              {agent.label} Custom Flags
            </h3>
            {agentCustomFlags(settings, agentId).length > 0 && (
              <div className="space-y-1 mb-3">
                {agentCustomFlags(settings, agentId).map((flag) => (
                  <div
                    key={flag}
                    className="flex items-center justify-between py-1.5 px-3 bg-gray-900 rounded-lg"
                  >
                    <span className="text-sm text-white font-mono">
                      {flag}
                    </span>
                    <button
                      onClick={() => onRemoveCustomFlag(agentId, flag)}
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

          {/* Sound Notifications — hidden for agents with no chime mechanism */}
          {agent.capabilities.chimes && (
          <div>
            <h3 className="text-sm font-medium text-gray-300 mb-2">
              Sound Notifications
            </h3>
            <p className="text-xs text-gray-500 mb-3">
              Installs chime sounds and Claude Code hooks on this machine: a
              single chirp when Claude finishes, and a faster double-chirp when
              it pauses to ask you a question or for permission. Re-run on each
              machine you use.
            </p>
            <button
              onClick={handleInstallChimes}
              disabled={chimeBusy}
              className="flex items-center gap-2 px-3 py-2 bg-amber-600 hover:bg-amber-500 text-white text-sm font-medium rounded-lg transition-colors
                         disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Bell size={15} className={chimeBusy ? "animate-pulse" : ""} />
              {chimeBusy ? "Installing…" : "Install chimes on this machine"}
            </button>
            {chimeStatus && (
              <p
                className={`text-xs mt-2 ${
                  chimeStatus.ok ? "text-green-400" : "text-red-400"
                }`}
              >
                {chimeStatus.message}
              </p>
            )}
          </div>
          )}

          {/* Live model in tab title */}
          {agent.capabilities.modelInTitle && (
          <div>
            <h3 className="text-sm font-medium text-gray-300 mb-2">
              Live Model in Tab Title
            </h3>
            <p className="text-xs text-gray-500 mb-3">
              Installs a Claude Code statusline on this machine that keeps each
              tab titled <span className="font-mono">&quot;Project — Model&quot;</span> and
              updates it the moment you swap models with{" "}
              <span className="font-mono">/model</span>. Any existing statusline
              is preserved and shown alongside. Enable &quot;Show live model in
              tab title&quot; per project, then re-run on each machine you use.
            </p>
            <button
              onClick={handleInstallStatusline}
              disabled={statuslineBusy}
              className="flex items-center gap-2 px-3 py-2 bg-amber-600 hover:bg-amber-500 text-white text-sm font-medium rounded-lg transition-colors
                         disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Tag size={15} className={statuslineBusy ? "animate-pulse" : ""} />
              {statuslineBusy ? "Installing…" : "Install model-in-title statusline"}
            </button>
            {statuslineStatus && (
              <p
                className={`text-xs mt-2 ${
                  statuslineStatus.ok ? "text-green-400" : "text-red-400"
                }`}
              >
                {statuslineStatus.message}
              </p>
            )}
          </div>
          )}

          {/* The one API key every OpenRouter session launches with, plus the
              optional management key for the account roll-up chip. Scoped to
              the agent that talks to OpenRouter. */}
          {agentId === "openrouter" && agent.secretHelp && (
          <div>
            <h3 className="text-sm font-medium text-gray-300 mb-2">
              OpenRouter keys
            </h3>
            <p className="text-xs text-gray-500 mb-2">
              One <span className="font-mono">API key</span> for every
              OpenRouter session, including projects you add later. Stored in
              the Windows Credential Manager, passed to the session as{" "}
              <span className="font-mono">{agent.secretEnvVar}</span>, and
              never read back into this window.{" "}
              <button
                type="button"
                onClick={() => shellOpen(agent.secretHelp!.url).catch(() => {})}
                className="text-amber-500 hover:text-amber-400 underline"
              >
                Get a key
              </button>
            </p>
            <SecretField
              reference={OPENROUTER_DEFAULT_REF}
              placeholder={agent.secretHelp.placeholder}
              storedText="API key stored in Windows Credential Manager"
              saveMsg="API key stored. Every OpenRouter session will use it."
              removeMsg="API key removed. OpenRouter sessions will fail to authenticate until you store one again."
            />
            <p className="text-xs text-gray-500 mt-3 mb-2">
              Optional. A <span className="font-mono">management key</span>{" "}
              from the OpenRouter keys page lets the launcher chip report a
              rolling 14-day spend and the true account balance. Without one
              the chip falls back to this week from the API key. Sessions never
              use the management key; it only reads numbers.
            </p>
            <SecretField
              reference={OPENROUTER_MANAGEMENT_REF}
              placeholder="om-… (management key, optional)"
              storedText="Management key stored in Windows Credential Manager"
              saveMsg="Management key stored."
              removeMsg="Management key removed."
            />
          </div>
          )}
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

/**
 * Write-only entry against an arbitrary credential reference, the same bargain
 * the old per-project `ApiKeyField` kept: stored in the Windows Credential
 * Manager under `reference`, probed for existence, never read back. Saving
 * replaces; clearing deletes (the secrets backend treats an empty value as a
 * delete).
 */
function SecretField({
  reference,
  placeholder,
  storedText,
  saveMsg,
  removeMsg,
}: {
  reference: string;
  placeholder: string;
  storedText: string;
  saveMsg: string;
  removeMsg: string;
}) {
  const [probe, setProbe] = useState(0);
  const [stored, setStored] = useState<boolean | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    hasProjectSecret(reference)
      .then((has) => !cancelled && setStored(has))
      .catch(() => !cancelled && setStored(null));
    return () => {
      cancelled = true;
    };
  }, [probe, reference]);

  async function write(value: string, success: string) {
    setBusy(true);
    setMsg(null);
    try {
      await setProjectSecret(reference, value);
      setDraft("");
      setProbe((p) => p + 1);
      setMsg({ ok: true, text: success });
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) });
    }
    setBusy(false);
  }

  return (
    <div>
      <div className="flex items-center gap-2">
        <div className="flex-1 flex items-center gap-2 bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-400">
          {stored && draft === "" ? (
            <>
              <span className="text-emerald-500">✓</span>
              <span>{storedText}</span>
            </>
          ) : (
            <input
              type="password"
              value={draft}
              autoComplete="off"
              spellCheck={false}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={placeholder}
              className="flex-1 bg-transparent text-white placeholder-gray-600 focus:outline-none font-mono text-sm"
            />
          )}
        </div>
        {stored && draft === "" ? (
          <>
            <button
              type="button"
              onClick={() => setDraft(" ")}
              className="px-3 py-2 text-sm rounded-lg border border-gray-600 text-gray-300 hover:bg-gray-800"
            >
              Replace
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => write("", removeMsg)}
              className="px-3 py-2 text-sm rounded-lg border border-gray-600 text-gray-300 hover:bg-gray-800 disabled:opacity-50"
            >
              Clear
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              disabled={busy || draft.trim() === ""}
              onClick={() => write(draft.trim(), saveMsg)}
              className="px-3 py-2 text-sm rounded-lg bg-amber-600 hover:bg-amber-500 text-white font-medium disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {busy ? "Saving…" : "Save"}
            </button>
            {stored && (
              <button
                type="button"
                onClick={() => setDraft("")}
                className="px-3 py-2 text-sm rounded-lg border border-gray-600 text-gray-300 hover:bg-gray-800"
              >
                Cancel
              </button>
            )}
          </>
        )}
      </div>
      {msg && (
        <p className={`text-xs mt-2 ${msg.ok ? "text-green-400" : "text-red-400"}`}>
          {msg.text}
        </p>
      )}
    </div>
  );
}
