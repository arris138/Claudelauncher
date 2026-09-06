import type { AgentDefinition } from "./types";

/**
 * OpenAI Codex CLI.
 *
 * Flags below were read from the installed binary (`codex --help`) on
 * 2026-07-19 at **codex-cli 0.144.6** — not from documentation, which
 * disagreed with the binary on several points.
 *
 * ⚠️ Codex self-updates and its surface moves. Within a single afternoon this
 * machine went 0.101.0 → 0.144.6 and `--full-auto` was removed outright — a
 * flag this catalog had shipped, which would have made a launch fail with an
 * unknown-argument error. Re-verify with `codex --help` before trusting this
 * list, and prefer custom flags over adding built-ins that can vanish.
 */
export const codexAgent: AgentDefinition = {
  id: "codex",
  label: "Codex",
  defaultBinary: "codex",

  flags: [
    {
      name: "--dangerously-bypass-approvals-and-sandbox",
      label: "Bypass Approvals & Sandbox",
      description:
        "Skip all confirmation prompts and run commands unsandboxed (use with caution). The rough equivalent of Claude's skip-permissions.",
    },
    {
      name: "--search",
      label: "Web Search",
      description: "Enable live web search for the session.",
    },
    {
      name: "--no-alt-screen",
      label: "Inline Mode",
      description:
        "Run the TUI inline instead of in the alternate screen, preserving terminal scrollback.",
    },
  ],

  quickFlag: "--dangerously-bypass-approvals-and-sandbox",

  // Suggestions only — the field is free text (see freeTextModel), so a slug
  // missing from this list is still enterable.
  //
  // Deliberately pruned to the three we actually use. `~/.codex/models_cache.json`
  // is server-refreshed and churns fast: between 2026-07-19 and 2026-09-06 the
  // GPT-5.6 line (sol/terra/luna) appeared, `gpt-5.4`/`gpt-5.3-codex` vanished
  // outright, and `gpt-6-astra` arrived at priority 1. `codex --help` does not
  // enumerate models at all, so read the cache, not the docs.
  //
  // Verified against the cache on 2026-09-06 (codex-cli 0.153.4). Omitted by
  // choice, not staleness: gpt-5.6-luna, gpt-5.5, gpt-5.4-mini,
  // gpt-5.3-codex-spark. The leading empty entry defers to
  // ~/.codex/config.toml's `model` key.
  models: [
    { value: "", label: "Codex config default (no --model flag)" },
    { value: "gpt-6-astra", label: "GPT-6-Astra" },
    { value: "gpt-5.6-sol", label: "GPT-5.6-Sol" },
    { value: "gpt-5.6-terra", label: "GPT-5.6-Terra" },
  ],

  freeTextModel: true,

  // Pinned rather than deferred: the launcher sends --model=gpt-5.6-sol unless a
  // project overrides it. Pick the empty option above to hand the choice back to
  // ~/.codex/config.toml.
  defaultModel: "gpt-5.6-sol",

  buildModelFlag(model) {
    return model ? `--model=${model}` : null;
  },

  // Codex's analogue of the ChatGPT app's compute slider. Not a model router:
  // it varies how much reasoning one model does. Read from every listed model's
  // `supported_reasoning_levels` in ~/.codex/models_cache.json on 2026-09-06 —
  // astra, sol and terra all carry the same six, so one shared list is honest.
  // `ultra` is Codex-only and has no Messages API counterpart; the other five
  // mirror the API's `reasoning.effort` scale.
  efforts: [
    { value: "", label: "Codex config default (no override)" },
    { value: "low", label: "Low" },
    { value: "medium", label: "Medium" },
    { value: "high", label: "High" },
    { value: "xhigh", label: "Extra high" },
    { value: "max", label: "Max" },
    { value: "ultra", label: "Ultra (auto task delegation)" },
  ],

  // Note this overrides the *model's* own default, which differs per model —
  // sol defaults to "low", astra and terra to "medium".
  defaultEffort: "medium",

  // `--config=k=v`, not `-c k=v`. Two reasons, both load-bearing: the Rust
  // side's `is_safe_flag` rejects any flag not starting with `--`, and a single
  // "-c k=v" string would reach the process as one argv entry rather than two.
  // Clap accepts the long `=` form, verified against codex-cli 0.153.4.
  buildEffortFlag(effort) {
    return effort ? `--config=model_reasoning_effort=${effort}` : null;
  },

  subcommand: null,

  // Codex ships a /clear too — the binary carries a "startup resume clear
  // compact" command cluster and thread/compact RPCs. Verified by string
  // inspection rather than by running it, so if Clear misbehaves for Codex
  // sessions this is the line to doubt first.
  clearCommand: "/clear",

  capabilities: {
    // Reflects what the launcher currently implements for this agent, not what
    // the agent is theoretically able to do.
    chimes: false, // Phase 5: install a notify hook in ~/.codex/config.toml
    modelInTitle: false, // no statusLine analogue
    ideHooks: false, // no Claude-style Stop/Notification hooks
    // Codex's OSC 9 turned out to be a single untyped notification (one
    // PostNotification emitter in the binary, no event vocabulary, and no
    // "approval-requested" string at all), so it cannot distinguish
    // waiting from complete. The notify callback is used instead.
    osc9Status: false,
    notifyHook: true,
    claudeRendererEnv: false,
    modelSniffing: false,
  },
};
