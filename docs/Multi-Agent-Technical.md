# Multi-Agent Support — Technical Companion

**Plan document**: [Multi-Agent.md](./Multi-Agent.md)
**Last Updated**: 2026-07-19

Build-time detail for the multi-agent work: the registry interface, the Codex flag/model
matrix, the `LaunchRequest` contract change, TOML merge rules, and the OSC 9 capture
recipe. Read the plan document first for architecture and rationale.

---

## 1. Agent registry interface

`src/agents/types.ts`:

```ts
export type AgentId = "claude" | "codex";

/**
 * Features that exist only because a specific agent implements a specific
 * protocol. Anything false here must hide its UI, not silently no-op.
 */
export interface AgentCapabilities {
  /** Agent can be given an audible completion cue by the launcher. */
  chimes: boolean;
  /** Agent supports the "<name> — <model>" live tab title statusline. */
  modelInTitle: boolean;
  /** Agent POSTs lifecycle events to the local IDE listener via global hooks. */
  ideHooks: boolean;
  /** Agent emits OSC 9 notifications into the PTY stream. */
  osc9Status: boolean;
  /** Agent honours CLAUDE_CODE_* renderer env vars. */
  claudeRendererEnv: boolean;
  /** Agent's banner/output can be regex-sniffed for a live model name. */
  modelSniffing: boolean;
}

export interface ModelOption {
  value: string;
  label: string;
}

export interface AgentDefinition {
  id: AgentId;
  label: string;
  /** Bare command name used when no explicit path is configured. */
  defaultBinary: string;
  /** Built-in flag catalog shown in Settings and the per-project override list. */
  flags: FlagDefinition[];
  models: ModelOption[];
  /** Used when a project has no explicit model. "" means pass no model flag. */
  defaultModel: string;
  /** Builds the model argument, or null to pass none. */
  buildModelFlag(model: string): string | null;
  /** Subcommand inserted before flags, or null. Claude: "remote-control". */
  subcommand: string | null;
  capabilities: AgentCapabilities;
}
```

`src/agents/registry.ts` exposes `ALL_AGENTS: AgentDefinition[]` and
`getAgent(id?: string): AgentDefinition`, which **must** fall back to the Claude
definition for `undefined` or an unrecognised id. That fallback is what makes
`Project.agentId` safe to leave optional.

### Capability matrix

| Capability | Claude | Codex | Notes |
|---|---|---|---|
| `chimes` | ✅ | ✅ (Phase 5) | Claude via `settings.json` hooks; Codex via `config.toml` `notify` |
| `modelInTitle` | ✅ | ❌ | Requires Claude's `statusLine` contract; no analogue |
| `ideHooks` | ✅ | ❌ | Claude Stop/Notification → HTTP listener |
| `osc9Status` | ❌ | ✅ | Codex `[tui] notification_method = "osc9"` |
| `claudeRendererEnv` | ✅ | ❌ | `CLAUDE_CODE_NO_FLICKER`, `_DISABLE_ALTERNATE_SCREEN`, `_ALT_SCREEN_FULL_REPAINT` |
| `modelSniffing` | ✅ | ❌ | `Terminal.tsx:108` regexes match Claude's banner only |

---

## 2. Codex CLI surface

> ✅ **Verified against the binary** — `codex --help`, codex-cli **0.101.0**, 2026-07-19.
> Three entries in the earlier provisional table were wrong and have been corrected
> (noted inline). Re-verify after a Codex upgrade.

### Flags

| Long form | Short | Values | Launcher use |
|---|---|---|---|
| `--model=<id>` | `-m` | model id | Built by `buildModelFlag` |
| `--sandbox=<policy>` | `-s` | `read-only`, `workspace-write`, `danger-full-access` | Candidate custom flag |
| `--ask-for-approval=<mode>` | `-a` | `untrusted`, `on-failure`, `on-request`, `never` | Candidate custom flag — **4 values, not 3** |
| `--dangerously-bypass-approvals-and-sandbox` | — | — | Built-in catalog; the `--dangerously-skip-permissions` analogue. **There is no `--yolo` alias** |
| `--full-auto` | — | — | Built-in catalog. Shorthand for `-a on-request --sandbox workspace-write` |
| `--search` | — | — | Built-in catalog (live web search) |
| `--no-alt-screen` | — | — | Built-in catalog. Inline TUI — the flag analogue of `CLAUDE_CODE_DISABLE_ALTERNATE_SCREEN`; see Phase 4 |
| `--cd=<path>` | `-C` | path | **Not used** — cwd is set by `wt -d` / `CommandBuilder::cwd` |
| `--add-dir=<path>` | — | path | Candidate custom flag |
| `--config=<k>=<v>` | `-c` | key=value | Custom flags only; see the escaping note below |
| `--profile=<name>` | `-p` | profile name | Custom flags only |
| `--enable` / `--disable` | — | feature name | Custom flags only |
| `--image=<path>` | `-i` | path | Not applicable to a launcher |
| `--oss` / `--local-provider` | — | `lmstudio`, `ollama` | Out of scope |

Subcommands exist (`exec`, `review`, `resume`, `fork`, `apply`, `mcp`, `cloud`, …) but
none is wanted for an interactive launch, so `codexAgent.subcommand` is `null`.

### Executable location

Codex ships as an npm global, so on this machine it is `%APPDATA%\npm\codex.cmd` — not
under `~/.local/bin` or `Programs\`. `detect_agent_path` probes the npm shim directory
for both `.cmd` and `.exe`.

**`.cmd` shims are directly spawnable.** Verified empirically: `CreateProcess` with
`UseShellExecute=false` (what `std::process::Command` and `portable_pty` use) executes
`codex.cmd` and returns its output normally. No `cmd /c` wrapper is needed. This is worth
stating because the opposite is commonly assumed. Prefer `.cmd` over the `.ps1` sibling,
which does need a PowerShell host.

**Only long forms are usable.** `is_safe_flag` (`src-tauri/src/lib.rs:75`) returns early
unless the string starts with `--`, so `-m gpt-x` is rejected at the Rust boundary. All
values must be attached with `=` because the launcher passes each flag as one discrete
process argument — a space-separated `--sandbox workspace-write` would arrive as a single
argv entry and fail to parse.

**`--config` escaping caveat.** `is_safe_flag` also rejects any `=value` portion
containing shell metacharacters (`; | & \` $ ( ) { } < > !` and newlines) — see
`SHELL_METACHARACTERS` at `lib.rs:63`. TOML values with those characters cannot be passed
this way. Document this in the custom-flag UI rather than loosening the validator.

### Models

`codex --help` does **not** enumerate models. The authoritative local source is
`~/.codex/models_cache.json`, which Codex refreshes from the server. As read on
2026-07-19 (cache fetched 2026-05-20):

| Slug | Display name | Visibility |
|---|---|---|
| `gpt-5.5` | GPT-5.5 | list |
| `gpt-5.4` | gpt-5.4 | list |
| `gpt-5.4-mini` | GPT-5.4-Mini | list |
| `gpt-5.3-codex` | gpt-5.3-codex | list |
| `gpt-5.2` | gpt-5.2 | list |
| `codex-auto-review` | Codex Auto Review | **hide** — excluded from the picker |

`codexAgent.defaultModel` is `""` (send no `--model`), unlike Claude's concrete default.
Codex users set `model` in `~/.codex/config.toml` and the launcher has no business
silently overriding that; Claude Code has no equivalent user-level default, so its picker
needs one. The picker leads with the "Codex config default" entry for the same reason.

Because the cache is server-refreshed, the hardcoded list can drift. Reading the cache at
runtime would fix that — logged as an open question rather than built, since it needs a
new Rust command and JSON parsing for a list that changes a few times a year.

### Config locations

| Path | Purpose |
|---|---|
| `~/.codex/config.toml` | Main config; `notify`, `[tui]`, `[mcp_servers.*]` |
| `~/.codex/hooks.json` | Advanced hook mechanism (alternative to `notify`) |
| `AGENTS.md` (per project) | Project instructions, analogous to `CLAUDE.md` |
| `$CODEX_HOME` | Overrides `~/.codex` |

---

## 3. `LaunchRequest` contract change

`src-tauri/src/lib.rs:11-33`, consumed by both `launch_agent` and `spawn_pty`
(`src-tauri/src/ide.rs:62`).

```diff
 pub struct LaunchRequest {
-    pub claude_path: String,
+    pub agent_path: String,
     pub project_path: String,
     pub terminal_profile: String,
     pub flags: Vec<String>,
-    pub remote_control: bool,
+    /// Subcommand inserted before flags. Claude passes Some("remote-control")
+    /// when remote control is on; Codex always passes None.
+    pub subcommand: Option<String>,
+    /// True only for Claude Code. Gates the full-repaint env install, the
+    /// path→name map write, CLAUDECODE removal, and CLAUDE_CODE_* renderer vars.
+    pub claude_features: bool,
     pub pre_launch_command: Option<String>,
     pub tab_color: Option<String>,
     pub tab_title: Option<String>,
     pub dynamic_title: Option<bool>,
     pub model_in_title: Option<bool>,
     pub ide_renderer: Option<String>,
 }
```

Subcommand validation, added next to `is_safe_flag`:

```rust
/// Subcommands are a closed vocabulary supplied by the frontend registry, but
/// validate anyway — this struct crosses the IPC boundary.
fn is_safe_subcommand(s: &str) -> bool {
    !s.is_empty()
        && s.len() <= 32
        && s.starts_with(|c: char| c.is_ascii_lowercase())
        && s.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
}
```

Call sites to update:

| File:line | Change |
|---|---|
| `lib.rs:124` `build_claude_pwsh_cmd` | Rename to `build_agent_pwsh_cmd`; `remote_control` → `subcommand` |
| `lib.rs:238` | `ensure_full_repaint_env()` behind `claude_features` |
| `lib.rs:323-329` | Arg assembly uses `agent_path` + optional `subcommand` |
| `lib.rs:338-343` | `CLAUDECODE` removal + `FULL_REPAINT_ENV` set behind `claude_features` |
| `lib.rs:420-423` | Same, pwsh fallback |
| `lib.rs:1137` `detect_claude_path` | → `detect_agent_path(agent_id: String)` |
| `lib.rs:1239-1258` | Command registration list |
| `ide.rs:74`, `:106` | `agent_path` |
| `ide.rs:108` | `subcommand` |
| `ide.rs:128`, `:133-148` | Env stamping behind `claude_features` |
| `src/services/launcher.ts:17` | `invoke("launch_agent", ...)` + new payload fields |
| `src/services/ide.ts:32-43` | Same payload fields |

### Codex PTY environment

Codex sessions should receive **none** of the `CLAUDE_CODE_*` variables. Under
`claude_features: false`, `spawn_pty` skips the entire `ide.rs:133-148` block. Note that
`env_remove(FULL_REPAINT_ENV)` must still run unconditionally — the launcher persists that
variable machine-wide in `HKCU\Environment`, so this process inherits it and would
otherwise leak it into the Codex child. It is inert for Codex, but leaking it is untidy
and would confuse future debugging.

`CLAUDE_LAUNCHER_SESSION` and `CLAUDE_LAUNCHER_PORT` (`ide.rs:117-126`) are
launcher-owned, not Claude-owned. Keep setting them for all agents; renaming them is a
cosmetic change not worth breaking the installed Claude hook scripts over.

---

## 4. OSC 9 status detection

### Capture recipe (Phase 4, first task)

Before writing any handler, confirm what Codex actually emits:

1. Add to `~/.codex/config.toml`, **above any `[table]` header**:
   ```toml
   [tui]
   notifications = ["agent-turn-complete", "approval-requested"]
   notification_method = "osc9"
   ```
2. Launch a Codex IDE session in the launcher.
3. Temporarily log raw PTY bytes in `Terminal.tsx`'s `onOutput` channel handler —
   `console.log(JSON.stringify(new TextDecoder().decode(bytes)))` — and unfocus the
   window (the TUI only fires these when unfocused).
4. Trigger both events: let a turn complete, and provoke an approval prompt.
5. Record the exact byte sequences in this document before proceeding.

Expected shape is `ESC ] 9 ; <text> BEL` (or `ESC \` terminated). The open question is
whether `<text>` names the event or is a generic human-readable string.

### Handler

xterm.js exposes `term.parser.registerOscHandler(9, (data: string) => boolean)`. Return
`false` so the sequence still propagates to any other handler.

```ts
// Only register for agents whose capabilities.osc9Status is true.
term.parser.registerOscHandler(9, (data) => {
  const event = classifyOsc9(data); // fill in from the capture above
  if (event === "complete") onStatus("complete");
  else if (event === "waiting") onStatus("waiting");
  return false;
});
```

Feed the result into the same setter `useSessions.ts` uses for the Claude hook callback,
so both agents converge on one status machine. The existing output-idle timer keeps
running underneath as the `working` → `idle` fallback.

**If the capture shows events are indistinguishable**, degrade deliberately: map any
OSC 9 to `waiting` (the more actionable of the two, since it's the state that needs the
user), record that decision in the plan document's Open Questions, and leave `complete`
to the PTY exit path.

---

## 5. Codex `notify` hook installation

### Target state in `~/.codex/config.toml`

```toml
notify = ["pwsh", "-NoProfile", "-File", "C:\\Users\\<user>\\.codex\\scripts\\launcher-codex-notify.ps1"]

[tui]
# ... existing content preserved verbatim ...
```

### Merge algorithm

TOML root-level keys must appear before the first table header. Appending is therefore
wrong: a `notify` line placed after `[tui]` parses as `tui.notify`.

```
1. Read config.toml (create empty if absent).
2. If a line matching /^\s*notify\s*=/ exists at root scope → no-op, return "already configured".
3. Copy config.toml → config.toml.bak (overwrite any prior backup).
4. Find the insertion index: the first line whose trimmed form starts with '['
   and is not inside a multi-line string. If none, insertion index = end of file.
5. Insert the notify line plus a blank line at that index.
6. Write atomically (temp file in the same directory, then rename).
```

Backslashes in the Windows path must be escaped (`\\`) inside a TOML basic string, or the
path written as a literal string with single quotes. Prefer single-quoted literal strings
— they need no escaping at all.

### Verification matrix (Phase 5, final task)

| Input config | Expected |
|---|---|
| File absent | Created with `notify` only |
| Root keys only, no tables | `notify` appended at end |
| Starts with `[tui]` on line 1 | `notify` inserted at line 1, `[tui]` pushed down |
| Root keys then `[tui]` | `notify` inserted after root keys, before `[tui]` |
| Already has `notify` | No-op, no `.bak` written, informative message |
| Run twice in a row | Second run is a no-op |

### Reference implementation to mirror

`install_chime_hooks` (`src-tauri/src/lib.rs:852-946`) — same backup-then-merge shape,
same idempotency guard, same "preserve what the user already had" principle. The only
structural difference is TOML's ordering constraint, which JSON does not have.

---

## 6. Agent change invalidation

`Project.flagOverrides` is keyed by flag name and `Project.model` holds an agent-specific
id. Switching a project's agent makes both meaningless — a Claude project's
`--dangerously-skip-permissions` override has no referent under Codex, and
`claude-opus-4-8` is not a Codex model.

In `EditProjectDialog`, on agent change:

1. Warn inline: "Switching agent clears this project's flag overrides and model."
2. Reset `flagOverrides` to `{}` and `model` to the new agent's `defaultModel`.
3. Leave `tabTitle`, `color`, `preLaunchCommand`, `ideRenderer` intact — these are
   launcher concerns, not agent concerns.

Also clear `modelInTitle` and `dynamicTitle` when switching to an agent without the
`modelInTitle` capability, so a stale `true` can't suppress title behaviour later.

---

## 7. Settings storage shape

```ts
export interface GlobalSettings {
  // --- agent-keyed (new) ---
  agentPaths: Partial<Record<AgentId, string>>;
  agentFlags: Partial<Record<AgentId, GlobalFlagState[]>>;
  agentCustomFlags: Partial<Record<AgentId, string[]>>;
  /** Per-agent subcommand toggles, e.g. Claude's remote control. */
  agentSubcommands: Partial<Record<AgentId, boolean>>;

  // --- legacy: authoritative until Phase 3, removed in Phase 6 ---
  // Deliberately still REQUIRED. Marking these optional would make
  // settings.globalFlags.map(...) unsafe across ~10 call sites and force
  // `?? []` guards everywhere — that is Phase 3's switchover, not Phase 1's.
  /** @deprecated mirrored into agentPaths.claude */
  claudePath: string;
  /** @deprecated mirrored into agentFlags.claude */
  globalFlags: GlobalFlagState[];
  /** @deprecated mirrored into agentCustomFlags.claude */
  customFlags: string[];
  /** @deprecated mirrored into agentSubcommands.claude */
  remoteControl: boolean;

  // --- unchanged, agent-neutral ---
  terminalProfile: string;
  uiMode: UiMode;
  ideRenderer: IdeRenderer;
  ideGpu?: boolean;
}
```

The mirror is `syncLegacySettings()` in `src/services/store.ts`, called from **both**
`loadAppData` (after the `{ ...DEFAULT_SETTINGS, ...settings }` spread) and
`saveSettings`:

```ts
function syncLegacySettings(s: GlobalSettings): GlobalSettings {
  const id = DEFAULT_AGENT_ID;
  return {
    ...s,
    agentPaths: { ...s.agentPaths, [id]: s.claudePath },
    agentFlags: { ...s.agentFlags, [id]: s.globalFlags },
    agentCustomFlags: { ...s.agentCustomFlags, [id]: s.customFlags },
    agentSubcommands: { ...s.agentSubcommands, [id]: s.remoteControl ?? false },
  };
}
```

**Why on every write, not once.** The flat fields stay authoritative until Phase 3, so a
one-time fold at first load would leave `agentFlags.claude` frozen at whatever the flags
were that day — and Phase 3, which switches reads onto the agent-keyed maps, would
silently pick up that stale snapshot. Re-mirroring on save keeps both representations
identical at no cost. Phase 3 inverts the direction (agent-keyed becomes authoritative);
Phase 6 deletes the helper with the flat fields.

Auto-detection in `useSettings.ts:14` currently fires when `claudePath === "claude"`.
Generalise it to: for each registered agent, if its configured path equals its
`defaultBinary`, call `detect_agent_path(id)` once.
