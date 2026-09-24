import { EFFORT_INHERIT, type AgentDefinition } from "../../agents/types";

interface EffortFieldProps {
  agent: AgentDefinition;
  value: string;
  onChange: (next: string) => void;
  /**
   * When set, a leading "follow the global default" option is offered, with
   * this text as its label. Omit it where there is no global to follow (the
   * Settings picker itself).
   */
  inheritLabel?: string;
  /** Overrides the help text under the dropdown. */
  help?: string;
}

const INPUT_CLASS =
  "w-full bg-gray-900 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white " +
  "placeholder-gray-600 focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500";

/**
 * Per-project reasoning-effort picker. A closed dropdown, unlike ModelField:
 * effort is a small fixed vocabulary the agent validates, not a lineup that
 * moves between releases, so there is nothing for free text to rescue.
 *
 * Renders nothing when the agent has no effort concept. Callers still guard on
 * `agent.efforts` so the surrounding label doesn't render either.
 */
export default function EffortField({
  agent,
  value,
  onChange,
  inheritLabel,
  help,
}: EffortFieldProps) {
  if (!agent.efforts) return null;

  // Same guard as ModelField: a project can hold a level the agent has since
  // dropped. Show it rather than silently rendering the first entry while
  // launching the stored one.
  const levels = inheritLabel
    ? [{ value: EFFORT_INHERIT, label: inheritLabel }, ...agent.efforts]
    : agent.efforts;
  const known = levels.some((o) => o.value === value);
  const options = known
    ? levels
    : [{ value, label: `${value} (not a current level)` }, ...levels];

  return (
    <>
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
      <p className="text-xs text-gray-500 mt-1">
        {help ??
          `How much reasoning ${agent.label} does per turn. This is a compute dial, not a model switch. "No override" sends nothing, so ${agent.label}'s own configured effort wins.`}
      </p>
    </>
  );
}
