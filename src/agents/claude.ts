import type { AgentDefinition } from "./types";

/**
 * Claude Code. The launcher's original (and until multi-agent support, only)
 * target. Its capability set is the baseline the others are measured against —
 * everything here was built directly against Claude Code's protocols.
 */
export const claudeAgent: AgentDefinition = {
  id: "claude",
  label: "Claude Code",
  defaultBinary: "claude",

  flags: [
    {
      name: "--dangerously-skip-permissions",
      label: "Skip Permissions",
      description: "Skip the permission prompt for tool use (use with caution)",
    },
    {
      name: "--verbose",
      label: "Verbose Output",
      description: "Enable verbose logging output",
    },
    {
      name: "--remote-control",
      label: "Remote Control",
      description:
        "Connect the session to claude.ai/code and the Claude mobile app, as if you typed /rc the moment it started. On by default.",
      defaultEnabled: true,
    },
  ],

  quickFlag: "--dangerously-skip-permissions",

  // Read from the installed CLI's own model catalog on 2026-09-02
  // (`claude-fable-5-1` replaced `claude-fable-5`; the `fable` alias now
  // resolves to 5.1, and `opus`/`sonnet`/`haiku` resolve to the ids below).
  // Full ids rather than aliases so a project pins the model it was set to.
  models: [
    { value: "claude-opus-5", label: "Opus 5 (default)" },
    { value: "claude-sonnet-5", label: "Sonnet 5" },
    { value: "claude-fable-5-1", label: "Fable 5.1" },
    { value: "claude-haiku-4-5", label: "Haiku 4.5" },
    { value: "", label: "CLI default (no --model flag)" },
  ],

  defaultModel: "claude-opus-5",

  buildModelFlag(model) {
    return model ? `--model=${model}` : null;
  },

  // None. Claude Code's only hidden subcommand, `claude remote-control`, is a
  // headless bridge *host* for driving sessions from claude.ai — not a coding
  // session. It rejects --model, --verbose and --dangerously-skip-permissions,
  // so the launcher could never have combined it with its own flags. Remote
  // Control is the `--remote-control` session flag above instead.
  subcommand: null,

  clearCommand: "/clear",

  capabilities: {
    chimes: true,
    modelInTitle: true,
    ideHooks: true,
    osc9Status: false,
    notifyHook: false, // uses the richer Stop/Notification hooks instead
    claudeRendererEnv: true,
    modelSniffing: true,
  },
};
