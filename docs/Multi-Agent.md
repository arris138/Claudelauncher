# Multi-Agent Support (Claude Code + OpenAI Codex)

**Status**: All phases COMPLETE (v2.5.0, unreleased)

> **Runtime verification (2026-07-19, dev build).** Confirmed working in the running app:
> the launcher boots with all pre-existing projects intact (no store-migration damage);
> Settings shows per-agent Claude Code / Codex tabs; the legacy `claudePath` migrated to
> `agentPaths.claude`; Codex was auto-detected at `%APPDATA%\npm\codex.cmd`; Codex's four
> flags render under its own section; and capability gating holds — Remote Control, the
> chime installer and the statusline installer are all absent on the Codex tab.
>
> **Launch confirmed by the user on 2026-07-19** — a Codex project launches and connects.
> The Phase 2 `claude_features` gating therefore holds for both agents in practice, not
> just at compile time.
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

### Phase 2: Rust launch-path generalisation — COMPLETE

**Depends on:** Phase 1

Strip Claude specifics out of the two spawn paths so they can run an arbitrary binary,
while keeping every existing Claude behaviour bit-for-bit identical.

- [x] Rename `LaunchRequest.claude_path` → `agent_path` (`src-tauri/src/lib.rs:14`) and
      update both consumers (`lib.rs` wt/pwsh paths, `ide.rs:74`/`:106`)
- [x] Replace the `remote_control: bool` field with `subcommand: Option<String>`,
      validated against `^[a-z][a-z0-9-]*$`; drop the `remote-control` literals at
      `lib.rs:131` and `ide.rs:108`
- [x] Add `claude_features: bool` to `LaunchRequest` (frontend-supplied); gate
      `ensure_full_repaint_env()` (`lib.rs:238`), the `model_in_title` path→name write,
      and the `CLAUDECODE` env removal behind it
- [x] Gate the `CLAUDE_CODE_*` renderer branch in `spawn_pty` (`ide.rs:133-148`) on the
      same flag, so Codex sessions get a clean env
- [x] Rename the `launch_claude` command to `launch_agent` and `detect_claude_path` to
      `detect_agent_path(agent_id)`; update the registration list (`lib.rs:1239`) and the
      frontend `invoke` call sites (`src/services/launcher.ts:17`, `:36`)
- [x] Update error strings ("Claude path…" → "Agent path…") at `lib.rs:168`, `:225`,
      `ide.rs:75`

> **Watch out:** `build_claude_pwsh_cmd` (`lib.rs:124`) is shared by the pwsh fallback
> *and* the IDE pre-launch-command path. Both must be tested — the pre-launch path is
> easy to miss because it only fires when a project sets a pre-launch command.

**Verify before continuing:** launch an existing Claude project into a `wt` tab and into
an IDE session; confirm flags, model, tab title, tab color, pre-launch command, chimes,
and IDE status transitions all behave exactly as before. **Not yet done** — see the
status warning at the top of this document.

**Implementation notes:**

- Added `resolveAgentRequest(project, settings)` to `src/services/launcher.ts`, used by
  both `launchProject` and `spawnPty`. The plan implied editing the two payloads
  separately, but they already duplicated the model-flag assembly and would now duplicate
  the subcommand and `claudeFeatures` derivation too. One resolver means the wt path and
  the IDE path cannot drift — which matters, because a divergence there is invisible
  until someone launches the same project both ways and gets different flags.
- `is_safe_subcommand()` was added next to `is_safe_flag` with a unit test covering
  leading dashes, uppercase, spaces, shell metacharacters, path traversal and the length
  cap. The subcommand is appended straight to an argv, so it warranted the same treatment
  as flags rather than a bare regex.
- The non-Claude branch of `spawn_pty` explicitly `env_remove`s `CLAUDE_CODE_NO_FLICKER`
  and `CLAUDE_CODE_DISABLE_ALTERNATE_SCREEN` rather than merely skipping the block. This
  process inherits whatever the user's environment holds, so "don't set it" is not the
  same as "it isn't set".
- `detect_agent_path` takes `Option<String>` and falls back to Claude's probes for a
  missing or unrecognised id, so an older backend paired with a newer frontend degrades
  instead of erroring.
- `claude_features` carries `#[serde(default)]`, so a request that omits it is treated as
  a non-Claude launch — the conservative direction, since the Claude-only side effects
  write to the user's machine (HKCU, the tab-name map).
- **Unplanned fix:** the log line at `lib.rs:239` claimed the full-repaint env was written
  to `~/.claude/settings.json`. That has been untrue since v2.3.2, when it moved to
  `HKCU\Environment` (see CLAUDE.md). Corrected while gating it.

### Phase 3: Codex in launcher tabs — COMPLETE

**Depends on:** Phase 2

Register Codex and make it launchable into Windows Terminal.

- [x] Run `codex --help` and record the real flag and model surface in the technical
      companion's matrix — **do not** hardcode model ids from documentation or memory
- [x] Create `src/agents/codex.ts`: flag catalog, model list from the step above,
      `subcommand: null`, capabilities with `chimes/modelInTitle/ideHooks` off
- [x] Teach `resolveFlags` (`src/utils/flags.ts:17`) to take an agent and read that
      agent's slice of `agentFlags`/`agentCustomFlags`
- [x] Add `detect_agent_path("codex")` probes in Rust (`lib.rs:1137`) —
      `~/.codex/bin`, npm global prefix, PATH fallback
- [x] Add an agent selector to `AddProjectDialog` and `EditProjectDialog`; make the model
      dropdown and flag list read from the selected agent's definition
- [x] Restructure `SettingsModal` into per-agent sections (path, global flags, custom
      flags), hiding Claude-only installers when the Claude section isn't shown
- [x] Show an agent badge on `ProjectRow` and `RecentCard` so mixed lists are readable

> **Watch out:** Changing a project's agent invalidates its `flagOverrides` and `model`,
> which are keyed by the old agent's flag names. Clear both on agent change, and warn in
> the edit dialog before doing so.

**Implementation notes:**

- **`--yolo` does not exist.** The provisional matrix listed it as an alias for
  `--dangerously-bypass-approvals-and-sandbox`; `codex --help` (codex-cli 0.101.0) shows
  only the long form. Corrected in the companion. `--ask-for-approval` also has **four**
  values, not three — `on-failure` was missing. This is exactly why the phase led with
  reading the binary.
- **`--full-auto` and `--no-alt-screen` were not in the matrix at all.** `--no-alt-screen`
  matters beyond this phase: it is a direct flag analogue of Claude's
  `CLAUDE_CODE_DISABLE_ALTERNATE_SCREEN`, so `ideRenderer: "classic"` **is** supportable
  for Codex in Phase 4 — via a flag rather than an env var. Both are in the catalog.
- **Models came from `~/.codex/models_cache.json`, not `--help`,** which does not
  enumerate them. Six slugs, five with `visibility: "list"`. Codex refreshes that cache
  from the server, so the hardcoded list can go stale; the picker leads with a "Codex
  config default (no --model flag)" entry and `defaultModel` is `""`, so the launcher
  respects the `model` key in the user's `config.toml` instead of overriding it. Reading
  the cache at runtime is logged as an open question rather than built.
- **npm-shim detection.** Codex installs as an npm global, so the real binary here is
  `%APPDATA%\npm\codex.cmd` — a location the Phase 2 probes missed. Added, and verified
  empirically that `CreateProcess` with `UseShellExecute=false` **does** execute a `.cmd`
  shim (exit 0, correct output), so `portable_pty` and `Command::new` can both spawn it
  directly. Worth recording because the opposite is widely assumed.
- **`quickFlag` added to `AgentDefinition`.** The Add dialog's single checkbox hardcoded
  `--dangerously-skip-permissions`. It now names the flag explicitly per agent rather
  than taking `flags[0]`, so reordering a catalog can't silently repoint that checkbox at
  a different flag.
- **`addProject` takes an options object** instead of gaining a sixth positional
  parameter. One call site, and positional `(name, path, overrides, color, model,
  agentId)` was already past the point of being readable.
- **Store sync direction inverted.** `syncLegacySettings` (Phase 1) is replaced by
  `migrateLegacySettings` (guarded, load-only — seeds a missing agent slot) plus
  `mirrorToLegacy` (save-only — keeps the flat fields populated for downgrade safety).
  Agent-keyed maps are authoritative from this phase on, so the unconditional mirror
  would have overwritten live settings with the frozen legacy copy on every load.
- **`useSettings` auto-detects a path for every registered agent**, not just Claude, so
  an installed Codex is usable without visiting Settings.
- **The agent badge only renders for non-default agents.** Tagging every row
  "Claude Code" would be noise for the common single-agent case.
- Verified with `pnpm build`, `cargo check`, `cargo test` (2 passed). Still no runtime
  verification — see the status warning at the top.

### Phase 4: Codex in IDE mode — COMPLETE (status mechanism unverified)

**Depends on:** Phase 3

Make embedded PTY sessions work for Codex, with genuine status transitions.

- [x] Confirm Codex's notification output empirically — done by inspecting the shipped
      binary rather than the config-and-capture recipe, which found no event vocabulary
      to capture
- [x] ~~Register an OSC 9 handler mapping two event names to statuses~~ — **not
      implementable**; replaced by the `notify` callback (see notes below)
- [x] Gate `detectModel()` (`Terminal.tsx:108`) behind an agent capability — its regexes
      match Claude's banner and will never fire for Codex
- [x] ~~Add a Codex branch to `modelLabel()`~~ — **verified unnecessary**: the
      `^claude-` strip leaves `gpt-5.4` untouched
- [x] Gate the hardcoded `/clear` slash command (`IdeView.tsx:121`) — now agent-supplied
      via `AgentDefinition.clearCommand`
- [x] Make `ensureIdeHooks()` (`src/services/ide.ts:65`) a no-op for agents without the
      `ideHooks` capability

> **Watch out:** If the OSC 9 capture in the first task shows Codex does *not* emit what
> the docs describe, stop and re-plan this phase — falling back to the output-idle
> heuristic in `useSessions.ts` is acceptable, but it should be a deliberate decision
> recorded here, not a silent degradation.

**Implementation notes — the OSC 9 design was abandoned, and why:**

- **The premise was false.** String inspection of the shipped `codex.exe` found exactly
  one OSC 9 emitter (`codex_tui::notifications::osc9::PostNotification`), one literal
  `ESC ]9;`, a `NotificationMethod` enum of just `osc9 | bel`, and **no
  `approval-requested` string anywhere in the binary**. `agent-turn-complete` exists but
  in the *notify-hook* payload struct (`type`, `thread-id`, `turn-id`, `cwd`,
  `last-assistant-message`), not the OSC 9 path. There is no event vocabulary to map, so
  "OSC 9 → waiting/complete" was not implementable. OSC 9 also only fires when the TUI
  believes it is unfocused, which is undefined for an embedded xterm.
- **Replacement: Codex's `notify` callback → the existing IDE listener.** Chosen over
  OSC 9 because it is deterministic, focus-independent, and reuses the loopback listener
  at `ide.rs:294` unchanged (the script POSTs `event: "stop"`, which already maps to
  `complete`).
- **Delivered per-launch via `--config=notify=[...]`, not by editing
  `~/.codex/config.toml`.** That file is hand-edited by the user, and TOML's
  root-keys-before-tables rule makes appending actively wrong. A per-launch override
  cannot corrupt anything. This also removes most of Phase 5's risk.
- **`waiting` is unobtainable for Codex.** No approval-time event exists in any form.
  Codex sessions go `working` → `complete` and never blink for input. Deliberate
  degradation, recorded here as the Watch-out demanded.
- **Shipped OFF by default** behind `GlobalSettings.ideNotifyHook`, at the user's
  request. Two assumptions remain unverified against a live turn: that Codex spawns the
  notify program as a child inheriting `CLAUDE_LAUNCHER_SESSION`/`_PORT`, and that
  `--config=notify=` is honoured interactively. Failure mode is silent (status just
  never fires), so `CODEX_NOTIFY_TEMPLATE` documents what to suspect first.
- `modelLabel()` needed **no** change — the `^claude-` strip leaves `gpt-5.4` untouched.

> ⚠️ **Codex self-updates, and did so mid-implementation: 0.101.0 → 0.144.6 within one
> afternoon.** `--full-auto` was removed outright — a flag this catalog had already
> shipped, which would have failed a launch with an unknown argument. The model cache
> simultaneously went from six models (five listed) to three (all hidden). Consequently
> the Codex model field is now **free text with suggestions**, not a dropdown, and the
> flag catalog is deliberately minimal. Treat any hardcoded Codex surface as perishable.

### Phase 5: Codex notify hook (chimes) — COMPLETE

**Depends on:** Phase 4

Give Codex projects the same audible completion cue Claude projects have.

- [x] Add `install_codex_notify` to `src-tauri/src/lib.rs`, mirroring the structure of
      `install_chime_hooks` (`lib.rs:852`)
- [x] Write a `launcher-codex-notify.ps1` script to `~/.codex/scripts/` that plays the
      same sound asset the Claude chime hook uses
- [x] ~~Implement the TOML insertion~~ — **obsolete, see below**
- [x] Add an "Install Codex chime" button to the Codex section of `SettingsModal`
- [x] ~~Verify idempotency against four config shapes~~ — **obsolete, see below**

> **Watch out:** TOML requires root-level keys to precede any `[table]`. Appending
> `notify` to the end of a config that contains `[tui]` or `[mcp_servers.*]` produces a
> file that silently parses as a key *inside that table*. The insertion point is the
> whole difficulty of this phase.

**Implementation notes:**

- **The TOML merge was never written, and that is the point.** Phase 4 established that
  the callback can be handed to Codex per-launch with `--config=notify=[...]`, so
  `~/.codex/config.toml` is never opened, never backed up, and cannot be corrupted. The
  entire "whole difficulty of this phase" evaporated, along with its four-case
  verification matrix and the highest-severity risk in this document (#4). The insertion
  algorithm is left documented in the technical companion in case a future need for a
  persistent config write arises.
- **One script serves both launch paths.** `CODEX_NOTIFY_TEMPLATE` chimes first, then
  relays status only if `CLAUDE_LAUNCHER_SESSION`/`_PORT` are present. A Windows Terminal
  tab has neither, so it chimes and stops; an IDE session does both. This meant removing
  the early return that Claude's equivalent script has.
- **The chime degrades rather than fails.** The script looks for the wav next to itself
  (`~/.codex/scripts/`), then in `~/.claude/sounds/`, and stays silent if neither exists.
  So a Codex-only user isn't forced to have `~/.claude`, and a user who already installed
  Claude chimes gets sound even before pressing the install button.
- **Setting renamed** `ideNotifyHook` → `agentNotifyHook`, since it now governs terminal
  tabs as well as IDE sessions. Unreleased, so no migration needed.

### Phase 6: Polish, docs, release — COMPLETE

**Depends on:** Phase 5

- [x] Surface a passive note in the Codex settings section explaining that CLI, web and
      IDE usage share one rolling window on ChatGPT paid plans
- [x] Update `CLAUDE.md` (architecture section) and `README.md` for multi-agent support
- [ ] ~~Remove the legacy flat `GlobalSettings` fields deferred in Phase 1~~ —
      **deliberately not done, see below**
- [x] Bump the version in `package.json`, `src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json`

**Implementation notes:**

- **The legacy-field removal is deferred, not forgotten.** Phase 1 kept
  `claudePath`/`globalFlags`/`customFlags`/`remoteControl` so that a user who upgrades and
  then reinstalls an older build doesn't lose their settings. That release *has not
  shipped yet* — the installed build is still v2.4.2, which reads exactly those fields.
  Removing them now would deliver the data loss the deferral existed to prevent. They
  come out one release **after** 2.5.0 is published; `mirrorToLegacy` in
  `src/services/store.ts` keeps them populated until then.
- **Version bumped 2.4.2 → 2.5.0** (minor, not patch: new user-facing capability).
- The rate-limit note is rendered only on the Codex tab, phrased without hard numbers —
  plan tiers and limits change, and a stale number in the UI is worse than none.

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

4. ~~**TOML corruption in a user-owned config**~~ — **ELIMINATED.** The callback is passed
   per-launch via `--config`, so `~/.codex/config.toml` is never written. This was the
   highest-severity risk in the plan and it was designed out rather than mitigated.

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
- [ ] Does Codex's `/clear` behave as expected? The binary carries a "startup resume
      clear compact" command cluster, so `codexAgent.clearCommand` is set to `/clear`,
      but this was never exercised against a running session.
- [ ] Does Codex read `AGENTS.md` per-project in a way the launcher should surface (e.g.
      an indicator that a project has one), or is that purely the agent's concern?
- [ ] Should the Codex model picker read `~/.codex/models_cache.json` at runtime instead
      of using the hardcoded list? Codex refreshes that cache from the server, so the
      hardcoded slugs will drift. Needs a new Rust command; deferred as not worth it for
      a list that changes a few times a year.
- [x] Should the launcher write to `~/.codex/config.toml`? — **Yes**, via a notify-hook
      installer in Phase 5, mirroring the existing Claude chime installer.
- [x] Per-project agent or per-launch choice? — **Per-project**, via `Project.agentId`.
- [x] Is the standalone Codex CLI still viable after the 2026-07-09 ChatGPT desktop app
      merger? — **Yes.** OpenAI explicitly did not deprecate it; it remains open-source
      and independently installable.
