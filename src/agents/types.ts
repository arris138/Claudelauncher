import type { FlagDefinition } from "../types";

/** Agent CLIs the launcher knows how to spawn. */
export type AgentId = "claude" | "codex";

/**
 * Features that exist only because a specific agent implements a specific
 * protocol. Anything false here must hide its UI rather than silently no-op —
 * a disabled button the user can press and get nothing from is worse than an
 * absent one.
 */
export interface AgentCapabilities {
  /** Launcher can install an audible completion cue for this agent. */
  chimes: boolean;
  /** Agent supports the live "<name> — <model>" tab title statusline. */
  modelInTitle: boolean;
  /** Agent POSTs lifecycle events to the local IDE listener via global hooks. */
  ideHooks: boolean;
  /** Agent emits OSC 9 notifications into the PTY stream. */
  osc9Status: boolean;
  /**
   * Agent honours the CLAUDE_CODE_* renderer env vars (alternate screen,
   * no-flicker, full-repaint). See the emulation contract in CLAUDE.md.
   */
  claudeRendererEnv: boolean;
  /** Agent's banner output can be regex-sniffed for a live model name. */
  modelSniffing: boolean;
}

export interface ModelOption {
  value: string;
  label: string;
}

/**
 * Everything that differs between agent CLIs. The UI asks a definition what to
 * render and the launcher services ask it how to build arguments; the Rust side
 * receives only the resolved result and never branches on which agent it is.
 */
export interface AgentDefinition {
  id: AgentId;
  /** Display name shown in pickers and badges. */
  label: string;
  /** Bare command name used when no explicit path is configured. */
  defaultBinary: string;
  /** Built-in flag catalog for Settings and per-project overrides. */
  flags: FlagDefinition[];
  /** Choices for the per-project model picker. */
  models: ModelOption[];
  /** Used when a project specifies no model. "" means pass no model flag. */
  defaultModel: string;
  /** Builds the model argument, or null to pass none. */
  buildModelFlag(model: string): string | null;
  /**
   * Subcommand inserted before flags, or null for none. Claude uses
   * "remote-control"; it is gated behind a setting, hence the separate toggle.
   */
  subcommand: string | null;
  capabilities: AgentCapabilities;
}
