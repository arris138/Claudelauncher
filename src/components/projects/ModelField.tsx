import { useEffect, useState } from "react";
import type { AgentDefinition, ModelOption } from "../../agents/types";

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

  // A project pinned to a model the current filter excludes (price moved, or
  // reasoning support was dropped) must still show what it will actually
  // launch with, rather than silently displaying someone else's model.
  const known = models.some((o) => o.value === value);
  const pinned: ModelOption[] =
    value && !known ? [{ value, label: `${value} (not in current catalog)` }] : [];

  const free = models.filter((mo) => mo.free);
  const paid = models.filter((mo) => !mo.free);

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
          <optgroup label="Free">
            {free.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </optgroup>
        )}
        {paid.length > 0 && (
          <optgroup label="Paid, under $1 per M output">
            {paid.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </optgroup>
        )}
      </select>

      <p className="text-xs text-gray-500 mt-1">
        {state === "stale"
          ? "Couldn't reach OpenRouter, so this is the list built into this version. "
          : "Live from OpenRouter, filtered to tool-capable reasoning models under $1/M output. "}
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
