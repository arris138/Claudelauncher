// Type-only import; erased at compile time, so the mutual reference with
// agents/types.ts (which imports FlagDefinition from here) creates no runtime cycle.
import type { AgentId } from "../agents/types";

export type { AgentId };

export interface Project {
  id: string;
  name: string;
  path: string;
  /**
   * Which agent CLI this project launches. Optional: projects created before
   * multi-agent support have no value and are read as "claude", so no store
   * migration is needed. Always read via `getAgent(project.agentId)`.
   */
  agentId?: AgentId;
  flagOverrides: FlagOverrides;
  preLaunchCommand?: string;
  createdAt: string;
  lastLaunchedAt: string | null;
  /** Hex color (`#rrggbb`) used for the terminal tab and UI accent. */
  color?: string;
  /** Terminal tab/window title. Falls back to the project name when unset. */
  tabTitle?: string;
  /** When true, let Claude Code's own dynamic titles replace the tab title. */
  dynamicTitle?: boolean;
  /**
   * When true, the launcher leaves the tab title un-suppressed and writes a
   * path→name entry so the installed statusLine can keep "<name> — <model>"
   * live in the tab as the model is swapped mid-session.
   */
  modelInTitle?: boolean;
  /**
   * Model passed via --model. Unset falls back to DEFAULT_MODEL;
   * empty string means launch with no --model flag (CLI default).
   */
  model?: string;
  /**
   * IDE-mode terminal renderer override. Unset inherits the global setting.
   * "fullscreen" runs Claude's alt-screen TUI; "classic" forces the
   * scrollback renderer (CLAUDE_CODE_DISABLE_ALTERNATE_SCREEN).
   */
  ideRenderer?: IdeRenderer;
}

/** Which Claude Code renderer an embedded IDE-mode session runs with. */
export type IdeRenderer = "fullscreen" | "classic";

export type FlagOverrides = Record<string, boolean | undefined>;

export interface FlagDefinition {
  name: string;
  label: string;
  description: string;
}

export interface GlobalFlagState {
  flagName: string;
  enabled: boolean;
}

export interface GlobalSettings {
  /**
   * Per-agent executable paths, keyed by agent id. Falls back to the agent's
   * `defaultBinary` when absent.
   */
  agentPaths?: Partial<Record<AgentId, string>>;
  /** Per-agent global flag state, keyed by agent id. */
  agentFlags?: Partial<Record<AgentId, GlobalFlagState[]>>;
  /** Per-agent user-added custom flags, keyed by agent id. */
  agentCustomFlags?: Partial<Record<AgentId, string[]>>;
  /** Per-agent subcommand toggles (e.g. Claude's remote control). */
  agentSubcommands?: Partial<Record<AgentId, boolean>>;

  /**
   * The four fields below predate multi-agent support. They remain the
   * authoritative values that the app reads and writes until Phase 3 switches
   * consumers over to the agent-keyed maps above, and are deleted in Phase 6.
   * Keeping them one release long means a user who upgrades, reconfigures and
   * then downgrades doesn't lose their path and flags.
   *
   * @deprecated Read `agentPaths` / `agentFlags` / `agentCustomFlags` /
   * `agentSubcommands` instead.
   */
  claudePath: string;
  /** @deprecated see `claudePath` */
  globalFlags: GlobalFlagState[];
  /** @deprecated see `claudePath` */
  customFlags: string[];
  /** @deprecated see `claudePath` */
  remoteControl: boolean;

  terminalProfile: string;
  /** Which top-level UI is shown. Defaults to "launcher". */
  uiMode: UiMode;
  /**
   * Default renderer for embedded IDE-mode sessions. Per-project
   * `Project.ideRenderer` overrides this. Defaults to "fullscreen".
   */
  ideRenderer: IdeRenderer;
  /**
   * Use the GPU (WebGL) renderer for IDE-mode terminals. Defaults to false —
   * the DOM renderer. WebGL is faster but its glyph atlas is fragile under
   * WebView2 (stale/garbled glyphs, column-0 clipping); VS Code's own
   * /terminal-setup for Claude Code turns GPU acceleration off for the same
   * reason. Applies to newly opened sessions.
   */
  ideGpu?: boolean;
  /**
   * Font size (px) for IDE-mode terminals, adjustable from the session rail.
   * Applies to every agent's terminal and takes effect on the live session.
   * Defaults to IDE_FONT_SIZE_DEFAULT.
   */
  ideFontSize?: number;
  /**
   * Install a `notify` turn-completion callback for agents that support one
   * (currently Codex), in both Windows Terminal tabs and IDE sessions. Gives a
   * chime on turn completion everywhere, plus a real `complete` status in IDE
   * mode. Off by default: the mechanism is inferred from the Codex binary
   * rather than confirmed against a live turn, and when it doesn't fire the
   * only symptom is silence. See CODEX_NOTIFY_TEMPLATE in lib.rs.
   */
  agentNotifyHook?: boolean;
}

/** Bounds for `GlobalSettings.ideFontSize`. */
export const IDE_FONT_SIZE_DEFAULT = 12.5;
export const IDE_FONT_SIZE_MIN = 8;
export const IDE_FONT_SIZE_MAX = 28;
export const IDE_FONT_SIZE_STEP = 0.5;

export type UiMode = "launcher" | "ide";

/** Live status of an embedded IDE-mode session. */
export type SessionStatus =
  | "starting" // PTY spawning
  | "idle" // alive, no output flowing — waiting for the user
  | "working" // actively producing output (processing)
  | "waiting" // Notification hook fired — needs user input
  | "complete" // Stop hook fired
  | "exited"; // PTY died

/**
 * A runtime-only embedded Claude session. Derived from a Project at launch;
 * never persisted across app restarts.
 */
export interface Session {
  id: string; // uuid; also passed to the PTY as CLAUDE_LAUNCHER_SESSION
  projectId: string;
  title: string; // call-sign shown in the rail
  cwd: string;
  model?: string;
  /** Friendly model name parsed live from Claude's output (e.g. "Sonnet 4.6"). */
  liveModel?: string;
  color?: string;
  /** Free-text label shown under the title (replaces the cwd line when set). */
  note?: string;
  /** Hex color (`#rrggbb`) for the note text. Falls back to the muted meta color. */
  noteColor?: string;
  flags: string[];
  status: SessionStatus;
  exitCode?: number | null;
  startedAt: number; // epoch ms
  lastActivityAt: number; // epoch ms — drives the idle timer
  unseen: boolean; // true while blinking; cleared on focus
}

export interface AppData {
  projects: Project[];
  settings: GlobalSettings;
}

export type SortField = "name" | "lastLaunchedAt" | "createdAt";
export type SortDirection = "asc" | "desc";

export interface SortConfig {
  field: SortField;
  direction: SortDirection;
}

export interface LaunchResult {
  success: boolean;
  command: string;
  error: string | null;
}
