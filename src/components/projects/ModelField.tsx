import { useEffect, useState } from "react";
import type { AgentDefinition, ModelOption } from "../../agents/types";
import type { CatalogModel } from "../../services/openrouterCatalog";
import {
  ensureRankings,
  getCachedScores,
  onRankingsChange,
  selectForPicker,
  type ScoreMap,
} from "../../services/codingRankings";

interface ModelFieldProps {
  agent: AgentDefinition;
  value: string;
  /**
   * `contextWindow` is handed back so the dialog can persist it on the project.
   * It comes from the catalog and launching has to work offline, so it is
   * recorded at pick time rather than re-fetched per launch.
   */
  onChange: (next: string, contextWindow?: number) => void;
}

const INPUT_CLASS =
  "w-full bg-gray-900 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white " +
  "placeholder-gray-600 focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500";

/**
 * Per-project model picker, in three shapes depending on what the agent knows
 * about its own lineup:
 *
 * - **Live catalog** (`loadModels`) for OpenRouter, where hundreds of models
 *   churn weekly. Free models are grouped first.
 * - **Free text with suggestions** (`freeTextModel`) for Codex, whose lineup
 *   moves faster than this app ships, so a closed list would block a slug the
 *   user knows about and we don't.
 * - **Closed dropdown** for Claude Code, whose lineup is stable and known.
 */
export default function ModelField({ agent, value, onChange }: ModelFieldProps) {
  if (agent.loadModels) return <CatalogPicker agent={agent} value={value} onChange={onChange} />;

  if (!agent.freeTextModel) {
    // A project can hold a model that has since left the catalog (the lineup
    // moves; the stored value doesn't). Without an option to match it the
    // select renders the *first* entry while the project still launches with
    // the stored id — the picker would quietly disagree with the launch.
    const known = agent.models.some((o) => o.value === value);
    const options = known
      ? agent.models
      : [{ value, label: `${value} (not in current lineup)` }, ...agent.models];
    return (
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={INPUT_CLASS + " cursor-pointer"}
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    );
  }

  const listId = `models-${agent.id}`;
  return (
    <>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        list={listId}
        placeholder="Leave blank to use the agent's own default"
        className={INPUT_CLASS + " font-mono"}
      />
      <datalist id={listId}>
        {agent.models
          .filter((o) => o.value)
          .map((opt) => (
            <option key={opt.value} value={opt.value} />
          ))}
      </datalist>
      <p className="text-xs text-gray-500 mt-1">
        Passed as <span className="font-mono">--model</span>. Blank sends no model
        flag, so {agent.label}&apos;s own configured default wins. Suggestions are
        a snapshot and may lag {agent.label} — any valid slug is accepted.
      </p>
    </>
  );
}

/** Live-catalog variant. Falls back to the agent's baked list when offline. */
function CatalogPicker({ agent, value, onChange }: ModelFieldProps) {
  const [models, setModels] = useState<ModelOption[]>(agent.models);
  const [state, setState] = useState<"loading" | "live" | "stale">("loading");
  const [scores, setScores] = useState<ScoreMap>(getCachedScores);

  useEffect(() => {
    let cancelled = false;
    agent
      .loadModels!()
      .then((list) => {
        if (cancelled) return;
        setModels(list);
        // `loadCatalog` resolves with the baked list rather than rejecting when
        // the fetch fails, so identity against `agent.models` is what actually
        // distinguishes a live catalog from the fallback.
        setState(list === agent.models ? "stale" : "live");
      })
      .catch(() => !cancelled && setState("stale"));
    return () => {
      cancelled = true;
    };
  }, [agent]);

  // Two jobs. Re-render when a ranking pass lands while this dialog is open
  // (the load-time warmup may still be waiting on the CLI), and kick a pass if
  // none has been triggered yet — the case where the user just added the
  // first OpenRouter project without a restart.
  useEffect(() => {
    const off = onRankingsChange(() => setScores(getCachedScores()));
    void ensureRankings();
    return off;
  }, []);

  // The picker shows the coding top picks, not the whole filtered catalog, so
  // "pinned" now has two sources: a model the catalog filter excludes, and one
  // that exists but didn't make the cut. Either way the select must display
  // what the project will actually launch with, rather than silently showing
  // the first option while launching something else.
  const catalog = models as CatalogModel[];
  const { free, paid, ranked } = selectForPicker(catalog, scores);
  const shown = new Set([...free, ...paid].map((mo) => mo.value));
  const selected = value ? catalog.find((mo) => mo.value === value) : undefined;
  const pinned: ModelOption[] =
    value && !shown.has(value)
      ? [
          selected
            ? { value, label: `${selected.label} · outside the top picks` }
            : { value, label: `${value} (not in current catalog)` },
        ]
      : [];

  const labelFor = (mo: CatalogModel) => {
    const score = scores[mo.value];
    return score == null ? mo.label : `${mo.label} · coding ${score}`;
  };

  return (
    <>
      <select
        value={value}
        onChange={(e) => {
          const next = e.target.value;
          onChange(next, models.find((mo) => mo.value === next)?.contextWindow);
        }}
        className={INPUT_CLASS + " cursor-pointer"}
        disabled={state === "loading"}
      >
        <option value="">
          {state === "loading" ? "Loading catalog…" : "Select a model…"}
        </option>
        {pinned.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
        {free.length > 0 && (
          <optgroup label={ranked ? "Free · best for coding" : "Free"}>
            {free.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {labelFor(opt)}
              </option>
            ))}
          </optgroup>
        )}
        {paid.length > 0 && (
          <optgroup
            label={
              ranked
                ? "Paid · best for coding, under $1 per M output"
                : "Paid, under $1 per M output"
            }
          >
            {paid.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {labelFor(opt)}
              </option>
            ))}
          </optgroup>
        )}
      </select>

      <p className="text-xs text-gray-500 mt-1">
        {state === "stale"
          ? "Couldn't reach OpenRouter, so this is the list built into this version. "
          : ranked
            ? "Live from OpenRouter, top coding models by a weekly local Claude pass. The rest of the sub-$1 catalog is hidden; a model a project pins to still appears. "
            : "Live from OpenRouter, filtered to tool-capable reasoning models under $1/M output, ordered by price while coding rankings are pending. "}
        Free models are rate-limited and need prompt logging enabled on your
        OpenRouter account.
      </p>

      <p className="text-xs text-amber-500/80 mt-1">
        Claude Code prices unknown models at Anthropic rates, so its{" "}
        <span className="font-mono">/cost</span> readout will read far too high.
        Check real spend on OpenRouter.
      </p>
    </>
  );
}
