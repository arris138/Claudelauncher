# Multi-Agent Support (Claude Code + OpenAI Codex)

**Status**: Phase 1 COMPLETE, Phase 2 NOT STARTED
**Last Updated**: 2026-07-19
**Branch**: `feat/codex-agent-support`
**Related Docs**: [Multi-Agent-Technical.md](./Multi-Agent-Technical.md), [IDE-Mode.md](./IDE-Mode.md), [IDE-Mode-Technical.md](./IDE-Mode-Technical.md)

---

## Overview

Claude Launcher was built around a single agent CLI. Every layer — the `LaunchRequest`
struct, the flag catalog, the model picker, the IDE-mode status machine — assumes the
binary being spawned is `claude`, and that the config it reads lives under `~/.claude`.

This work generalises that assumption so the launcher can spawn **any** agent CLI, and
registers OpenAI's `codex` as the second one. The shape of the app doesn't change: you
still keep a list of project directories, each with flags, a model, a tab color and a
pre-launch command, and you still launch them into Windows Terminal tabs or embedded
IDE-mode sessions. What changes is that each project now declares *which agent* it runs.

Codex is a good fit because it is architecturally the same kind of thing: a locally
installed CLI that opens a fullscreen TUI in a working directory, takes flags for model
and permission posture, and exposes a hook mechanism for lifecycle events. OpenAI merged
the standalone Codex desktop app into the unified ChatGPT desktop app on 2026-07-09, but
explicitly did **not** deprecate the CLI — it remains open-source, independently
installable, and one of several clients on their shared App Server. So it is a stable
launch target.

---

## Goals

1. **Agent-neutral core** — the Rust launch paths, the flag resolver, and the store no
   longer hardcode `claude`; adding a third agent later should be a registry entry plus
   a capability audit, not a refactor.
2. **Codex at parity in launcher tabs** — a Codex project launches into a `wt` tab with
   its own flags, model, tab title and color, exactly like a Claude project.
3. **Codex in IDE mode with real status** — embedded PTY sessions show
   `working`/`waiting`/`complete`, driven by Codex's OSC 9 TUI notifications rather than
   an HTTP hook callback.
4. **No regression for existing users** — projects created before this change keep
   working with zero migration friction and no re-configuration.
5. **Honest capability gating** — features that are Claude Code protocol specifics
   (model-in-title statusline, `CLAUDE_CODE_*` renderer vars) are hidden for Codex
   projects rather than silently no-oping.

---

## Architecture

### The agent registry

A new `src/agents/` module is the single source of truth for everything that differs
between agents. Each agent is one `AgentDefinition` object:

```
AgentDefinition
├── id                  "claude" | "codex"
├── label               display name
├── defaultBinary       "claude" | "codex"
├── flags               FlagDefinition[]      (per-agent built-in flag catalog)
├── models              ModelOption[]         (per-agent model picker)
├── defaultModel        string
├── buildModelFlag()    (model) => string     ("--model=x" for both, but agent-owned)
├── subcommand          string | null         ("remote-control" for Claude, null for Codex)
└── capabilities        { chimes, modelInTitle, ideHooks, osc9Status, fullRepaintEnv, ... }
```

The UI asks the registry what to render; the launcher services ask it how to build args;
the Rust side receives the *result* of those decisions and stays dumb. That inversion is
the whole design — Rust should never branch on `agentId`, because the moment it does, a
third agent means touching Rust again.

### Data flow

```
Project { agentId, flagOverrides, model, ... }
        │
        ▼
agents/registry.ts  ──►  AgentDefinition
        │
        ▼
resolveFlags(agent, settings, overrides)  ──►  string[]
        │
        ▼
services/launcher.ts ──► invoke("launch_agent", { agentPath, subcommand, flags, ... })
services/ide.ts      ──► invoke("spawn_pty",    { same LaunchRequest shape })
        │
        ▼
Rust: wt new-tab | pwsh fallback | ConPTY
```

### Per-agent settings

`GlobalSettings` gains agent-keyed maps. The existing flat fields (`claudePath`,
`globalFlags`, `customFlags`) are read once at load and folded into the `"claude"` entry,
then no longer written. `loadAppData` (`src/services/store.ts:48`) already spreads
`DEFAULT_SETTINGS` over stored settings, so new keys default themselves — the only real
migration work is the one-time fold of the legacy flat fields.

`Project.agentId` is **optional**, read as `project.agentId ?? "claude"`. Existing
projects therefore need no migration at all and no store rewrite on upgrade.

### IDE-mode status without hooks

Claude Code drives IDE-mode session status by POSTing to a local listener from global
Stop/Notification hooks (`src-tauri/src/ide.rs:280`). Codex has no equivalent HTTP
callback, but it has something better for our purposes: its TUI can emit **OSC 9 desktop
notifications** directly into the PTY stream (`[tui] notification_method = "osc9"`), for
both `agent-turn-complete` and `approval-requested`.

Because the launcher owns the xterm.js instance, it can register an OSC 9 handler and map
those two events onto `complete` and `waiting` — no hook installation, no listener, no
correlation by session id (the handler is already bound to one terminal). This is
strictly simpler than the Claude path and should be treated as the preferred mechanism
for any future agent that supports it.

---

## Key Decisions

**Per-project agent, not per-launch.** A project declares one agent. The alternative —
agent-neutral projects with a split launch button — would force every project to carry
two flag sets, two model choices and two override maps, roughly doubling the state for a
case (same repo, either agent) that is better served by just creating two projects.

**Long-form Codex flags only.** `is_safe_flag` (`src-tauri/src/lib.rs:75`) requires a
`--` prefix and rejects single-dash flags. Codex's documented short forms (`-m`, `-s`,
`-a`, `-C`) all have long equivalents (`--model`, `--sandbox`, `--ask-for-approval`,
`--cd`), and clap accepts `--flag=value`. Using long forms means the security validator
is untouched — loosening a flag whitelist to accommodate a feature is the wrong trade.

**The registry lives in TypeScript, not Rust.** Rust receives a resolved
`agent_path` + `subcommand` + `flags[]` and executes them. It never learns what an agent
*is*. This keeps the security-critical validation code small and agent-agnostic, and
means the entire "add an agent" surface is one TS file plus a capability audit.

**No `--cd` for the working directory.** Both launch paths already establish cwd
correctly (`wt -d <path>`, `CommandBuilder::cwd`). Passing `--cd` as well would be a
redundant second source of truth that could disagree.

**Claude-only features are gated, not generalised.** The model-in-title statusline,
`launcher-tab-names.json`, and the `CLAUDE_CODE_*` renderer env vars encode Claude Code's
specific protocols. Attempting to abstract them would produce an interface with exactly
one implementation. They become `capabilities` booleans that hide UI and skip code paths.

**Hand-rolled TOML merge for the Codex notify hook**, mirroring how `install_chime_hooks`
hand-merges JSON today, rather than adding a `toml` crate dependency. The edit is a
single root-level key insertion; a full parse/serialise round-trip would reformat and
strip comments from a file the user owns and hand-edits.

**Phases 1–2 ship no Codex code.** They are pure refactor, verified against existing
Claude projects. Any regression is then unambiguously attributable to the refactor rather
than tangled with new-agent behaviour.

---

## Implementation

> **To implement this plan**, use the `implement` skill (`/implement`) which will read
> this document, identify the next incomplete phase, and execute it step by step.

## Implementation Phases

### Phase 1: Agent registry + type foundations — COMPLETE

Introduce the agent abstraction with Claude as its only member. Nothing about the app's
behaviour changes; this phase exists so that later phases have somewhere to put Codex.

- [x] Create `src/agents/types.ts` with `AgentId`, `AgentDefinition`, `AgentCapabilities`
      (see the technical companion for the full interface)
- [x] Create `src/agents/claude.ts` — move `BUILT_IN_FLAGS` (`src/utils/flags.ts:3`) and
      `MODEL_OPTIONS`/`DEFAULT_MODEL` (`src/utils/models.ts`) into it, re-exporting the
      old names so nothing breaks yet
- [x] Create `src/agents/registry.ts` with `getAgent(id)` and `ALL_AGENTS`, defaulting
      unknown/missing ids to `"claude"`
- [x] Add optional `agentId?: AgentId` to `Project` (`src/types/index.ts:1`); add
      agent-keyed `agentPaths`, `agentFlags`, `agentCustomFlags` to `GlobalSettings`
- [x] Fold legacy flat settings (`claudePath`, `globalFlags`, `customFlags`) into the
      `"claude"` entry inside `loadAppData` (`src/services/store.ts:40`), leaving the old
      keys in place unwritten for one release

> **Watch out:** Do not delete the legacy `GlobalSettings` fields in this phase. A user
> who upgrades, launches once, then downgrades would lose their Claude path and flags.
> Keep them readable for one release cycle.

**Implementation notes:**

- The legacy `GlobalSettings` fields were kept **required**, not marked optional as the
  technical companion's storage-shape snippet showed. Making them `?:` would have made
  `settings.globalFlags.map(...)` and `settings.customFlags.includes(...)` unsafe across
  ~10 call sites, forcing `?? []` guards throughout — which is Phase 3's switchover work
  pulled forward. They carry `@deprecated` JSDoc instead.
- The legacy fold is a `syncLegacySettings()` helper called from **both** `loadAppData`
  and `saveSettings`, not the guarded one-time fold the companion described. The flat
  fields stay authoritative until Phase 3, so a one-time fold would leave
  `agentFlags.claude` holding a stale snapshot of whatever the flags were at first load —
  and Phase 3 would then switch reads onto that stale data. Re-mirroring on every write
  keeps the two representations identical for free. The companion has been corrected.
- `AgentId` is re-exported from `src/types/index.ts` so consumers have one import site.
  The resulting mutual reference with `src/agents/types.ts` is type-only and erased at
  compile time, so there is no runtime import cycle.
- `registry.ts` also exports `DEFAULT_AGENT_ID` and an `isKnownAgent()` type guard, both
  used by the fold and expected by Phase 3's agent-change invalidation.
- Verified with `pnpm build` (tsc + vite): clean. The >500 kB chunk warning is
  pre-existing and unrelated.

### Phase 2: Rust launch-path generalisation — NOT STARTED

**Depends on:** Phase 1

Strip Claude specifics out of the two spawn paths so they can run an arbitrary binary,
while keeping every existing Claude behaviour bit-for-bit identical.

- [ ] Rename `LaunchRequest.claude_path` → `agent_path` (`src-tauri/src/lib.rs:14`) and
      update both consumers (`lib.rs` wt/pwsh paths, `ide.rs:74`/`:106`)
- [ ] Replace the `remote_control: bool` field with `subcommand: Option<String>`,
      validated against `^[a-z][a-z0-9-]*$`; drop the `remote-control` literals at
      `lib.rs:131` and `ide.rs:108`
- [ ] Add `claude_features: bool` to `LaunchRequest` (frontend-supplied); gate
      `ensure_full_repaint_env()` (`lib.rs:238`), the `model_in_title` path→name write,
      and the `CLAUDECODE` env removal behind it
- [ ] Gate the `CLAUDE_CODE_*` renderer branch in `spawn_pty` (`ide.rs:133-148`) on the
      same flag, so Codex sessions get a clean env
- [ ] Rename the `launch_claude` command to `launch_agent` and `detect_claude_path` to
      `detect_agent_path(agent_id)`; update the registration list (`lib.rs:1239`) and the
      frontend `invoke` call sites (`src/services/launcher.ts:17`, `:36`)
- [ ] Update error strings ("Claude path…" → "Agent path…") at `lib.rs:168`, `:225`,
      `ide.rs:75`

> **Watch out:** `build_claude_pwsh_cmd` (`lib.rs:124`) is shared by the pwsh fallback
> *and* the IDE pre-launch-command path. Both must be tested — the pre-launch path is
> easy to miss because it only fires when a project sets a pre-launch command.

**Verify before continuing:** launch an existing Claude project into a `wt` tab and into
an IDE session; confirm flags, model, tab title, tab color, pre-launch command, chimes,
and IDE status transitions all behave exactly as before.

### Phase 3: Codex in launcher tabs — NOT STARTED

**Depends on:** Phase 2

Register Codex and make it launchable into Windows Terminal.

- [ ] Run `codex --help` and record the real flag and model surface in the technical
      companion's matrix — **do not** hardcode model ids from documentation or memory
- [ ] Create `src/agents/codex.ts`: flag catalog (`--yolo`, `--sandbox=`,
      `--ask-for-approval=`, `--search`), model list from the step above,
      `subcommand: null`, capabilities with `chimes/modelInTitle/ideHooks` off
- [ ] Teach `resolveFlags` (`src/utils/flags.ts:17`) to take an agent and read that
      agent's slice of `agentFlags`/`agentCustomFlags`
- [ ] Add `detect_agent_path("codex")` probes in Rust (`lib.rs:1137`) —
      `~/.codex/bin`, npm global prefix, PATH fallback
- [ ] Add an agent selector to `AddProjectDialog` and `EditProjectDialog`; make the model
      dropdown and flag list read from the selected agent's definition
- [ ] Restructure `SettingsModal` into per-agent sections (path, global flags, custom
      flags), hiding Claude-only installers when the Claude section isn't shown
- [ ] Show an agent badge on `ProjectRow` and `RecentCard` so mixed lists are readable

> **Watch out:** Changing a project's agent invalidates its `flagOverrides` and `model`,
> which are keyed by the old agent's flag names. Clear both on agent change, and warn in
> the edit dialog before doing so.

### Phase 4: Codex in IDE mode — NOT STARTED

**Depends on:** Phase 3

Make embedded PTY sessions work for Codex, with genuine status transitions.

- [ ] Confirm Codex's OSC 9 output empirically: run it in an IDE session with
      `[tui] notifications` enabled and capture the raw bytes (see the technical
      companion for the capture recipe)
- [ ] Register an OSC 9 handler on the xterm instance in
      `src/components/ide/Terminal.tsx`, mapping `agent-turn-complete` → `complete` and
      `approval-requested` → `waiting`
- [ ] Gate `detectModel()` (`Terminal.tsx:108`) behind an agent capability — its regexes
      match Claude's banner and will never fire for Codex
- [ ] Add a Codex branch to `modelLabel()` (`src/components/ide/IdeView.tsx:13`) so ids
      aren't mangled by the `^claude-` strip
- [ ] Gate the hardcoded `/clear` slash command (`IdeView.tsx:121`) — verify Codex's
      equivalent and make it agent-supplied
- [ ] Make `ensureIdeHooks()` (`src/services/ide.ts:65`) a no-op for agents without the
      `ideHooks` capability

> **Watch out:** If the OSC 9 capture in the first task shows Codex does *not* emit what
> the docs describe, stop and re-plan this phase — falling back to the output-idle
> heuristic in `useSessions.ts` is acceptable, but it should be a deliberate decision
> recorded here, not a silent degradation.

### Phase 5: Codex notify hook (chimes) — NOT STARTED

**Depends on:** Phase 4

Give Codex projects the same audible completion cue Claude projects have.

- [ ] Add `install_codex_notify` to `src-tauri/src/lib.rs`, mirroring the structure of
      `install_chime_hooks` (`lib.rs:852`)
- [ ] Write a `launcher-codex-notify.ps1` script to `~/.codex/scripts/` that plays the
      same sound asset the Claude chime hook uses
- [ ] Implement the TOML insertion: back up `config.toml` to `.bak`, insert
      `notify = [...]` **before the first `[table]` header**, preserve existing content
      and comments verbatim, and no-op if a `notify` key already exists
- [ ] Add an "Install Codex notify hook" button to the Codex section of `SettingsModal`,
      alongside a read-only indicator of whether one is already configured
- [ ] Verify idempotency: run the installer twice, and run it against a config that has
      no tables, only tables, and a pre-existing `notify`

> **Watch out:** TOML requires root-level keys to precede any `[table]`. Appending
> `notify` to the end of a config that contains `[tui]` or `[mcp_servers.*]` produces a
> file that silently parses as a key *inside that table*. The insertion point is the
> whole difficulty of this phase.

### Phase 6: Polish, docs, release — NOT STARTED

**Depends on:** Phase 5

- [ ] Surface a passive note in the Codex settings section explaining that CLI, web and
      IDE usage share one 5-hour rolling window on ChatGPT paid plans
- [ ] Update `CLAUDE.md` (architecture section) and `README.md` for multi-agent support
- [ ] Remove the legacy flat `GlobalSettings` fields deferred in Phase 1, now that a
      release has shipped with the folded values
- [ ] Bump the version in `package.json`, `src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json`

---

## Risks & Considerations

1. **Codex's documented flag surface may not match the installed binary** — *High
   likelihood, low impact.* CLI docs for a fast-moving tool drift. Mitigated by making
   `codex --help` the authority in Phase 3 rather than any written source, including this
   document.

2. **OSC 9 may not carry a distinguishable event payload** — *Medium likelihood, medium
   impact.* If Codex emits a generic notification body rather than a named event, the
   `waiting`/`complete` distinction collapses. Phase 4's first task is an empirical
   capture specifically so this is discovered before any code is written against it.

3. **The ConPTY/xterm emulation contract was tuned for Claude Code** — *Medium
   likelihood, medium impact.* The Unicode 11 width tables, DOM renderer default and
   sideloaded ConPTY (see `CLAUDE.md`) were all chosen against Claude's TUI. Codex's TUI
   is a different Rust renderer and may expose different artifacts. The three-layer
   diagnostic in `CLAUDE.md` applies unchanged — check width tables, renderer, and
   ConPTY re-synthesis before adding any Codex-specific point fix.

4. **TOML corruption in a user-owned config** — *Low likelihood, high impact.* A botched
   `notify` insertion could break the user's entire Codex configuration. Mitigated by the
   `.bak` backup, the no-op-if-present guard, and the four-case verification matrix in
   Phase 5. If this proves fragile in practice, the fallback is the read-only detection
   approach: show a copy-pasteable snippet and let the user paste it themselves.

5. **Downgrade data loss** — *Low likelihood, medium impact.* A user who upgrades,
   reconfigures, then installs an older build would find agent-keyed settings unreadable.
   Mitigated by keeping the legacy flat fields for one release (Phase 1) and only
   removing them in Phase 6.

6. **Shared rate window makes parallel Codex sessions self-defeating** — *Certain, low
   impact.* On the $20 Plus plan, CLI/web/IDE all draw from one 5-hour allowance, so the
   launcher's core value proposition (many parallel sessions) is weaker for Codex than
   for Claude. This is a user expectation problem, not a technical one; addressed by the
   Phase 6 note rather than by code.

7. **Scope creep into a general agent platform** — *Medium likelihood, medium impact.*
   The registry makes a third agent look cheap, but each new agent brings its own
   capability gaps and rendering quirks. Two agents is the committed scope; a third
   should require its own plan.

---

## Open Questions

- [ ] Does `codex --remote` (connect to a remote app-server over WebSocket/Unix socket)
      serve any purpose analogous to Claude's `remote-control` subcommand, or is it
      unrelated infrastructure? Deferred out of v1 until verified.
- [ ] What is Codex's equivalent of the `/clear` slash command hardcoded at
      `IdeView.tsx:121`? Needed for Phase 4.
- [ ] Does Codex read `AGENTS.md` per-project in a way the launcher should surface (e.g.
      an indicator that a project has one), or is that purely the agent's concern?
- [x] Should the launcher write to `~/.codex/config.toml`? — **Yes**, via a notify-hook
      installer in Phase 5, mirroring the existing Claude chime installer.
- [x] Per-project agent or per-launch choice? — **Per-project**, via `Project.agentId`.
- [x] Is the standalone Codex CLI still viable after the 2026-07-09 ChatGPT desktop app
      merger? — **Yes.** OpenAI explicitly did not deprecate it; it remains open-source
      and independently installable.
