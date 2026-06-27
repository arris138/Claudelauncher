import { useEffect, useRef, useState } from "react";
import { Pencil } from "lucide-react";
import type { Session } from "../../types";

interface SessionTagProps {
  session: Session;
  active: boolean;
  now: number;
  onClick: () => void;
  onSetNote: (note: string, color?: string) => void;
}

const DEFAULT_NOTE_COLOR = "#c2632f";

function mmss(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function idle(ms: number): string {
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `idle ${mins}m`;
  return `idle ${Math.floor(mins / 60)}h`;
}

export default function SessionTag({ session, active, now, onClick, onSetNote }: SessionTagProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(session.note ?? "");
  const [draftColor, setDraftColor] = useState(session.noteColor ?? DEFAULT_NOTE_COLOR);
  const inputRef = useRef<HTMLInputElement>(null);
  const editorRef = useRef<HTMLDivElement>(null);

  // Focus the field when entering edit mode, seeded from current values.
  useEffect(() => {
    if (editing) {
      setDraft(session.note ?? "");
      setDraftColor(session.noteColor ?? DEFAULT_NOTE_COLOR);
      inputRef.current?.focus();
      inputRef.current?.select();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing]);

  const commit = () => {
    onSetNote(draft, draftColor);
    setEditing(false);
  };
  const cancel = () => setEditing(false);

  // Commit only when focus truly leaves the editor — defer so a click on the
  // color swatch (which blurs the text field) doesn't prematurely close it.
  const handleBlur = () => {
    setTimeout(() => {
      if (editorRef.current && !editorRef.current.contains(document.activeElement)) {
        commit();
      }
    }, 0);
  };

  const stateClass =
    session.status === "waiting"
      ? "s-need"
      : session.status === "complete"
      ? "s-done"
      : session.status === "exited"
      ? "s-dead"
      : session.status === "working" || session.status === "starting"
      ? "s-run"
      : "s-idle";

  // Working = actively producing output (gentle pulse). Idle = alive but quiet
  // (static, no movement).
  let bar: { cls: string; label: React.ReactNode; t?: string };
  switch (session.status) {
    case "waiting":
      bar = { cls: "need", label: "⚠ Waiting on User", t: mmss(now - session.lastActivityAt) };
      break;
    case "complete":
      bar = { cls: "done", label: "✓ Complete", t: idle(now - session.lastActivityAt) };
      break;
    case "exited":
      bar = { cls: "dead", label: `✕ Exited · code ${session.exitCode ?? "?"}` };
      break;
    case "working":
    case "starting":
      bar = {
        cls: "work",
        label: (
          <>
            <span className="pulse-dot" />
            {session.status === "starting" ? "Starting…" : "Working…"}
          </>
        ),
        t: mmss(now - session.startedAt),
      };
      break;
    default:
      bar = { cls: "idle", label: "Idle" };
  }

  return (
    <div
      className={`tag brushed ${stateClass}${active ? " active" : ""}${
        session.note ? " has-note" : ""
      }`}
      onClick={onClick}
    >
      {session.status === "waiting" && <span className="hazstrip" />}
      <div className="callsign">
        <span className="swatch" style={{ background: session.color ?? "#c2632f" }} />
        <span className="title">{session.title}</span>
        <button
          className="note-edit"
          title={session.note ? "Edit note" : "Add a note"}
          onClick={(e) => {
            e.stopPropagation();
            setEditing(true);
          }}
        >
          <Pencil size={11} />
        </button>
      </div>

      {editing ? (
        <div
          className="note-editor"
          ref={editorRef}
          onClick={(e) => e.stopPropagation()}
          onBlur={handleBlur}
        >
          <input
            type="color"
            className="note-color"
            value={draftColor}
            title="Note color"
            onChange={(e) => setDraftColor(e.target.value)}
          />
          <input
            ref={inputRef}
            type="text"
            className="note-input"
            value={draft}
            placeholder="Add a note…"
            maxLength={80}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") commit();
              else if (e.key === "Escape") cancel();
            }}
          />
        </div>
      ) : (
        <div className="meta">
          {session.note ? (
            <span className="note-text" style={{ color: session.noteColor }}>
              {session.note}
            </span>
          ) : (
            session.cwd
          )}
        </div>
      )}
      <div className={`bar ${bar.cls}`}>
        <span className="lbl">{bar.label}</span>
        {bar.t && <span className="t">{bar.t}</span>}
      </div>
    </div>
  );
}
