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
  ],

  quickFlag: "--dangerously-skip-permissions",

  models: [
    { value: "claude-opus-4-8", label: "Opus 4.8 (default)" },
    { value: "claude-fable-5", label: "Fable 5" },
    { value: "claude-sonnet-4-6", label: "Sonnet 4.6" },
    { value: "claude-haiku-4-5", label: "Haiku 4.5" },
    { value: "", label: "CLI default (no --model flag)" },
  ],

  defaultModel: "claude-opus-4-8",

  buildModelFlag(model) {
    return model ? `--model=${model}` : null;
  },

  // Only applied when the remote-control setting is on; the launcher services
  // decide whether to send it.
  subcommand: "remote-control",

  clearCommand: "/clear",

  capabilities: {
    chimes: true,
    modelInTitle: true,
    ideHooks: true,
    osc9Status: false,
    claudeRendererEnv: true,
    modelSniffing: true,
  },
};
