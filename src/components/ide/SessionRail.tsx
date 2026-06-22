import { Plus, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import type { Session } from "../../types";
import SessionTag from "./SessionTag";

interface SessionRailProps {
  sessions: Session[];
  activeId: string | null;
  now: number;
  collapsed: boolean;
  onSelect: (id: string) => void;
  onAdd: () => void;
  onToggleCollapse: () => void;
}

/** First letters of each word ("Claude Launcher" -> "CL", "AntNAS" -> "AN"). */
function initials(title: string): string {
  const words = title.split(/[\s\-_/.]+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return words.map((w) => w[0]).join("").slice(0, 3).toUpperCase();
}

function stateClass(s: Session): string {
  switch (s.status) {
    case "waiting":
      return "s-need";
    case "complete":
      return "s-done";
    case "exited":
      return "s-dead";
    case "working":
    case "starting":
      return "s-run";
    default:
      return "s-idle";
  }
}

/** Short glyph for the collapsed-tile status bar (working/idle use a CSS pulse dot). */
function stateGlyph(s: Session): string {
  switch (s.status) {
    case "waiting":
      return "!";
    case "complete":
      return "✓";
    case "exited":
      return "✕";
    default:
      return "";
  }
}

function statusLabel(s: Session): string {
  switch (s.status) {
    case "waiting":
      return "Waiting on user";
    case "complete":
      return "Complete";
    case "exited":
      return "Exited";
    case "starting":
      return "Starting";
    case "working":
      return "Working";
    default:
      return "Idle";
  }
}

export default function SessionRail({
  sessions,
  activeId,
  now,
  collapsed,
  onSelect,
  onAdd,
  onToggleCollapse,
}: SessionRailProps) {
  const live = sessions.filter((s) => s.status !== "exited").length;
  const dead = sessions.length - live;

  return (
    <aside className={`rail${collapsed ? " collapsed" : ""}`}>
      <div className="rail-head">
        {!collapsed && (
          <h2>
            <span className="tick">▣</span> SESSIONS
          </h2>
        )}
        <button className="add-btn" onClick={onAdd} title="Jack in a project">
          <Plus size={16} strokeWidth={3} />
        </button>
      </div>

      <div className="sessions">
        {sessions.length === 0
          ? !collapsed && (
              <div className="rail-empty">
                NO SESSIONS
                <br />
                HIT <span style={{ color: "var(--rust-hi)" }}>+</span> TO JACK IN
              </div>
            )
          : collapsed
          ? sessions.map((s) => (
              <div
                key={s.id}
                className={`minitag ${stateClass(s)}${s.id === activeId ? " active" : ""}`}
                style={{ background: s.color ?? "#c2632f" }}
                title={`${s.title} — ${s.cwd} · ${statusLabel(s)}`}
                onClick={() => onSelect(s.id)}
              >
                <span className="ini">{initials(s.title)}</span>
                <span className="mbar" aria-label={statusLabel(s)}>
                  {stateGlyph(s)}
                </span>
              </div>
            ))
          : sessions.map((s) => (
              <SessionTag
                key={s.id}
                session={s}
                active={s.id === activeId}
                now={now}
                onClick={() => onSelect(s.id)}
              />
            ))}
      </div>

      <div className="rail-foot">
        {!collapsed && (
          <div className="live-row">
            <span className="rivet" />
            <span>
              <span className="live">●</span> {live} live
              {dead > 0 ? ` · ${dead} dead` : ""}
            </span>
          </div>
        )}
        <button
          className="rail-toggle"
          onClick={onToggleCollapse}
          title={collapsed ? "Expand sidebar" : "Hide sidebar"}
        >
          {collapsed ? (
            <PanelLeftOpen size={14} />
          ) : (
            <>
              <PanelLeftClose size={14} /> Hide
            </>
          )}
        </button>
      </div>
    </aside>
  );
}
