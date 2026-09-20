//! Per-project API keys, held in the Windows Credential Manager.
//!
//! Why not the store file: `claude-launcher-data.json` is plaintext JSON that
//! gets backed up, synced and read by anything with the user's profile. A
//! third-party model key is a billable credential, so it goes where Windows
//! already keeps billable credentials and the store file keeps only the fact
//! that one exists.
//!
//! The key never crosses the IPC boundary on the way *out*. The frontend can
//! write one and ask whether one exists, but cannot read one back: launches
//! name the credential and this process resolves it just before spawn (see
//! `apply_launch_env` in lib.rs). That keeps the secret out of the JS heap, out
//! of devtools, and out of the launch log.

use keyring::Entry;

/// Credential Manager service name. Every entry this app writes lives under it,
/// so an uninstall or a manual audit can find them all in one place
/// (`cmdkey /list` shows them as `LegacyGeneric:target=<service>.<ref>`).
const SERVICE: &str = "claude-launcher";

/// Reject a reference that could address a credential outside our namespace.
/// The reference is a project uuid in practice; this only has to ensure the
/// frontend can't send something that escapes `SERVICE`.
fn is_safe_ref(reference: &str) -> bool {
    !reference.is_empty()
        && reference.len() <= 128
        && reference
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

fn entry(reference: &str) -> Result<Entry, String> {
    if !is_safe_ref(reference) {
        return Err(format!("Invalid secret reference: {}", reference));
    }
    Entry::new(SERVICE, reference).map_err(|e| format!("Credential store unavailable: {}", e))
}

/// Read a stored key. Not a Tauri command on purpose — the frontend has no way
/// to call this. `Ok(None)` means no credential, which is a normal state (the
/// user hasn't entered a key yet) rather than an error.
pub(crate) fn get_secret(reference: &str) -> Result<Option<String>, String> {
    match entry(reference)?.get_password() {
        Ok(v) => Ok(Some(v)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(format!("Failed to read credential: {}", e)),
    }
}

/// Store (or replace) a project's key. An empty value deletes instead, so the
/// UI's "clear the field and save" gesture does what it looks like it does
/// rather than storing an empty credential that later reads as present.
#[tauri::command]
pub async fn set_project_secret(reference: String, value: String) -> Result<bool, String> {
    if value.is_empty() {
        return delete_project_secret(reference).await;
    }
    entry(&reference)?
        .set_password(&value)
        .map_err(|e| format!("Failed to store credential: {}", e))?;
    Ok(true)
}

/// Whether a key is stored. This is all the frontend ever learns about it.
#[tauri::command]
pub async fn has_project_secret(reference: String) -> Result<bool, String> {
    Ok(get_secret(&reference)?.is_some())
}

/// Remove a project's key. Deleting one that was never there is a success, so
/// callers (project deletion, "clear key") don't need to probe first.
#[tauri::command]
pub async fn delete_project_secret(reference: String) -> Result<bool, String> {
    match entry(&reference)?.delete_credential() {
        Ok(()) => Ok(true),
        Err(keyring::Error::NoEntry) => Ok(false),
        Err(e) => Err(format!("Failed to delete credential: {}", e)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_references_that_escape_the_namespace() {
        assert!(is_safe_ref("8f14e45f-ceea-467a-9e8b-1f0d4c2a3b55"));
        assert!(is_safe_ref("project_1"));
        assert!(!is_safe_ref(""));
        // A separator would let a caller address another service's credential.
        assert!(!is_safe_ref("a.b"));
        assert!(!is_safe_ref("a/b"));
        assert!(!is_safe_ref("a\\b"));
        assert!(!is_safe_ref(&"x".repeat(129)));
    }
}

/// Round-trips a real credential through the Windows Credential Manager.
///
/// Marked `#[ignore]` because it writes to the user's actual credential store;
/// run it deliberately with `cargo test -- --ignored`. It uses a reference no
/// project will ever have and removes it again, including on the failure paths
/// that matter.
#[cfg(test)]
mod store_roundtrip {
    use super::*;

    #[test]
    #[ignore]
    fn writes_reads_and_deletes() {
        let reference = "launcher-selftest-0000-0000";
        let secret = "sk-or-v1-not-a-real-key";

        // Clean slate even if a previous run died mid-test.
        let _ = entry(reference).unwrap().delete_credential();
        assert_eq!(get_secret(reference).unwrap(), None, "should start empty");

        entry(reference).unwrap().set_password(secret).unwrap();
        assert_eq!(get_secret(reference).unwrap().as_deref(), Some(secret));

        // Overwrite rather than duplicate.
        entry(reference).unwrap().set_password("second").unwrap();
        assert_eq!(get_secret(reference).unwrap().as_deref(), Some("second"));

        entry(reference).unwrap().delete_credential().unwrap();
        assert_eq!(get_secret(reference).unwrap(), None, "should be gone");
    }
}
