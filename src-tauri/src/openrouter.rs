//! OpenRouter usage reporting for the launcher's chips.
//!
//! Same bargain as `secrets.rs` and the launch path: the frontend *names* a
//! credential, this side resolves it, makes the HTTPS call, and only parsed
//! numbers cross the IPC boundary. A key never enters the renderer, and none
//! of these requests touch the webview's network stack, so `connect-src` stays
//! as it is.
//!
//! Endpoint facts, checked against the OpenRouter docs on 2026-09-21:
//! - `GET /api/v1/key` — any API key. Cumulative `usage` plus daily/weekly/
//!   monthly windows, the key's credit limit, and the free-model daily request
//!   quota. The per-session chip lives on this: baseline at session start,
//!   deltas forever after.
//! - `GET /api/v1/activity` and `GET /api/v1/credits` — **management keys
//!   only**; an ordinary key gets 403 with "Only management keys can perform
//!   this operation". Activity rows carry per-day, per-model spend for the
//!   last 30 days (which is what makes a true rolling 14-day window possible,
//!   since `/key` only exposes fixed Monday/month windows), and `/credits`
//!   gives `total_credits` minus `total_usage` for the real account balance.
//!   The management key is stored as one more credential under a fixed
//!   reference; when it is absent the commands report that, and the frontend
//!   degrades to the `/key` windows.
//!
//! All three commands take no `AppHandle` because nothing here needs the log
//! path: failures return to the caller that displays them, rather than being
//! logged twice.

use chrono::{Duration, Utc};
use serde::Serialize;
use serde_json::Value;

/// Fixed credential reference for the optional account management key.
/// Split across `concat!` because this exact hyphenated compound has arrived
/// in a source file mangled once during this project's history (see the
/// warning in src/services/codingRankings.ts). Do not collapse it.
pub const MANAGEMENT_REF: &str = concat!("openrouter", "-management");

const API: &str = "https://openrouter.ai/api/v1";
const HTTP_TIMEOUT_SECS: u64 = 20;

/// Everything `/api/v1/key` says about one key, in credits (≈ USD).
#[derive(Serialize, Debug, Clone, Copy)]
#[serde(rename_all = "camelCase")]
pub struct KeyUsage {
    /// All-time spend on the key. The session chip deltas against a baseline
    /// taken the moment the session started.
    pub usage: f64,
    pub usage_daily: f64,
    pub usage_weekly: f64,
    pub usage_monthly: f64,
    /// Remaining credit allowance on the key, when it has a limit.
    pub limit_remaining: Option<f64>,
    pub is_free_tier: bool,
    /// Free-model requests left in the current UTC day, when reported.
    pub free_requests_remaining: Option<i64>,
}

/// Sum of [`KeyUsage`] across the distinct keys behind a set of projects.
#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct TotalUsage {
    pub usage_daily: f64,
    pub usage_weekly: f64,
    pub usage_monthly: f64,
    /// Distinct keys that answered. Projects sharing one key count once, so
    /// the launcher chip doesn't multiply the account's spend.
    pub keys: usize,
    /// Projects with no stored key (skipped).
    pub missing: usize,
    /// Distinct keys that failed the request (skipped).
    pub failed: usize,
}

/// The management-key view: a real rolling window and the account balance.
#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct AccountUsage {
    pub spend: f64,
    /// Days the window actually covered (capped at activity's 30-day reach).
    pub days: i64,
    /// `total_credits - total_usage`, when `/credits` answered.
    pub balance: Option<f64>,
}

fn num(v: &Value, key: &str) -> f64 {
    v.get(key).and_then(Value::as_f64).unwrap_or(0.0)
}

fn opt_num(v: &Value, key: &str) -> Option<f64> {
    v.get(key).and_then(Value::as_f64)
}

/// `{"data": {...}}` (or a bare object) → KeyUsage. Missing fields read as 0
/// rather than failing the call: the shape is OpenRouter's to evolve and every
/// field has a sane floor.
fn key_usage_from(body: &Value) -> KeyUsage {
    let d = body.get("data").unwrap_or(body);
    KeyUsage {
        usage: num(d, "usage"),
        usage_daily: num(d, "usage_daily"),
        usage_weekly: num(d, "usage_weekly"),
        usage_monthly: num(d, "usage_monthly"),
        limit_remaining: opt_num(d, "limit_remaining"),
        is_free_tier: d
            .get("is_free_tier")
            .and_then(Value::as_bool)
            .unwrap_or(false),
        free_requests_remaining: d
            .get("free_model_daily_requests")
            .and_then(|f| f.get("remaining"))
            .and_then(Value::as_i64),
    }
}

/// Sum the `usage` of activity rows dated on or after `cutoff` (inclusive),
/// where both sides are UTC `YYYY-MM-DD` strings so plain comparison works.
fn activity_spend(rows: &[Value], cutoff: &str) -> f64 {
    rows.iter()
        .filter(|r| r.get("date").and_then(Value::as_str).is_some_and(|d| d >= cutoff))
        .map(|r| num(r, "usage"))
        .sum()
}

fn http_json(url: &str, api_key: &str) -> Result<Value, String> {
    let outcome = ureq::get(url)
        .set("Authorization", &format!("Bearer {}", api_key))
        .set("Accept", "application/json")
        .timeout(std::time::Duration::from_secs(HTTP_TIMEOUT_SECS))
        .call();
    match outcome {
        Ok(resp) => resp
            .into_json::<Value>()
            .map_err(|e| format!("unreadable response from {}: {}", url, e)),
        Err(ureq::Error::Status(code, resp)) => {
            // The 403 from /activity and /credits explains itself ("Only
            // management keys…"); pass that through rather than a bare code.
            let detail = resp
                .into_string()
                .unwrap_or_default()
                .chars()
                .take(200)
                .collect::<String>();
            Err(format!("{}: HTTP {} {}", url, code, detail.trim()))
        }
        Err(e) => Err(format!("{}: {}", url, e)),
    }
}

fn resolve_key(secret_ref: &str) -> Result<String, String> {
    crate::secrets::get_secret(secret_ref)?.ok_or_else(|| {
        "no API key is stored for this project".to_string()
    })
}

/// Blocking core of [`openrouter_key_usage`], reachable from the ignored live
/// test without a tauri runtime.
fn fetch_key_usage(api_key: &str) -> Result<KeyUsage, String> {
    let body = http_json(&format!("{}/key", API), api_key)?;
    Ok(key_usage_from(&body))
}

/// Usage for one project's key. The IDE session chip calls this on a poll and
/// subtracts the value it captured when the session started.
#[tauri::command]
pub async fn openrouter_key_usage(secret_ref: String) -> Result<KeyUsage, String> {
    let key = resolve_key(&secret_ref)?;
    tauri::async_runtime::spawn_blocking(move || fetch_key_usage(&key))
        .await
        .map_err(|e| format!("usage task failed to join: {}", e))?
}

/// Aggregated windows across the distinct keys a set of projects uses. The
/// fallback for the launcher chip when no management key is configured.
#[tauri::command]
pub async fn openrouter_total_usage(secret_refs: Vec<String>) -> Result<TotalUsage, String> {
    let mut keys: Vec<String> = Vec::new();
    let mut missing = 0usize;
    for r in &secret_refs {
        match crate::secrets::get_secret(r)? {
            // A repeated key (two projects, one account) is fetched once.
            Some(k) if !keys.contains(&k) => keys.push(k),
            Some(_) => {}
            None => missing += 1,
        }
    }
    tauri::async_runtime::spawn_blocking(move || {
        let mut out = TotalUsage {
            usage_daily: 0.0,
            usage_weekly: 0.0,
            usage_monthly: 0.0,
            keys: 0,
            missing,
            failed: 0,
        };
        for key in &keys {
            match fetch_key_usage(key) {
                Ok(u) => {
                    out.usage_daily += u.usage_daily;
                    out.usage_weekly += u.usage_weekly;
                    out.usage_monthly += u.usage_monthly;
                    out.keys += 1;
                }
                Err(_) => out.failed += 1,
            }
        }
        Ok(out)
    })
    .await
    .map_err(|e| format!("usage task failed to join: {}", e))?
}

/// Rolling-window spend and account balance via the optional management key.
/// `Ok(None)` means "no management key stored" — the ordinary state, not an
/// error; anything else (401/403/network) is a real failure the UI should show
/// once rather than mask.
#[tauri::command]
pub async fn openrouter_account_usage(days: Option<i64>) -> Result<Option<AccountUsage>, String> {
    let Some(mgmt) = crate::secrets::get_secret(MANAGEMENT_REF)? else {
        return Ok(None);
    };
    // /activity's own reach is 30 days; asking for more only inflates the chip.
    let days = days.unwrap_or(14).clamp(1, 30);
    let cutoff = (Utc::now() - Duration::days(days - 1)).format("%Y-%m-%d").to_string();

    tauri::async_runtime::spawn_blocking(move || {
        let activity = http_json(&format!("{}/activity", API), &mgmt)?;
        let rows = activity
            .get("data")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        let mut out = AccountUsage {
            spend: activity_spend(&rows, &cutoff),
            days,
            balance: None,
        };
        // The balance is a bonus, not a requirement: an account with no
        // purchased credits (is_free_tier) has nothing to report here, and a
        // /credits failure must not hide the spend that just arrived.
        if let Ok(credits) = http_json(&format!("{}/credits", API), &mgmt) {
            let d = credits.get("data").unwrap_or(&credits);
            out.balance = Some(num(d, "total_credits") - num(d, "total_usage"));
        }
        Ok(Some(out))
    })
    .await
    .map_err(|e| format!("usage task failed to join: {}", e))?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn key_usage_parses_full_and_sparse_payloads() {
        let full: Value = serde_json::json!({
            "data": {
                "label": "dev",
                "usage": 12.5, "usage_daily": 0.42, "usage_weekly": 3.1, "usage_monthly": 9.0,
                "limit": 25.0, "limit_remaining": 12.5, "is_free_tier": false,
                "free_model_daily_requests": { "used": 7, "limit": 50, "remaining": 43 }
            }
        });
        let u = key_usage_from(&full);
        assert_eq!(u.usage, 12.5);
        assert_eq!(u.usage_weekly, 3.1);
        assert_eq!(u.limit_remaining, Some(12.5));
        assert_eq!(u.free_requests_remaining, Some(43));
        assert!(!u.is_free_tier);

        // A key response missing the newer windows must not fail; every field
        // floors at 0/None.
        let sparse: Value = serde_json::json!({ "data": { "usage": 1.0 } });
        let u = key_usage_from(&sparse);
        assert_eq!(u.usage, 1.0);
        assert_eq!(u.usage_weekly, 0.0);
        assert_eq!(u.limit_remaining, None);
        assert_eq!(u.free_requests_remaining, None);
    }

    #[test]
    fn activity_spend_sums_only_rows_inside_the_window() {
        let rows: Vec<Value> = serde_json::from_str(
            r#"[
                {"date": "2026-09-21", "model": "a/b",   "usage": 0.25},
                {"date": "2026-09-20", "model": "a/b",   "usage": 1.0},
                {"date": "2026-09-07", "model": "c/d",   "usage": 5.0},
                {"date": "2026-09-06", "model": "c/d",   "usage": 9.9},
                {"date": "2026-09-21", "model": "e/f",   "usage": 2.0, "requests": 4},
                {"date": "broken-no-usage-field"}
            ]"#,
        )
        .unwrap();
        // Cutoff inclusive: 09-07 is the last day inside a 14-day window
        // ending 09-21.
        let spend = activity_spend(&rows, "2026-09-07");
        assert!((spend - (0.25 + 1.0 + 5.0 + 2.0)).abs() < 1e-9);
        assert_eq!(activity_spend(&[], "2026-09-07"), 0.0);
    }

    #[test]
    fn management_reference_is_the_literal_the_frontend_sends() {
        assert_eq!(MANAGEMENT_REF, concat!("openrouter", "-", "management"));
        assert!(MANAGEMENT_REF.len() == 21);
        // Must satisfy secrets.rs's namespace rule if it ever routes through entry().
        assert!(MANAGEMENT_REF
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_'));
    }

    /// Hits live OpenRouter with a credential read from this machine's
    /// Credential Manager — the exact resolve → HTTPS → parse path the chips
    /// use. Prints numbers only; the key is never echoed.
    ///
    /// `OR_TEST_PROJECT_REF=<project uuid with a stored key> cargo test --lib
    /// openrouter -- --ignored --nocapture`
    #[test]
    #[ignore]
    fn live_key_usage_round_trip() {
        let Ok(reference) = std::env::var("OR_TEST_PROJECT_REF") else {
            panic!("set OR_TEST_PROJECT_REF to a project id with a stored OpenRouter key");
        };
        let key = crate::secrets::get_secret(&reference)
            .expect("credential store read failed")
            .expect("no key stored under that reference");
        let u = fetch_key_usage(&key).expect("live /key call failed");
        println!(
            "usage={:.4} daily={:.4} weekly={:.4} monthly={:.4} limit_remaining={:?} free_tier={} free_requests_remaining={:?}",
            u.usage,
            u.usage_daily,
            u.usage_weekly,
            u.usage_monthly,
            u.limit_remaining,
            u.is_free_tier,
            u.free_requests_remaining
        );
    }
}
