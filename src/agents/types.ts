import type { FlagDefinition } from "../types";

/** Agent CLIs the launcher knows how to spawn. */
export type AgentId = "claude" | "codex" | "openrouter";

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
   * Agent supports a `notify` callback the launcher can point at its own IDE
   * listener to get turn-completion status. Unlike `ideHooks` this yields
   * `complete` only — there is no approval-time event to drive `waiting`.
   */
  notifyHook: boolean;
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
  /** Context window in tokens, when the source knows it. */
  contextWindow?: number;
  /** Costs nothing to run. Sorted to the top of the picker. */
  free?: boolean;
  /** Renderable price, e.g. "$0.09/$0.30 per M". Omitted when unknown. */
  price?: string;
}

/** What `buildEnv` is told about the launch it is building an environment for. */
export interface AgentEnvContext {
  /** The resolved model id, after per-project and default fallbacks. */
  model: string;
  /**
   * Context window of that model in tokens, when the catalog knows it. Absent
   * for a model the launcher has no record of, in which case an agent should
   * set no window variable and let the agent CLI use its own assumption.
   */
  contextWindow?: number;
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
  /**
   * Flag offered as the single quick toggle in the Add Project dialog — each
   * agent's "let it run without asking" flag. Named explicitly rather than
   * taken as `flags[0]`, so reordering the catalog can't silently change which
   * flag that checkbox sets.
   */
  quickFlag?: string;
  /** Choices for the per-project model picker. */
  models: ModelOption[];
  /**
   * Render the model field as free text with `models` offered as suggestions,
   * rather than a closed dropdown. For agents whose model lineup moves faster
   * than this app ships, a dropdown is a liability: it goes stale silently and
   * can't express a slug the user knows about and we don't.
   */
  freeTextModel?: boolean;
  /** Used when a project specifies no model. "" means pass no model flag. */
  defaultModel: string;
  /** Builds the model argument, or null to pass none. */
  buildModelFlag(model: string): string | null;
  /**
   * Choices for the per-project reasoning-effort picker. Omitted entirely for
   * agents with no effort concept, so the field hides rather than rendering a
   * control that sends nothing — same rule as `capabilities`.
   *
   * Unlike `models`, this is a closed dropdown: the level vocabulary is a small
   * fixed set the agent validates, not a lineup that churns.
   */
  efforts?: ModelOption[];
  /** Used when a project specifies no effort. "" means pass no effort flag. */
  defaultEffort?: string;
  /** Builds the reasoning-effort argument, or null to pass none. */
  buildEffortFlag?(effort: string): string | null;
  /**
   * Environment variables to set for the session, beyond what the launcher
   * sets for itself. This is how an agent points its CLI at a third-party
   * endpoint without the Rust side learning that third-party endpoints exist.
   * Names must be SCREAMING_SNAKE; the backend rejects anything else.
   */
  buildEnv?(ctx: AgentEnvContext): Array<[string, string]>;
  /**
   * Environment variable the project's stored API key belongs in. Setting it
   * is what makes the key field appear in the project dialogs. The key itself
   * never reaches the frontend: the backend resolves it from the Windows
   * Credential Manager at spawn time, keyed by project id.
   */
  secretEnvVar?: string;
  /** Copy for the API key field. Required whenever `secretEnvVar` is set. */
  secretHelp?: {
    label: string;
    placeholder: string;
    /** Where to get a key. Rendered as a link. */
    url: string;
  };
  /**
   * Fetch the model list at runtime instead of using the static `models`
   * array, which then serves as the offline fallback. For a catalog with
   * hundreds of entries that churn weekly, a shipped list is wrong the day
   * after it ships — the failure mode `codex.ts` documents three times.
   */
  loadModels?(): Promise<ModelOption[]>;
  /**
   * Subcommand inserted before flags, or null for none. Claude uses
   * "remote-control"; it is gated behind a setting, hence the separate toggle.
   */
  subcommand: string | null;
  /**
   * Slash command the IDE "Clear" button types into the session, or null to
   * hide the button for this agent.
   */
  clearCommand: string | null;
  capabilities: AgentCapabilities;
}
