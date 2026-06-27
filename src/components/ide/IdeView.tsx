import { useState, useEffect, useRef } from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { SquareChevronRight, Terminal as TerminalIcon } from "lucide-react";
import type { Project, GlobalSettings } from "../../types";
import { useSessions } from "../../hooks/useSessions";
import { launchShell } from "../../services/launcher";
import { writePty, ensureIdeHooks } from "../../services/ide";
import SessionRail from "./SessionRail";
import Terminal from "./Terminal";
import FilesDrawer from "./FilesDrawer";
import JackInPicker from "./JackInPicker";

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
  const [confirm, setConfirm] = useState<null | "kill" | "clear">(null);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  // Make sure the Stop/Notification → app hooks exist so the rail blinks and the
  // Working state ends precisely. Additive, idempotent; runs once on entry.
  useEffect(() => {
    ensureIdeHooks().catch(() => {});
  }, []);

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

  // Clear sends Claude's /clear slash command into the active session.
  const doClear = () => {
    if (active) {
      writePty(active.id, "/clear\r").catch(() => {});
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
          onSelect={focusSession}
          onAdd={() => setShowPicker(true)}
          onToggleCollapse={() => setRailCollapsed((c) => !c)}
          onSetNote={setSessionNote}
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
