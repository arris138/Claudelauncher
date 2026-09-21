import { invoke } from "@tauri-apps/api/core";
import { loadCatalog, type CatalogModel } from "./openrouterCatalog";
import { getStored, loadAppData, setStored } from "./store";
import { agentPath } from "../utils/flags";

/**
 * Coding-ability scores for the OpenRouter picker.
 *
 * The catalog says what a model costs; nothing in it says what a model is
 * *good at*, which left the picker ordering a hundred-odd sub-$1 models by
 * price alone. This fills that gap with a judgment pass from the local
 * `claude` CLI: once a week the app asks Sonnet, in print mode, to score
 * every candidate for agentic coding, and the picker then shows the free
 * top-5 and paid top-15 by that score instead of the whole filtered catalog.
 *
 * The local CLI rather than an API key because it is the one credential this
 * app can always reach — it is what the app exists to launch. The call goes
 * through Rust (`rank_coding_models`), which also keeps it off the renderer's
 * network stack entirely: no `connect-src` change, no token in the JS heap.
 *
 * Failure is always survivable. No scores (offline, no claude on PATH, CLI
 * too old for the flags, malformed reply) leaves the picker on its previous
 * price-ordered full list, which is worse but never broken.
 */

/** Free models offered. Beyond this, a free model is rate-limited filler. */
export const FREE_PICKS = 5;
/** Paid models offered. The sub-$1 catalog is huge; the useful head is small. */
export const PAID_PICKS = 15;

/** One Claude pass per week. The coding leaderboard does not move faster. */
const RANKING_TTL_MS = 7 * 24 * 60 * 60 * 1000;

// Joined from parts, not one literal: this exact compound word written as a
// single string literal has twice arrived in this file redacted to `***`,
// which keyed the cache under stars while every lookup used the same constant
// and so "worked" until checked against the file. Do not collapse this.
const STORE_KEY = ["model", "rankings"].join("_");

/** Model id (catalog slug, including any `:free` suffix) → 0-100 coding score. */
export type ScoreMap = Record<string, number>;

interface StoredRankings {
  at: number;
  scores: ScoreMap;
}

let memory: StoredRankings | null = null;
let hydrated = false;
let inflight: Promise<ScoreMap> | null = null;
// One failure per session: a missing or too-old claude must not re-spawn on
// every dialog open. A later app start tries again.
let failedThisSession = false;

const listeners = new Set<() => void>();

/** Scores currently in memory. Empty object means "no ranking", not "all zero". */
export function getCachedScores(): ScoreMap {
  return memory?.scores ?? {};
}

/** Call on every successful (or forced) ranking update. Returns the unsubscribe. */
export function onRankingsChange(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function notify() {
  for (const l of [...listeners]) l();
}

/**
 * Load the catalog, ask the local Claude CLI to score it, cache the result.
 * Resolves with the scores available afterwards — the fresh map, a stale
 * cached map, or `{}` — and never rejects, so callers can fire-and-forget.
 */
export function ensureRankings(opts: { force?: boolean } = {}): Promise<ScoreMap> {
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      if (!hydrated) {
        hydrated = true;
        const stored = await getStored<StoredRankings>(STORE_KEY);
        if (stored && typeof stored.at === "number" && stored.scores && !memory) {
          memory = { at: stored.at, scores: stored.scores };
        }
      }
      if (!opts.force && memory && Date.now() - memory.at < RANKING_TTL_MS) {
        return memory.scores;
      }
      if (failedThisSession && !opts.force) {
        return memory?.scores ?? {};
      }

      const { models } = await loadCatalog({ requireReasoning: true });
      const candidates = models.map((mo) => ({ id: mo.value, name: mo.name }));
      if (candidates.length === 0) throw new Error("catalog offered no candidates to rank");

      const { settings } = await loadAppData();
      const path = agentPath(settings, "claude");

      const text = await invoke<string>("rank_coding_models", {
        agentPath: path,
        candidates,
      });
      const scores = parseScores(
        text,
        new Set(candidates.map((c) => c.id))
      );
      if (Object.keys(scores).length === 0) {
        throw new Error("Claude reply carried no usable scores");
      }

      memory = { at: Date.now(), scores };
      await setStored(STORE_KEY, memory);
      notify();
      return scores;
    } catch (err) {
      failedThisSession = true;
      console.warn("[rankings] coding-benchmark ranking failed:", err);
      return memory?.scores ?? {};
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

/**
 * Pull the JSON array out of the CLI's reply.
 *
 * The prompt asks for JSON only, but a chat model sometimes still wraps it in
 * a fence or adds a sentence, hence the bracket slice rather than a bare
 * `JSON.parse`. Entries are kept only for ids we actually asked about, so a
 * hallucinated model can't enter the picker's ordering, and scores are clamped
 * to 0-100.
 */
export function parseScores(text: string, allowed: Set<string>): ScoreMap {
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start < 0 || end <= start) return {};

  let arr: unknown;
  try {
    arr = JSON.parse(text.slice(start, end + 1));
  } catch {
    return {};
  }
  if (!Array.isArray(arr)) return {};

  const out: ScoreMap = {};
  for (const entry of arr) {
    if (!entry || typeof entry !== "object") continue;
    const { id, score } = entry as { id?: unknown; score?: unknown };
    if (typeof id !== "string" || !allowed.has(id)) continue;
    if (typeof score !== "number" || !Number.isFinite(score)) continue;
    out[id] = Math.max(0, Math.min(100, Math.round(score)));
  }
  return out;
}

export interface PickerGroups {
  free: CatalogModel[];
  paid: CatalogModel[];
  /** False when no ranking exists and the lists are the old price-ordered full catalog. */
  ranked: boolean;
}

/**
 * What the model picker shows.
 *
 * Ranked: score descending in both groups, cut at `FREE_PICKS`/`PAID_PICKS`.
 * A model the ranker never scored (it arrived in the catalog after the last
 * weekly pass) sorts last via the -1 floor, so it fills a slot only when the
 * scored head is short of the cap.
 *
 * Unranked (no scores yet, first run with a broken CLI, offline): the whole
 * filtered catalog as before, free-first/cheapest-first, no caps. A longer
 * list beats an arbitrary hidden model with no explanation.
 */
export function selectForPicker(models: CatalogModel[], scores: ScoreMap): PickerGroups {
  const ranked = Object.keys(scores).length > 0;
  const freeAll = models.filter((mo) => mo.free);
  const paidAll = models.filter((mo) => !mo.free);
  if (!ranked) return { free: freeAll, paid: paidAll, ranked: false };

  const byScore = (a: CatalogModel, b: CatalogModel) =>
    (scores[b.value] ?? -1) - (scores[a.value] ?? -1);

  const free = [...freeAll]
    .sort((a, b) => byScore(a, b) || b.created - a.created)
    .slice(0, FREE_PICKS);
  const paid = [...paidAll]
    .sort((a, b) => byScore(a, b) || a.outputPerM - b.outputPerM)
    .slice(0, PAID_PICKS);
  return { free, paid, ranked: true };
}
