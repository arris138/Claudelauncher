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
  // ⚠️ Provisional and known-unstable. `~/.codex/models_cache.json` is
  // server-refreshed and churns fast: on 2026-07-19 it changed shape twice
  // within hours, and by 2026-07-20 the entire GPT-5.6 line (sol/terra/luna)
  // had appeared, `gpt-5.4`/`gpt-5.4-mini` had flipped to visibility:"hide",
  // and `gpt-5.3-codex` + `gpt-5.2` — both shipped in this list — had vanished
  // from the cache outright. `codex --help` does not enumerate models at all.
  // So this list is a convenience, not an authority — the leading empty entry
  // (send no --model, let ~/.codex/config.toml's `model` key win) is the
  // reliable default and is why defaultModel is "".
  //
  // Mirrors the visibility:"list" entries, in `priority` order, as of
  // 2026-07-20 (codex-cli 0.144.6). Hidden/internal slugs are omitted.
  models: [
    { value: "", label: "Codex config default (no --model flag)" },
    { value: "gpt-5.6-sol", label: "GPT-5.6-Sol" },
    { value: "gpt-5.6-terra", label: "GPT-5.6-Terra" },
    { value: "gpt-5.6-luna", label: "GPT-5.6-Luna" },
    { value: "gpt-5.5", label: "GPT-5.5" },
  ],

  freeTextModel: true,

  // Empty, i.e. pass no --model and let ~/.codex/config.toml's `model` key win.
  // Codex users configure a default there and the launcher has no business
  // overriding it silently; Claude's picker defaults to a concrete model
  // because Claude Code has no equivalent user-level default.
  defaultModel: "",

  buildModelFlag(model) {
    return model ? `--model=${model}` : null;
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
