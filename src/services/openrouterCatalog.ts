import type { ModelOption } from "../agents/types";

/**
 * OpenRouter's model catalog, fetched live and filtered to models that can
 * actually drive an agentic coding session.
 *
 * Fetched rather than shipped on purpose. `codex.ts` carries three separate
 * comments apologising for a model list that went stale between releases; this
 * catalog is an order of magnitude larger and moves weekly, so a baked list
 * would be wrong on arrival. `FALLBACK_MODELS` exists only for the offline
 * case, and is a snapshot rather than the source of truth.
 *
 * The endpoint needs no authentication, which is why this runs before the user
 * has entered a key.
 */

const CATALOG_URL = "https://openrouter.ai/api/v1/models";

/** Ceiling on output price, in dollars per million tokens. */
export const MAX_OUTPUT_PRICE_PER_M = 1;

/** Cached catalog lifetime. Long enough that opening five dialogs is one fetch. */
const CACHE_TTL_MS = 60 * 60 * 1000;

interface RawModel {
  id: string;
  name: string;
  created: number;
  context_length: number;
  description?: string;
  pricing?: { prompt?: string; completion?: string };
  supported_parameters?: string[];
  architecture?: { output_modalities?: string[] };
  expiration_date?: string | null;
}

export interface CatalogModel extends ModelOption {
  /** Unix seconds. Drives the "new free model" watermark. */
  created: number;
  /** ISO date the model stops being served, when OpenRouter publishes one. */
  expiresOn?: string;
  promptPerM: number;
  outputPerM: number;
}

/**
 * Snapshot taken 2026-09-20 from the live catalog, reasoning-capable and
 * tool-capable, under the price ceiling. Used only when the fetch fails.
 */
export const FALLBACK_MODELS: CatalogModel[] = [
  m("deepseek/deepseek-v4-pro", "DeepSeek V4 Pro", 0.422, 0.845, 1048576),
  m("xiaomi/mimo-v2.5-pro", "MiMo-V2.5-Pro", 0.435, 0.87, 1050000),
  m("deepseek/deepseek-v4.1-flash", "DeepSeek V4.1 Flash", 0.15, 0.6, 1048576),
  m("openai/gpt-oss-120b", "gpt-oss-120b", 0.15, 0.6, 131072),
  m("qwen/qwen3.8-flash", "Qwen3.8 Flash", 0.15, 0.47, 1000000),
  m("nvidia/nemotron-3-super-120b-a12b", "Nemotron 3 Super", 0.08, 0.45, 262144),
  m("z-ai/glm-4.7-flash", "GLM 4.7 Flash", 0.061, 0.4, 200000),
  m("z-ai/glm-5.3-flash", "GLM 5.3 Flash", 0.09, 0.3, 1310720),
  m("poolside/laguna-s-2.1", "Laguna S 2.1", 0.09, 0.18, 1048576),
  m("deepseek/deepseek-v4-flash", "DeepSeek V4 Flash", 0.036, 0.071, 1048576),
];

function m(
  value: string,
  label: string,
  promptPerM: number,
  outputPerM: number,
  contextWindow: number
): CatalogModel {
  return {
    value,
    label: `${label} · ${priceLabel(promptPerM, outputPerM)} · ${ctxLabel(contextWindow)}`,
    contextWindow,
    price: priceLabel(promptPerM, outputPerM),
    free: outputPerM === 0,
    created: 0,
    promptPerM,
    outputPerM,
  };
}

function priceLabel(promptPerM: number, outputPerM: number): string {
  if (promptPerM === 0 && outputPerM === 0) return "free";
  const fmt = (n: number) => (n < 0.1 ? n.toFixed(3) : n.toFixed(2));
  return `$${fmt(promptPerM)}/$${fmt(outputPerM)} per M`;
}

function ctxLabel(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_048_576).toFixed(1)}M ctx`;
  return `${Math.round(tokens / 1024)}k ctx`;
}

/**
 * Which catalog entries are worth offering.
 *
 * Every clause here was earned by looking at the live data rather than
 * reasoned from first principles:
 *
 * - **`:batch` is excluded.** Batch endpoints are 20-40% cheaper, which floats
 *   them up any price-sorted list, and they are asynchronous. Eleven of them
 *   pass a naive price filter and every one would hang an interactive session.
 * - **`tools` is required.** An agent CLI without tool calling can't read a
 *   file, so the model is useless here however good it is at prose.
 * - **`reasoning` is required.** Deliberate, and it has a cost worth knowing:
 *   it excludes all three purpose-built coders (`qwen3-coder-next`,
 *   `qwen3-coder-flash`, `codestral-2508`), which are code-tuned but expose no
 *   reasoning parameter. Pass `requireReasoning: false` to get them back; the
 *   free-model watch already does, since that tier skews non-reasoning.
 * - **Free models bypass the price ceiling** but face the same capability bar.
 */
export function filterModels(
  raw: RawModel[],
  opts: { requireReasoning: boolean }
): CatalogModel[] {
  const out: CatalogModel[] = [];

  for (const r of raw) {
    if (r.id.includes(":batch")) continue;

    const params = r.supported_parameters ?? [];
    if (!params.includes("tools")) continue;
    if (opts.requireReasoning && !params.includes("reasoning")) continue;

    const outputs = r.architecture?.output_modalities ?? [];
    if (!outputs.includes("text")) continue;

    const promptPerM = Number(r.pricing?.prompt ?? NaN) * 1e6;
    const outputPerM = Number(r.pricing?.completion ?? NaN) * 1e6;
    if (!Number.isFinite(promptPerM) || !Number.isFinite(outputPerM)) continue;

    const free = promptPerM === 0 && outputPerM === 0;
    if (!free && outputPerM >= MAX_OUTPUT_PRICE_PER_M) continue;

    // A model already past its published end date will fail at launch; showing
    // it only converts a clear "not offered" into a confusing runtime error.
    if (r.expiration_date && Date.parse(r.expiration_date) < Date.now()) continue;

    const ctx = r.context_length || 0;
    const price = priceLabel(promptPerM, outputPerM);
    out.push({
      value: r.id,
      label: `${cleanName(r.name)} · ${price} · ${ctxLabel(ctx)}`,
      contextWindow: ctx || undefined,
      price,
      free,
      created: r.created ?? 0,
      expiresOn: r.expiration_date ?? undefined,
      promptPerM,
      outputPerM,
    });
  }

  return sortModels(out);
}

/**
 * Free first (the user asked for it, and a free model that does the job should
 * be the one you reach for), then cheapest output. Within the free block,
 * newest first, so a model added last week is the one you see.
 */
export function sortModels(models: CatalogModel[]): CatalogModel[] {
  return [...models].sort((a, b) => {
    if (a.free !== b.free) return a.free ? -1 : 1;
    if (a.free && b.free) return b.created - a.created;
    return a.outputPerM - b.outputPerM;
  });
}

/**
 * Tidy a catalog display name for a one-line option.
 *
 * Two redundancies to remove, both present in the live data: `name` repeats the
 * vendor ("Qwen: Qwen3 Coder"), and free models carry a "(free)" suffix that
 * the price column and the optgroup heading each state again.
 */
function cleanName(name: string): string {
  const withoutFreeTag = name.replace(/\s*\(free\)\s*$/i, "");
  const [vendor, ...rest] = withoutFreeTag.split(": ");
  if (rest.length === 0) return withoutFreeTag;
  const tail = rest.join(": ");
  return tail.toLowerCase().startsWith(vendor.toLowerCase()) ? tail : `${vendor} ${tail}`;
}

let cache: { at: number; models: CatalogModel[]; reasoningOnly: boolean } | null = null;

/**
 * Fetch and filter the catalog, with a one-hour cache.
 *
 * Failure returns the baked snapshot rather than throwing: a model picker that
 * shows ten known-good models beats one that shows an error, and the user may
 * simply be offline.
 */
export async function loadCatalog(
  opts: { requireReasoning?: boolean; force?: boolean } = {}
): Promise<{ models: CatalogModel[]; stale: boolean }> {
  const requireReasoning = opts.requireReasoning ?? true;
  const fresh =
    cache &&
    !opts.force &&
    Date.now() - cache.at < CACHE_TTL_MS &&
    cache.reasoningOnly === requireReasoning;
  if (fresh && cache) return { models: cache.models, stale: false };

  try {
    const res = await fetch(CATALOG_URL, { headers: { accept: "application/json" } });
    if (!res.ok) throw new Error(`catalog fetch failed: HTTP ${res.status}`);
    const body = (await res.json()) as { data?: RawModel[] };
    const models = filterModels(body.data ?? [], { requireReasoning });
    if (models.length === 0) throw new Error("catalog returned no usable models");
    cache = { at: Date.now(), models, reasoningOnly: requireReasoning };
    return { models, stale: false };
  } catch (err) {
    console.warn("[openrouter] falling back to baked model list:", err);
    return { models: FALLBACK_MODELS, stale: true };
  }
}

/**
 * Free models added since `watermark` (unix seconds), newest first.
 *
 * Uses `created`, which is a real monotonic field on every catalog record, so
 * this is a diff rather than a guess about what counts as new.
 */
export function newFreeModelsSince(models: CatalogModel[], watermark: number): CatalogModel[] {
  if (!watermark) return [];
  return models
    .filter((mo) => mo.free && mo.created > watermark)
    .sort((a, b) => b.created - a.created);
}

/** Highest `created` in the catalog, stored as the next watermark. */
export function catalogWatermark(models: CatalogModel[]): number {
  return models.reduce((max, mo) => (mo.created > max ? mo.created : max), 0);
}

/**
 * Models within `days` of their published end date, soonest first.
 *
 * Not free-tier specific: paid models get dated too (`deepseek/deepseek-v3.2`
 * retires 2026-09-28). Callers narrow this to the models a project is actually
 * pinned to, since that is the only case where it is news rather than trivia.
 */
export function expiringModels(models: CatalogModel[], days = 14): CatalogModel[] {
  const cutoff = Date.now() + days * 24 * 60 * 60 * 1000;
  return models
    .filter((mo) => mo.expiresOn && Date.parse(mo.expiresOn) < cutoff)
    .sort((a, b) => Date.parse(a.expiresOn!) - Date.parse(b.expiresOn!));
}
