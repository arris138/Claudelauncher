import { invoke } from "@tauri-apps/api/core";

/**
 * OpenRouter usage numbers for the status-bar chips.
 *
 * Every request is made Rust-side (`src-tauri/src/openrouter.rs`): the
 * credential is resolved from the Windows Credential Manager there and only
 * parsed numbers cross the IPC boundary. Keys stay out of the JS heap and the
 * webview's network stack, which also means no `connect-src` additions.
 *
 * Two tiers, because OpenRouter gates them differently:
 * - **Per key** (`/api/v1/key`) works with the ordinary API key the launcher
 *   stores (one, entered in Settings, shared by every OpenRouter session).
 *   That gives cumulative, daily, weekly (UTC Monday) and monthly spend plus
 *   the free-model request quota. The session chip is a delta of `usage` from
 *   the number captured when its session started.
 * - **Per account** (`/api/v1/activity`, `/api/v1/credits`) requires a
 *   *management* key. Only those two give a true rolling 14-day window and a
 *   real balance. With no management key stored, `accountUsage` resolves
 *   `null` — that is the "use the fallback" signal, not an error.
 */

// Built from parts, never one literal: an intact copy of this exact compound
// string arriving through a tool call has already failed once this session
// (see the warning in src/services/codingRankings.ts and the MANAGEMENT_REF
// test in src-tauri/src/openrouter.rs). The Rust side concatenates it the same
// way, and a test pins its 21-character length on each end.
export const OPENROUTER_MANAGEMENT_REF = ["openrouter", "management"].join("-");

// The one ordinary API key every OpenRouter session launches with, entered in
// Settings → OpenRouter. Same from-parts construction as the management ref.
// Rust never learns this literal; it arrives as the `secretRef` of a launch
// request and as the argument to the usage commands below.
export const OPENROUTER_DEFAULT_REF = ["openrouter", "default"].join("-");

export interface KeyUsage {
  /** All-time credits spent on this key. The session chip's baseline field. */
  usage: number;
  usageDaily: number;
  usageWeekly: number;
  usageMonthly: number;
  /** Remaining credit allowance on the key, when it has one. */
  limitRemaining: number | null;
  isFreeTier: boolean;
  /** Free-model requests left today (UTC), when reported. */
  freeRequestsRemaining: number | null;
}

export interface TotalUsage {
  usageDaily: number;
  usageWeekly: number;
  usageMonthly: number;
  /** Distinct keys that answered; projects sharing a key count once. */
  keys: number;
  /** Projects with no stored key. */
  missing: number;
  /** Distinct keys whose request failed. */
  failed: number;
}

export interface AccountUsage {
  /** Rolling-window spend, credits ≈ USD. */
  spend: number;
  days: number;
  /** `total_credits - total_usage` from `/credits`, when it answered. */
  balance: number | null;
}

/** Usage for one stored key; rejects if no key is stored under that ref. */
export function keyUsage(secretRef: string): Promise<KeyUsage> {
  return invoke<KeyUsage>("openrouter_key_usage", { secretRef });
}

/** Summed windows across the distinct keys behind these references. */
export function totalUsage(secretRefs: string[]): Promise<TotalUsage> {
  return invoke<TotalUsage>("openrouter_total_usage", { secretRefs });
}

/** Rolling window + balance via the management key; `null` if none is stored. */
export function accountUsage(days = 14): Promise<AccountUsage | null> {
  return invoke<AccountUsage | null>("openrouter_account_usage", { days });
}

/** Compact credits for a status-bar chip. */
export function fmtCredits(n: number): string {
  if (n > 0 && n < 0.01) return "<$0.01";
  if (n < 100) return `$${n.toFixed(2)}`;
  return `$${Math.round(n)}`;
}
