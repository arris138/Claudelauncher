import { useState, useEffect, useCallback, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
import type { Project, GlobalSettings, Session, SessionStatus } from "../types";
import { resolveSessionFlags } from "../services/ide";

interface SessionStatePayload {
  sessionId: string;
  status: SessionStatus;
}
interface ExitPayload {
  sessionId: string;
  code: number;
}

/**
 * Runtime-only session state for IDE Mode. Owns the session list, the active
 * selection, and the listeners that turn backend events (hook attention pings,
 * PTY exits) into blink/banner state.
 */
export function useSessions() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const activeRef = useRef<string | null>(null);
  activeRef.current = activeId;
  // Last time each session produced PTY output — drives Working vs Idle.
  const lastOutputRef = useRef<Record<string, number>>({});

  const createSession = useCallback(
    (project: Project, settings: GlobalSettings): string => {
      const id = crypto.randomUUID();
      const now = Date.now();
      const session: Session = {
        id,
        projectId: project.id,
        title: project.tabTitle?.trim() || project.name,
        cwd: project.path,
        model: project.model,
        color: project.color,
        flags: resolveSessionFlags(project, settings),
        status: "idle",
        startedAt: now,
        lastActivityAt: now,
        unseen: false,
      };
      setSessions((prev) => [...prev, session]);
      setActiveId(id);
      return id;
    },
    []
  );

  const closeSession = useCallback((id: string) => {
    setSessions((prev) => {
      const next = prev.filter((s) => s.id !== id);
      if (activeRef.current === id) {
        setActiveId(next.length ? next[next.length - 1].id : null);
      }
      return next;
    });
  }, []);

  const focusSession = useCallback((id: string) => {
    setActiveId(id);
    setSessions((prev) =>
      prev.map((s) => (s.id === id ? { ...s, unseen: false } : s))
    );
  }, []);

  /** Update a session's live model (parsed from Claude's output). */
  const setLiveModel = useCallback((id: string, model: string) => {
    setSessions((prev) =>
      prev.map((s) => (s.id === id && s.liveModel !== model ? { ...s, liveModel: model } : s))
    );
  }, []);

  /**
   * PTY output arrived → the session is actively processing. Sets "working";
   * a watchdog demotes it back to "idle" once output goes quiet.
   */
  const markOutput = useCallback((id: string) => {
    lastOutputRef.current[id] = Date.now();
    setSessions((prev) => {
      let changed = false;
      const next = prev.map((s) => {
        if (s.id === id && s.status !== "working" && s.status !== "exited") {
          changed = true;
          return { ...s, status: "working" as const, unseen: activeRef.current !== id ? s.unseen : false };
        }
        return s;
      });
      return changed ? next : prev;
    });
  }, []);

  /** User interacted with a session: clear the blink, drop done/waiting banners. */
  const markActivity = useCallback((id: string) => {
    setSessions((prev) => {
      let changed = false;
      const next = prev.map((s) => {
        if (s.id !== id) return s;
        const status =
          s.status === "complete" || s.status === "waiting" ? "idle" : s.status;
        if (s.unseen || status !== s.status) {
          changed = true;
          return { ...s, unseen: false, status, lastActivityAt: Date.now() };
        }
        return s;
      });
      return changed ? next : prev;
    });
  }, []);

  // A turn stays "working" until a hook ends it — the Stop hook ("complete") or
  // the Notification hook ("waiting"/needs-input), or a PTY exit. Output pauses
  // do NOT end it: the model frequently goes quiet for long stretches while
  // thinking or reading files between tool calls, and demoting to "idle" then is
  // exactly the bug we're avoiding. This watchdog is only a last-resort backstop
  // for a genuinely missed hook, so it waits a long time (5 min) before unsticking.
  const WORKING_BACKSTOP_MS = 5 * 60 * 1000;
  useEffect(() => {
    const t = setInterval(() => {
      const now = Date.now();
      setSessions((prev) => {
        let changed = false;
        const next = prev.map((s) => {
          if (
            s.status === "working" &&
            now - (lastOutputRef.current[s.id] ?? 0) > WORKING_BACKSTOP_MS
          ) {
            changed = true;
            return { ...s, status: "idle" as const };
          }
          return s;
        });
        return changed ? next : prev;
      });
    }, 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const unlisteners: Array<() => void> = [];

    listen<SessionStatePayload>("session-state", (e) => {
      const { sessionId, status } = e.payload;
      setSessions((prev) =>
        prev.map((s) =>
          s.id === sessionId
            ? {
                ...s,
                status,
                lastActivityAt: Date.now(),
                unseen: activeRef.current !== sessionId,
              }
            : s
        )
      );
    }).then((u) => unlisteners.push(u));

    listen<ExitPayload>("pty-exit", (e) => {
      const { sessionId, code } = e.payload;
      // Show "Exited" briefly, then auto-remove the card (no lingering dead state).
      setSessions((prev) =>
        prev.map((s) =>
          s.id === sessionId
            ? {
                ...s,
                status: "exited",
                exitCode: code,
                unseen: activeRef.current !== sessionId,
              }
            : s
        )
      );
      setTimeout(() => {
        setSessions((prev) => {
          const next = prev.filter((s) => s.id !== sessionId);
          if (activeRef.current === sessionId) {
            setActiveId(next.length ? next[next.length - 1].id : null);
          }
          return next;
        });
      }, 4000);
    }).then((u) => unlisteners.push(u));

    return () => unlisteners.forEach((u) => u());
  }, []);

  return {
    sessions,
    activeId,
    createSession,
    closeSession,
    focusSession,
    markActivity,
    markOutput,
    setLiveModel,
  };
}
