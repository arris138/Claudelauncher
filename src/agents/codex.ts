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

  // ⚠️ Provisional and known-unstable. `~/.codex/models_cache.json` is
  // server-refreshed and changed shape within hours on 2026-07-19: first six
  // models with five marked visibility:"list", then three with ALL marked
  // "hide". `codex --help` does not enumerate models at all. So this list is a
  // convenience, not an authority — the leading empty entry (send no --model,
  // let ~/.codex/config.toml's `model` key win) is the reliable default and is
  // why defaultModel is "".
  models: [
    { value: "", label: "Codex config default (no --model flag)" },
    { value: "gpt-5.5", label: "GPT-5.5" },
    { value: "gpt-5.4", label: "GPT-5.4" },
    { value: "gpt-5.4-mini", label: "GPT-5.4-Mini" },
    { value: "gpt-5.3-codex", label: "GPT-5.3-Codex" },
    { value: "gpt-5.2", label: "GPT-5.2" },
  ],

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
    ideHooks: false, // no HTTP callback; uses osc9Status instead
    osc9Status: false, // Phase 4: parse OSC 9 out of the PTY stream
    claudeRendererEnv: false,
    modelSniffing: false,
  },
};
