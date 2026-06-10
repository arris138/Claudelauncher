/** Model passed to Claude via --model when a project doesn't specify one. */
export const DEFAULT_MODEL = "claude-opus-4-8";

/** Selectable models for the per-project model picker. */
export const MODEL_OPTIONS: { value: string; label: string }[] = [
  { value: "claude-opus-4-8", label: "Opus 4.8 (default)" },
  { value: "claude-fable-5", label: "Fable 5" },
  { value: "claude-sonnet-4-6", label: "Sonnet 4.6" },
  { value: "claude-haiku-4-5", label: "Haiku 4.5" },
  { value: "", label: "CLI default (no --model flag)" },
];
