//! Full-stack check of the OpenRouter launch path, minus React.
//!
//! Builds the exact `LaunchRequest` the frontend composes for an OpenRouter
//! project, resolves it through the real Windows Credential Manager, and spawns
//! a real Claude Code session with the resulting environment. It asserts the
//! session authenticates against OpenRouter and completes a tool-using turn.
//!
//! Ignored by default: it needs a funded key and it spends (fractions of a
//! cent). Run with the key in the environment:
//!
//! ```text
//! OPENROUTER_TEST_KEY=sk-or-v1-... cargo test --test openrouter_launch -- --ignored --nocapture
//! ```

use claude_launcher_lib::{describe_env, resolve_launch_env, LaunchRequest};

/// GLM 5.3 Flash's real window, which is nothing like the 200k Claude Code
/// assumes for a model it does not recognise. Seeing it echoed back in the
/// usage report is what proves CLAUDE_CODE_MAX_CONTEXT_TOKENS was honoured.
const CONTEXT_WINDOW: u32 = 1_310_720;

/// Mirrors `openrouterAgent.buildEnv` in src/agents/openrouter.ts. If that
/// changes, this should fail and be updated deliberately.
fn openrouter_request(reference: &str, cwd: &str, context_window: u32) -> LaunchRequest {
    LaunchRequest {
        agent_path: "claude".to_string(),
        project_path: cwd.to_string(),
        terminal_profile: "PowerShell".to_string(),
        flags: vec!["--model=z-ai/glm-5.3-flash".to_string()],
        subcommand: None,
        claude_features: true,
        notify_hook: false,
        pre_launch_command: None,
        tab_color: None,
        tab_title: None,
        dynamic_title: None,
        model_in_title: None,
        ide_renderer: None,
        env: vec![
            (
                "ANTHROPIC_BASE_URL".to_string(),
                "https://openrouter.ai/api".to_string(),
            ),
            (
                "CLAUDE_CODE_MAX_CONTEXT_TOKENS".to_string(),
                context_window.to_string(),
            ),
        ],
        secret_env_var: Some("ANTHROPIC_AUTH_TOKEN".to_string()),
        secret_ref: Some(reference.to_string()),
    }
}

#[test]
#[ignore]
fn resolved_env_authenticates_a_real_session() {
    let key = match std::env::var("OPENROUTER_TEST_KEY") {
        Ok(k) if !k.is_empty() => k,
        _ => {
            eprintln!("skipped: set OPENROUTER_TEST_KEY to run this");
            return;
        }
    };

    let reference = "launcher-e2e-openrouter-test";
    let dir = std::env::temp_dir().join("launcher-openrouter-e2e");
    std::fs::create_dir_all(&dir).unwrap();
    // A planted value the model can only report by actually calling Read.
    std::fs::write(
        dir.join("package.json"),
        r#"{"name":"or-e2e","version":"4.2.7"}"#,
    )
    .unwrap();

    // Store the key the way the Settings dialog would.
    let entry = keyring::Entry::new("claude-launcher", reference).unwrap();
    entry.set_password(&key).unwrap();

    let request = openrouter_request(reference, dir.to_str().unwrap(), CONTEXT_WINDOW);
    let env = resolve_launch_env(&request).expect("env should resolve");

    // The secret must be present in the spawn env but absent from the log line.
    let described = describe_env(&env);
    assert!(described.contains("ANTHROPIC_AUTH_TOKEN"));
    assert!(!described.contains(&key), "log line must not carry the key");
    let token = env
        .iter()
        .find(|(k, _)| k == "ANTHROPIC_AUTH_TOKEN")
        .map(|(_, v)| v.clone())
        .expect("key should have been resolved from the credential store");
    assert_eq!(token, key);

    let mut cmd = std::process::Command::new("claude");
    for (name, value) in &env {
        cmd.env(name, value);
    }
    cmd.env_remove("CLAUDECODE");
    cmd.env_remove("ANTHROPIC_API_KEY");
    cmd.current_dir(&dir).args([
        "-p",
        "Read package.json and report only the version field.",
        "--allowedTools",
        "Read",
        "--output-format",
        "json",
    ]);
    // The resolved flags carry --model. Omitting them made an earlier version
    // of this test pass while silently running Claude Code's *default* model
    // through OpenRouter: green, billed, and proving nothing about routing.
    for flag in &request.flags {
        cmd.arg(flag);
    }

    let out = cmd.output().expect("claude should spawn");
    let stdout = String::from_utf8_lossy(&out.stdout);

    // Clean up before asserting, so a failure doesn't strand a credential.
    let _ = entry.delete_credential();

    eprintln!("--- claude stdout ---\n{}", stdout);
    assert!(
        stdout.contains("4.2.7"),
        "session did not read the file through OpenRouter"
    );
    assert!(
        !stdout.contains("authentication_error"),
        "session failed to authenticate"
    );
    // Proves the routing happened rather than merely that a session ran. The
    // first version of this test asserted only on the answer, and passed with
    // `claude-sonnet-5` serving it.
    assert!(
        stdout.contains("z-ai/glm-5.3-flash"),
        "expected the routed model in the usage report, not a default"
    );
    assert!(
        !stdout.contains("\"canonicalModel\":\"claude-"),
        "an Anthropic model answered; the --model flag did not take effect"
    );
    // Without CLAUDE_CODE_MAX_CONTEXT_TOKENS this reads 200000 and the session
    // auto-compacts at a sixth of the window the user is paying for.
    assert!(
        stdout.contains(&format!("\"contextWindow\":{}", CONTEXT_WINDOW)),
        "context window was not carried through; auto-compact would fire early"
    );
}
