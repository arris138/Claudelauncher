import { Plus, PanelLeftClose, PanelLeftOpen, AArrowDown, AArrowUp } from "lucide-react";
import type { Session } from "../../types";
import { IDE_FONT_SIZE_MIN, IDE_FONT_SIZE_MAX } from "../../types";
import SessionTag from "./SessionTag";

interface SessionRailProps {
  sessions: Session[];
  activeId: string | null;
  now: number;
  collapsed: boolean;
  /** Current IDE terminal font size (px) — applies to every agent's terminal. */
  fontSize: number;
  onSelect: (id: string) => void;
  onAdd: () => void;
  onToggleCollapse: () => void;
  onSetNote: (id: string, note: string, color?: string) => void;
  onFontSizeChange: (next: number) => void;
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
  fontSize,
  onSelect,
  onAdd,
  onToggleCollapse,
  onSetNote,
  onFontSizeChange,
}: SessionRailProps) {
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
                onSetNote={(note, color) => onSetNote(s.id, note, color)}
              />
            ))}
      </div>

      <div className="rail-foot">
        <div className="font-size-ctl">
          <button
            className="rail-toggle"
            onClick={() => onFontSizeChange(fontSize - 0.5)}
            disabled={fontSize <= IDE_FONT_SIZE_MIN}
            title="Smaller terminal text"
            aria-label="Decrease terminal font size"
          >
            <AArrowDown size={14} />
          </button>
          {!collapsed && (
            <span className="font-size-val" title="Terminal font size">
              {fontSize}px
            </span>
          )}
          <button
            className="rail-toggle"
            onClick={() => onFontSizeChange(fontSize + 0.5)}
            disabled={fontSize >= IDE_FONT_SIZE_MAX}
            title="Larger terminal text"
            aria-label="Increase terminal font size"
          >
            <AArrowUp size={14} />
          </button>
        </div>
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
