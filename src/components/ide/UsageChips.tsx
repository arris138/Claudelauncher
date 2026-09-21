import { useEffect, useState } from "react";
import type { Project, Session } from "../../types";
import { getAgent } from "../../agents/registry";
import {
  accountUsage,
  fmtCredits,
  keyUsage,
  totalUsage,
  type AccountUsage,
  type TotalUsage,
} from "../../services/openrouterUsage";

/**
 * OpenRouter money in the status bar, two chips on two stages.
 *
 * - **IDE stage, per session** (`SessionUsageChip`): spend on the active
 *   session's project key since that session started. The baseline is captured
 *   at session creation in `useSessions`, so switching tabs cannot rewind the
 *   number; the chip just reads live and subtracts. OpenRouter has no
 *   per-session attribution, so two sessions sharing one key each show
 *   key-wide spend since their own start — the tooltip says so.
 * - **Launcher stage** (`LauncherUsageChip`): rolling 14-day spend and account
 *   balance when a management key is stored; otherwise this-UTC-week summed
 *   across the distinct project keys. The weekly fallback exists because
 *   `/api/v1/key` only offers fixed Monday and calendar-month windows — a true
 *   14-day tail needs `/api/v1/activity`, which is management-key-only.
 *
 * Both poll once a minute. These are counters, not streams; between polls the
 * number is simply a little old.
 */

const POLL_MS = 60_000;

export function SessionUsageChip({
  session,
  project,
}: {
  session: Session;
  project: Project;
}) {
  // null: first read pending. -1 sentinel: the read failed (a negative usage
  // is not a thing, so it cannot collide with real data).
  const [current, setCurrent] = useState<number | null>(null);
  const live = session.status !== "exited";

  useEffect(() => {
    let cancelled = false;
    const poll = () =>
      keyUsage(project.id)
        .then((u) => !cancelled && setCurrent(u.usage))
        .catch(() => !cancelled && setCurrent(-1));
    // One read even when the session already exited, so a chip mounted on the
    // corpse shows the final figure rather than "…".
    poll();
    const t = live ? setInterval(poll, POLL_MS) : undefined;
    return () => {
      cancelled = true;
      if (t) clearInterval(t);
    };
  }, [project.id, live]);

  // No baseline (no key stored, or the capture failed) means there is no
  // honest number to show. Hide the chip rather than imply $0.
  if (session.usageAtStart == null) return null;

  if (current == null) {
    return (
      <span className="s-item" title="Reading OpenRouter usage…">
        session <b>…</b>
      </span>
    );
  }
  if (current < 0) {
    return (
      <span className="s-item" title="OpenRouter usage fetch failed">
        session <b>?</b>
      </span>
    );
  }
  const delta = Math.max(0, current - session.usageAtStart);
  return (
    <span
      className="s-item"
      title={`Spent on this project's OpenRouter key since the session started${
        live ? "" : " (session closed)"
      }. Key-wide: concurrent sessions on the same key each count both.`}
    >
      session <b>{fmtCredits(delta)}</b>
    </span>
  );
}

type LauncherView =
  | { kind: "loading" }
  | { kind: "account"; acct: AccountUsage }
  | { kind: "keys"; total: TotalUsage; note?: string }
  | { kind: "error"; message: string };

export function LauncherUsageChip({ projects }: { projects: Project[] }) {
  const refsKey = projects
    .filter((p) => getAgent(p.agentId).id === "openrouter")
    .map((p) => p.id)
    .join(",");
  const [view, setView] = useState<LauncherView>({ kind: "loading" });

  useEffect(() => {
    if (!refsKey) return;
    let cancelled = false;
    const poll = async () => {
      const refs = refsKey.split(",");
      let accountError: string | null = null;
      try {
        const acct = await accountUsage(14);
        if (cancelled) return;
        if (acct) {
          setView({ kind: "account", acct });
          return;
        }
      } catch (err) {
        // A stored-but-rejected management key must not swallow the ordinary
        // per-key numbers, which still work fine with project keys.
        accountError = err instanceof Error ? err.message : String(err);
      }
      try {
        const total = await totalUsage(refs);
        if (!cancelled)
          setView({ kind: "keys", total, note: accountError ?? undefined });
      } catch (err) {
        if (!cancelled)
          setView({
            kind: "error",
            message: accountError ?? (err instanceof Error ? err.message : String(err)),
          });
      }
    };
    poll();
    const t = setInterval(poll, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [refsKey]);

  if (!refsKey) return null;

  switch (view.kind) {
    case "loading":
      return (
        <span className="s-item" title="Reading OpenRouter usage…">
          openrouter <b>…</b>
        </span>
      );
    case "error":
      return (
        <span className="s-item err" title={view.message}>
          openrouter <b>?</b>
        </span>
      );
    case "account": {
      const { acct } = view;
      return (
        <span
          className="s-item"
          title={`Rolling ${acct.days}-day spend on the OpenRouter account, via the management key.${
            acct.balance != null
              ? ` Balance ${fmtCredits(acct.balance)} (credits purchased minus used).`
              : ""
          }`}
        >
          {acct.days}d <b>{fmtCredits(acct.spend)}</b>
          {acct.balance != null && (
            <>
              {" "}
              · balance <b>{fmtCredits(acct.balance)}</b>
            </>
          )}
        </span>
      );
    }
    case "keys": {
      const { total, note } = view;
      const unread = total.missing + total.failed;
      return (
        <span
          className="s-item"
          title={`This UTC week across ${total.keys} OpenRouter key(s)${
            unread ? `, ${unread} unread` : ""
          }. Add an OpenRouter management key in Settings for rolling 14-day history and account balance.${
            note ? ` (management key: ${note})` : ""
          }`}
        >
          week <b>{fmtCredits(total.usageWeekly)}</b>
          {unread > 0 && <> · {unread} unread</>}
        </span>
      );
    }
  }
}
