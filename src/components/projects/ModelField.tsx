import type { AgentDefinition } from "../../agents/types";

interface ModelFieldProps {
  agent: AgentDefinition;
  value: string;
  onChange: (next: string) => void;
}

const INPUT_CLASS =
  "w-full bg-gray-900 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white " +
  "placeholder-gray-600 focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500";

/**
 * Per-project model picker. A closed dropdown for agents with a stable, known
 * lineup (Claude Code); free text with suggestions for agents whose models move
 * faster than this app ships (Codex) — there, a stale dropdown would silently
 * prevent the user from selecting a model that actually exists.
 */
export default function ModelField({ agent, value, onChange }: ModelFieldProps) {
  if (!agent.freeTextModel) {
    return (
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={INPUT_CLASS + " cursor-pointer"}
      >
        {agent.models.map((opt) => (
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
