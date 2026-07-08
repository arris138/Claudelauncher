export interface Project {
  id: string;
  name: string;
  path: string;
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
  claudePath: string;
  terminalProfile: string;
  globalFlags: GlobalFlagState[];
  customFlags: string[];
  remoteControl: boolean;
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
}

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
