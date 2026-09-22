import type { AgentDefinition } from "./types";
import { claudeAgent } from "./claude";
import { FALLBACK_MODELS, loadCatalog } from "../services/openrouterCatalog";
import { OPENROUTER_DEFAULT_REF } from "../services/openrouterUsage";

/**
 * OpenRouter, hosted by the Claude Code binary.
 *
 * Unlike the other two entries, this is not a separate CLI. OpenRouter is a
 * model router with an HTTP endpoint, and the launcher's whole abstraction is
 * "spawn a binary in a directory". So this agent runs the *same* `claude`
 * executable and redirects it at OpenRouter by environment variable.
 *
 * ## Why this works
 *
 * `openrouter.ai/api/v1/messages` speaks Anthropic's wire format, not merely
 * OpenAI's. Verified 2026-09-20 against the live endpoint: a request carrying
 * an `input_schema` tool came back with a `thinking` block, a `tool_use` block
 * and `stop_reason: "tool_use"`, correctly shaped. Claude Code itself then ran
 * a full agentic loop against `deepseek/deepseek-v4-flash` and returned the
 * right answer out of a file it had to call Read to see.
 *
 * ## Three things the smoke test exposed
 *
 * 1. **Unmapped models are assumed to be 200k.** Claude Code warns that a slug
 *    it doesn't recognise "isn't described by this version's model catalog"
 *    and that "auto-compact keeps this session within 200k tokens". A model
 *    with a 1.05M window would silently lose 80% of it. `buildEnv` sets
 *    CLAUDE_CODE_MAX_CONTEXT_TOKENS from the catalog's own `context_length`
 *    to prevent that.
 * 2. **The cost readout is wrong by roughly 340x.** Claude Code priced one
 *    short session at $0.449; the actual OpenRouter spend, measured against
 *    the `/api/v1/key` usage counter, was about $0.0013. It is estimating
 *    unknown models at Anthropic rates. Nothing here can fix that, so the UI
 *    says so rather than letting the number be believed.
 * 3. **Tool calling working is not the same as the loop working.** Same prompt
 *    and tools across three models: GLM 5.3 Flash and gpt-oss-120b answered
 *    cleanly in two turns; `deepseek-v4-flash` made the tool call correctly
 *    and then returned an *empty* final message on two runs out of three. Price
 *    and context window predict none of this, so treat the picker as a list of
 *    candidates, not a list of endorsements.
 */
export const openrouterAgent: AgentDefinition = {
  id: "openrouter",
  label: "OpenRouter",

  // The Claude Code binary. Deliberately the same default as `claudeAgent`, so
  // a user who has already pointed Settings at a non-PATH claude.exe does not
  // have to find it twice — `agentPath` falls back to this per agent id.
  defaultBinary: "claude",

  // Claude Code's own flags, since Claude Code is what runs. Shared by
  // reference rather than copied: a flag added to Claude Code's catalog is a
  // flag this agent gains too, which is the correct behaviour and one fewer
  // list to keep in sync.
  flags: claudeAgent.flags,
  quickFlag: claudeAgent.quickFlag,

  // Offline fallback only. `loadModels` replaces this with the live catalog.
  models: FALLBACK_MODELS,

  async loadModels() {
    const { models } = await loadCatalog({ requireReasoning: true });
    return models;
  },

  // No default. OpenRouter has no notion of "the" model, the catalog moves
  // weekly, and an unset model would send no --model flag at all, which would
  // make Claude Code ask OpenRouter for an Anthropic model that the user's
  // OpenRouter key may not even be funded for. The dialogs require a choice.
  defaultModel: "",

  buildModelFlag(model) {
    return model ? `--model=${model}` : null;
  },

  buildEnv({ model, contextWindow }) {
    const env: Array<[string, string]> = [
      // Claude Code appends /v1/messages itself, so this is the API root and
      // not the endpoint.
      ["ANTHROPIC_BASE_URL", "https://openrouter.ai/api"],
    ];

    // Without this Claude Code assumes 200k for any model it does not know and
    // auto-compacts there. Only set when the catalog actually told us the
    // window: inventing a number would be worse than the stock assumption.
    if (contextWindow && contextWindow > 0) {
      env.push(["CLAUDE_CODE_MAX_CONTEXT_TOKENS", String(contextWindow)]);
    }

    // Identifies the traffic on OpenRouter's side. Both headers are optional
    // and OpenRouter uses them for its own attribution pages.
    if (model) {
      env.push(["OPENROUTER_APP_NAME", "Claude Launcher"]);
    }

    return env;
  },

  secretEnvVar: "ANTHROPIC_AUTH_TOKEN",
  // One key for every OpenRouter session, entered in Settings → OpenRouter.
  // Pre-fix, this was per project and adding a project meant pasting the key
  // again; nothing reads project-id-keyed credentials anymore (old ones decay
  // with project deletion).
  secretRef: OPENROUTER_DEFAULT_REF,

  secretHelp: {
    label: "OpenRouter API key",
    placeholder: "sk-or-v1-…",
    url: "https://openrouter.ai/keys",
  },

  subcommand: null,
  clearCommand: "/clear",

  capabilities: {
    // Claude Code is the binary, so anything that is really a property of the
    // *binary* is available. What differs is anything that assumes an
    // Anthropic account or an Anthropic model id.
    chimes: true,
    ideHooks: true,
    claudeRendererEnv: true,

    // The installed statusLine renders `model.display_name`, which for an
    // unmapped OpenRouter slug is either blank or the raw id. Rather than put
    // "deepseek/deepseek-v4-flash" in a tab title and call it a feature, this
    // stays off until the statusline learns to shorten a routed slug.
    modelInTitle: false,

    // Claude Code emits no OSC 9, and the notify callback is a Codex mechanism.
    osc9Status: false,
    notifyHook: false,

    // The banner model sniffer matches Anthropic display names ("Sonnet 4.6").
    // An OpenRouter session's banner carries a slug it will not match.
    modelSniffing: false,
  },
};
