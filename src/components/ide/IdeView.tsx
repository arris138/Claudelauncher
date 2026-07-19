import { useState, useEffect, useRef } from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { SquareChevronRight, Terminal as TerminalIcon } from "lucide-react";
import type { Project, GlobalSettings } from "../../types";
import {
  IDE_FONT_SIZE_DEFAULT,
  IDE_FONT_SIZE_MIN,
  IDE_FONT_SIZE_MAX,
} from "../../types";
import { useSessions } from "../../hooks/useSessions";
import { launchShell } from "../../services/launcher";
import { writePty, ensureIdeHooks } from "../../services/ide";
import SessionRail from "./SessionRail";
import Terminal from "./Terminal";
import FilesDrawer from "./FilesDrawer";
import JackInPicker from "./JackInPicker";
import { getAgent } from "../../agents/registry";

/** Tidy a model id for display ("claude-opus-4-8" -> "opus-4-8"). */
function modelLabel(model?: string): string {
  if (model === undefined || model === "") return "cli default";
  return model.replace(/^claude-/, "");
}

interface IdeViewProps {
  projects: Project[];
  settings: GlobalSettings;
  /** False while the Launcher view is showing — IDE stays mounted but hidden. */
  visible: boolean;
  onExitIde: () => void;
  onLaunched: (projectId: string) => void;
  onUpdateSettings: (partial: Partial<GlobalSettings>) => void;
}

/** Synthesize a launch target from a session when its source project is gone. */
function projectFor(
  projects: Project[],
  projectId: string,
  fallback: { id: string; name: string; cwd: string; color?: string; model?: string }
): Project {
  const found = projects.find((p) => p.id === projectId);
  if (found) return found;
  return {
    id: fallback.id,
    name: fallback.name,
    path: fallback.cwd,
    flagOverrides: {},
    createdAt: new Date(0).toISOString(),
    lastLaunchedAt: null,
    color: fallback.color,
    model: fallback.model,
  };
}

export default function IdeView({
  projects,
  settings,
  visible,
  onExitIde,
  onLaunched,
  onUpdateSettings,
}: IdeViewProps) {
  const {
    sessions,
    activeId,
    createSession,
    closeSession,
    focusSession,
    markActivity,
    markOutput,
    markWorking,
    setLiveModel,
    setSessionNote,
  } = useSessions();
  const [now, setNow] = useState(Date.now());
  const [showPicker, setShowPicker] = useState(false);
  const [filesOpen, setFilesOpen] = useState(false);
  const [railCollapsed, setRailCollapsed] = useState(false);

  // Terminal font size is global (every session, every agent) and persisted, so
  // it survives a restart the way the renderer and GPU settings do. Clamped
  // here rather than in the rail so any future caller gets the same bounds.
  const setFontSize = (next: number) => {
    const clamped = Math.min(
      IDE_FONT_SIZE_MAX,
      Math.max(IDE_FONT_SIZE_MIN, Math.round(next * 2) / 2)
    );
    onUpdateSettings({ ideFontSize: clamped });
  };
  const [confirm, setConfirm] = useState<null | "kill" | "clear">(null);
  // Bumped by the Refresh button; every Terminal watches it and forces a full
  // WebGL repaint to clear stale-glyph corruption (the manual counterpart to the
  // auto-repaint Terminal runs at each turn boundary).
  const [repaintNonce, setRepaintNonce] = useState(0);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  // Make sure the Stop/Notification → app hooks exist so the rail blinks and the
  // Working state ends precisely. Additive, idempotent; runs once per entry.
  //
  // These write Claude Code's own settings.json, so only install them when the
  // user actually has a project using an agent that consumes them — a
  // Codex-only user shouldn't have the launcher editing ~/.claude on their
  // behalf. Keyed off projects (not mount) because the list loads async.
  const hooksInstalledRef = useRef(false);
  useEffect(() => {
    if (hooksInstalledRef.current) return;
    if (!projects.some((p) => getAgent(p.agentId).capabilities.ideHooks)) return;
    hooksInstalledRef.current = true;
    ensureIdeHooks().catch(() => {});
  }, [projects]);

  // Drag-and-drop OS files into the active terminal as (quoted) paths, like a
  // console. Tauri intercepts native drops, so we listen to the webview event.
  const activeIdRef = useRef<string | null>(activeId);
  activeIdRef.current = activeId;
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    getCurrentWebview()
      .onDragDropEvent((event) => {
        if (event.payload.type !== "drop") return;
        const id = activeIdRef.current;
        if (!id) return;
        const paths = event.payload.paths ?? [];
        const text = paths
          .map((p) => (/\s/.test(p) ? `"${p}"` : p))
          .join(" ");
        if (text) {
          writePty(id, text + " ").catch(() => {});
          markActivity(id);
        }
      })
      .then((u) => (unlisten = u));
    return () => unlisten?.();
  }, [markActivity]);

  const active = sessions.find((s) => s.id === activeId) ?? null;
  const waiting = sessions.filter((s) => s.status === "waiting");

  const handlePick = (project: Project) => {
    createSession(project, settings);
    onLaunched(project.id);
    setShowPicker(false);
  };

  // Clear types the active agent's own clear slash command into the session.
  const doClear = () => {
    if (active) {
      const cmd = getAgent(
        projects.find((p) => p.id === active.projectId)?.agentId
      ).clearCommand;
      if (cmd) writePty(active.id, cmd + "\r").catch(() => {});
      markActivity(active.id);
    }
    setConfirm(null);
  };

  const doKill = () => {
    if (active) closeSession(active.id);
    setConfirm(null);
  };

  return (
    <div className={`ide${visible ? "" : " ide-hidden"}`}>
      {/* MODE BAR */}
      <div className="modebar">
        <span className="logo">
          CLAUDE<b>//</b>LAUNCHER
        </span>
        <div className="toggle">
          <button onClick={onExitIde}>Launcher</button>
          <button className="active">IDE Mode</button>
        </div>
        <span className="spacer" />
        <div className="shells">
          <button
            className="shellbtn"
            onClick={() => void launchShell("cmd")}
            title="Open a Command Prompt window in your home directory"
          >
            <SquareChevronRight size={12} />
            Cmd
          </button>
          <button
            className="shellbtn"
            onClick={() => void launchShell("pwsh")}
            title="Open a PowerShell window in your home directory"
          >
            <TerminalIcon size={12} />
            PS
          </button>
        </div>
      </div>

      {/* WORKBENCH */}
      <div className={`workbench${railCollapsed ? " rail-collapsed" : ""}`}>
        <SessionRail
          sessions={sessions}
          activeId={activeId}
          now={now}
          collapsed={railCollapsed}
          fontSize={settings.ideFontSize ?? IDE_FONT_SIZE_DEFAULT}
          onSelect={focusSession}
          onAdd={() => setShowPicker(true)}
          onToggleCollapse={() => setRailCollapsed((c) => !c)}
          onSetNote={setSessionNote}
          onFontSizeChange={setFontSize}
        />

        <section className="stage">
          <div className="term-bar">
            {active ? (
              <>
                <span className="name">{active.title}</span>
                <span className="path">{active.cwd}</span>
              </>
            ) : (
              <span className="name" style={{ color: "var(--ink-faint)" }}>
                NO ACTIVE SESSION
              </span>
            )}
            <span className="spacer" />
            <button
              className="tbtn"
              onClick={() => active && setRepaintNonce((n) => n + 1)}
              disabled={!active}
              title="Force a full repaint to clear stale/garbled glyphs (like resizing the window)"
            >
              ↻ Refresh
            </button>
            <button
              className={`tbtn${filesOpen ? " on" : ""}`}
              onClick={() => setFilesOpen((o) => !o)}
              disabled={!active}
            >
              ▸ Files
            </button>
            <button
              className="tbtn"
              onClick={() => active && setConfirm("clear")}
              disabled={!active}
            >
              Clear
            </button>
            <button
              className="tbtn"
              onClick={() => active && setConfirm("kill")}
              disabled={!active}
            >
              Kill
            </button>
          </div>

          <div className={`term-split${filesOpen ? " files-open" : ""}`}>
            <div className="term-host">
              {sessions.length === 0 && (
                <div className="term-empty">
                  Hit + in the rail to jack a project into a session.
                </div>
              )}
              {sessions.map((s) => (
                <Terminal
                  key={s.id}
                  session={s}
                  project={projectFor(projects, s.projectId, {
                    id: s.projectId,
                    name: s.title,
                    cwd: s.cwd,
                    color: s.color,
                    model: s.model,
                  })}
                  settings={settings}
                  active={s.id === activeId}
                  visible={visible}
                  onActivity={markActivity}
                  onBusy={markOutput}
                  onSubmit={markWorking}
                  onModel={setLiveModel}
                  repaintNonce={repaintNonce}
                />
              ))}
            </div>
            {filesOpen && active && (
              <FilesDrawer cwd={active.cwd} onClose={() => setFilesOpen(false)} />
            )}
          </div>
        </section>
      </div>

      {/* STATUS BAR */}
      <div className="statusbar">
        <span className="s-item">
          sessions <b>{sessions.length}</b>
        </span>
        <span className="s-item">
          hooks <b>armed</b>
        </span>
        {active && (
          <span className="s-item">
            model <b>{active.liveModel ?? modelLabel(active.model)}</b>
          </span>
        )}
        {active && <span className="s-item path">{active.cwd}</span>}
        <span className="spacer" />
        {waiting.length > 0 && (
          <span className="alert">⚠ {waiting[0].title} awaiting input</span>
        )}
        <span className="s-item">
          Claude<b>//</b>Launcher
        </span>
      </div>

      {showPicker && (
        <JackInPicker
          projects={projects}
          settings={settings}
          onPick={handlePick}
          onClose={() => setShowPicker(false)}
        />
      )}

      {confirm && active && (
        <div
          className="ide-scrim"
          onClick={(e) => e.target === e.currentTarget && setConfirm(null)}
        >
          <div className="ide-confirm">
            <div className={`hazbar${confirm === "clear" ? " warn" : ""}`} />
            <div className="body">
              <h2>{confirm === "kill" ? "KILL SESSION?" : "CLEAR CONTEXT?"}</h2>
              {confirm === "kill" ? (
                <p>
                  This terminates <b>{active.title}</b> and removes it from the
                  rail. Any unsaved work in that Claude session is lost.
                </p>
              ) : (
                <p>
                  This sends <b>/clear</b> to <b>{active.title}</b>, wiping its
                  conversation context. The session keeps running.
                </p>
              )}
              <div className="actions">
                <button onClick={() => setConfirm(null)}>Cancel</button>
                <button
                  className={confirm === "kill" ? "danger" : "warn"}
                  onClick={confirm === "kill" ? doKill : doClear}
                >
                  {confirm === "kill" ? "Kill" : "Clear"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
