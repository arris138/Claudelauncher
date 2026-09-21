import { useState, useEffect, useRef } from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import {
  SquareChevronRight,
  Terminal as TerminalIcon,
  Plus,
  Settings,
  Download,
  Loader2,
  Sparkles,
} from "lucide-react";
import type { Project, GlobalSettings, SortConfig, UiMode } from "../../types";
import {
  IDE_FONT_SIZE_DEFAULT,
  IDE_FONT_SIZE_MIN,
  IDE_FONT_SIZE_MAX,
} from "../../types";
import type { UpdateState } from "../../hooks/useUpdateChecker";
import { useFreeModelWatch } from "../../hooks/useFreeModelWatch";
import { useSessions } from "../../hooks/useSessions";
import { launchShell } from "../../services/launcher";
import { writePty, ensureIdeHooks } from "../../services/ide";
import SessionRail from "./SessionRail";
import Terminal from "./Terminal";
import FilesDrawer from "./FilesDrawer";
import JackInPicker from "./JackInPicker";
import LauncherStage from "../launcher/LauncherStage";
import { SessionUsageChip, LauncherUsageChip } from "./UsageChips";
import { getAgent } from "../../agents/registry";

/** Tidy a model id for display ("claude-opus-4-8" -> "opus-4-8"). */
function modelLabel(model?: string): string {
  if (model === undefined || model === "") return "cli default";
  return model.replace(/^claude-/, "");
}

interface IdeViewProps {
  projects: Project[];
  settings: GlobalSettings;
  /** Which stage fills the frame. The frame itself never changes. */
  mode: UiMode;
  onSetMode: (mode: UiMode) => void;
  onLaunched: (projectId: string) => void;
  onUpdateSettings: (partial: Partial<GlobalSettings>) => void;
  onOpenSettings: () => void;
  onAddProject: () => void;
  /* --- launcher stage --- */
  recentProjects: Project[];
  sort: SortConfig;
  updateInfo: UpdateState;
  launchError: string | null;
  onSortChange: (sort: SortConfig) => void;
  onLaunchTerminal: (project: Project) => void;
  onEditProject: (id: string) => void;
  onRemoveProject: (id: string) => void;
  onDismissError: () => void;
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
  mode,
  onSetMode,
  onLaunched,
  onUpdateSettings,
  onOpenSettings,
  onAddProject,
  recentProjects,
  sort,
  updateInfo,
  launchError,
  onSortChange,
  onLaunchTerminal,
  onEditProject,
  onRemoveProject,
  onDismissError,
}: IdeViewProps) {
  const inIde = mode === "ide";
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

  // Free-model watch. Lives in the shell because the shell is what renders
  // the status bar, and because it must not re-run per stage switch.
  const freeModels = useFreeModelWatch(
    projects,
    settings.openrouterModelWatermark,
    (openrouterModelWatermark) => onUpdateSettings({ openrouterModelWatermark })
  );
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
  // behalf. Gated on IDE mode as well: the shell now mounts at startup, and a
  // user who never opens a session shouldn't get hooks written on their behalf.
  const hooksInstalledRef = useRef(false);
  useEffect(() => {
    if (hooksInstalledRef.current || !inIde) return;
    if (!projects.some((p) => getAgent(p.agentId).capabilities.ideHooks)) return;
    hooksInstalledRef.current = true;
    ensureIdeHooks().catch(() => {});
  }, [projects, inIde]);

  // Drag-and-drop OS files into the active terminal as (quoted) paths, like a
  // console. Tauri intercepts native drops, so we listen to the webview event.
  const activeIdRef = useRef<string | null>(activeId);
  activeIdRef.current = activeId;
  // The listener is registered once, so it reads the mode through a ref —
  // a drop on the project board must not type paths into a hidden terminal.
  const inIdeRef = useRef(inIde);
  inIdeRef.current = inIde;
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    getCurrentWebview()
      .onDragDropEvent((event) => {
        if (event.payload.type !== "drop") return;
        if (!inIdeRef.current) return;
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
  const activeProject = active
    ? projects.find((p) => p.id === active.projectId) ?? null
    : null;
  const waiting = sessions.filter((s) => s.status === "waiting");

  const handlePick = (project: Project) => {
    createSession(project, settings);
    onLaunched(project.id);
    setShowPicker(false);
    onSetMode("ide");
  };

  // Live session count per project, so the board can mark what's already running.
  const liveCounts = sessions.reduce<Record<string, number>>((acc, s) => {
    acc[s.projectId] = (acc[s.projectId] ?? 0) + 1;
    return acc;
  }, {});

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
    <div className="ide">
      {/* MODE BAR — identical in both stages */}
      <div className="modebar">
        <span className="logo">
          CLAUDE<b>//</b>LAUNCHER
        </span>
        <div className="toggle">
          <button
            className={inIde ? "" : "active"}
            onClick={() => onSetMode("launcher")}
          >
            Launcher
          </button>
          <button
            className={inIde ? "active" : ""}
            onClick={() => onSetMode("ide")}
          >
            IDE Mode
          </button>
        </div>
        {/* No counts here — the status bar carries them, and the mode bar needs
            the room for the button cluster at narrow window widths. */}
        <span className="spacer" />
        <div className="shells">
          <button
            className="barbtn primary"
            onClick={onAddProject}
            title="Add a project"
          >
            <span className="g">
              <Plus size={12} />
            </span>
            Project
          </button>
          <span className="bar-sep" />
          <button
            className="barbtn"
            onClick={() => void launchShell("cmd")}
            title="Open an elevated Command Prompt (Run as administrator) in your home directory"
          >
            <span className="g">
              <SquareChevronRight size={12} />
            </span>
            Cmd
          </button>
          <button
            className="barbtn"
            onClick={() => void launchShell("pwsh")}
            title="Open an elevated PowerShell window (Run as administrator) in your home directory"
          >
            <span className="g">
              <TerminalIcon size={12} />
            </span>
            PS
          </button>
          <span className="bar-sep" />
          <button
            className="barbtn square"
            onClick={onOpenSettings}
            title="Settings"
          >
            <span className="g">
              <Settings size={13} />
            </span>
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

        {!inIde && (
          <LauncherStage
            projects={projects}
            recentProjects={recentProjects}
            sort={sort}
            liveCounts={liveCounts}
            launchError={launchError}
            onSortChange={onSortChange}
            onLaunch={onLaunchTerminal}
            onJackIn={handlePick}
            onEdit={onEditProject}
            onRemove={onRemoveProject}
            onDismissError={onDismissError}
          />
        )}

        {/* The terminal stage stays mounted while the board is showing — the
            PTYs live inside it — so it hides rather than unmounts. */}
        <section className="stage" hidden={!inIde}>
          <div className="term-bar">
            {active ? (
              <>
                {/* the note, when set, stands in for the title — it's the
                    user's own label for this session and buys header space */}
                <span
                  className={`name${active.note ? " noted" : ""}`}
                  title={active.note ? `${active.title} — ${active.note}` : active.title}
                >
                  {active.note || active.title}
                </span>
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
              <span className="g">↻</span>Refresh
            </button>
            <button
              className={`tbtn${filesOpen ? " on" : ""}`}
              onClick={() => setFilesOpen((o) => !o)}
              disabled={!active}
            >
              <span className="g">▸</span>Files
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
                  visible={inIde}
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

      {/* STATUS BAR — session state from IDE mode, version and updates from
          the old Launcher status bar, one bar across both stages. */}
      <div className="statusbar">
        <span className="s-item">
          sessions <b>{sessions.length}</b>
        </span>
        {inIde && active && (
          <span className="s-item">
            model <b>{active.liveModel ?? modelLabel(active.model)}</b>
          </span>
        )}
        {inIde && active && <span className="s-item path">{active.cwd}</span>}
        {/* OpenRouter money: per-session spend while in the IDE, account
            window while on the board. Both chips self-hide without a key. */}
        {inIde &&
          active &&
          activeProject &&
          getAgent(activeProject.agentId).id === "openrouter" && (
            <SessionUsageChip session={active} project={activeProject} />
          )}
        {!inIde && (
          <span className="s-item">
            projects <b>{projects.length}</b>
          </span>
        )}
        {!inIde && <LauncherUsageChip projects={projects} />}
        <span className="spacer" />
        {waiting.length > 0 && (
          <span className="alert">⚠ {waiting[0].title} awaiting input</span>
        )}
        {freeModels.expiring.length > 0 && (
          <span className="s-item err">
            ⚠ {freeModels.expiring[0].value} retires{" "}
            {new Date(freeModels.expiring[0].expiresOn!).toLocaleDateString()}
          </span>
        )}
        {freeModels.fresh.length > 0 && (
          <button className="upd" onClick={freeModels.dismiss}>
            <Sparkles size={11} />
            {freeModels.fresh.length === 1
              ? `new free model: ${freeModels.fresh[0].value}`
              : `${freeModels.fresh.length} new free models on OpenRouter`}
          </button>
        )}
        {updateInfo.error && (
          <span className="s-item err">update failed: {updateInfo.error}</span>
        )}
        {!updateInfo.error && updateInfo.downloading && (
          <span className="s-item" style={{ color: "var(--tape)" }}>
            <Loader2 size={11} className="animate-spin" />
            downloading… {updateInfo.progress}%
          </span>
        )}
        {!updateInfo.error &&
          !updateInfo.downloading &&
          updateInfo.updateAvailable &&
          updateInfo.install && (
            <button className="upd" onClick={() => void updateInfo.install?.()}>
              <Download size={11} />v{updateInfo.latestVersion} available — click to
              update &amp; restart
            </button>
          )}
        <span className="s-item">v{updateInfo.currentVersion}</span>
      </div>

      {showPicker && (
        <JackInPicker
          projects={projects}
          settings={settings}
          onPick={handlePick}
          onNewProject={() => {
            setShowPicker(false);
            onAddProject();
          }}
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
