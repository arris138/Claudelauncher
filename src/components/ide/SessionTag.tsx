import type { Session } from "../../types";

interface SessionTagProps {
  session: Session;
  active: boolean;
  now: number;
  onClick: () => void;
}

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

export default function SessionTag({ session, active, now, onClick }: SessionTagProps) {
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
      className={`tag brushed ${stateClass}${active ? " active" : ""}`}
      onClick={onClick}
    >
      {session.status === "waiting" && <span className="hazstrip" />}
      <div className="callsign">
        <span className="swatch" style={{ background: session.color ?? "#c2632f" }} />
        {session.title}
      </div>
      <div className="meta">
        {session.cwd}
        {session.liveModel
          ? ` · ${session.liveModel}`
          : session.model
          ? ` · ${session.model.replace("claude-", "")}`
          : ""}
      </div>
      <div className={`bar ${bar.cls}`}>
        <span className="lbl">{bar.label}</span>
        {bar.t && <span className="t">{bar.t}</span>}
      </div>
    </div>
  );
}
