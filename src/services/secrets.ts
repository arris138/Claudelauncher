import { invoke } from "@tauri-apps/api/core";

/**
 * API keys and other billable secrets, stored in the Windows Credential
 * Manager by the Rust side (`src-tauri/src/secrets.rs`). A reference is either
 * a project id or a fixed account-level string — the OpenRouter API key and
 * its management key both use fixed refs (`OPENROUTER_DEFAULT_REF`,
 * `OPENROUTER_MANAGEMENT_REF` in `openrouterUsage.ts`). The command names
 * still say "project" for historical reasons; they take any reference.
 *
 * Note the missing function: there is no `getProjectSecret`. The backend
 * exposes no command to read a key back, so a stored key cannot be recovered
 * into the renderer, into devtools, or into the launch log. Launches pass the
 * reference and Rust resolves the value itself immediately before spawn.
 *
 * The consequence for the UI is that a key field can never be pre-filled. It
 * shows whether a key exists and offers to replace it, which is the same
 * bargain every OS credential prompt makes.
 */

/** Store or replace a project's key. An empty value deletes it. */
export function setProjectSecret(projectId: string, value: string): Promise<boolean> {
  return invoke<boolean>("set_project_secret", { reference: projectId, value });
}

/** Whether a key is stored for this project. */
export function hasProjectSecret(projectId: string): Promise<boolean> {
  return invoke<boolean>("has_project_secret", { reference: projectId });
}

/**
 * Remove a project's key. Safe to call for a project that never had one, so
 * project deletion can call it unconditionally rather than probing first.
 */
export function deleteProjectSecret(projectId: string): Promise<boolean> {
  return invoke<boolean>("delete_project_secret", { reference: projectId });
}
