use super::store::*;
use serde_json::json;

#[test]
fn mcp_binds_tools_to_server_context_and_rejects_extra_scope_arguments() {
    let root = temp();
    let db = Store::open(&root).unwrap();
    let b = db
        .register(&json!({"workspacePath":root,"sessionId":"a"}))
        .unwrap();
    db.configure(&json!({"enabled":true})).unwrap();
    let init=super::mcp::handle(&db,&b,&json!({"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18"}})).unwrap();
    assert_eq!(init["result"]["protocolVersion"], "2025-06-18");
    let bad=super::mcp::handle(&db,&b,&json!({"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"memory_retain","arguments":{"content":"test","scope":"repo"}}})).unwrap();
    assert_eq!(bad["result"]["isError"], true);
    let good=super::mcp::handle(&db,&b,&json!({"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"memory_retain","arguments":{"content":"Use transactions"}}})).unwrap();
    assert_ne!(good["result"]["isError"], true);
    assert_eq!(db.sources(&b).unwrap()[0]["scope"], "task");
    db.configure(&json!({"enabled":false})).unwrap();
    let disabled=super::mcp::handle(&db,&b,&json!({"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"memory_source","arguments":{"sourceId":"x"}}})).unwrap();
    assert_eq!(disabled["result"]["isError"], true);
    drop(db);
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn runner_mcp_config_keeps_paths_and_prompts_literal() {
    let exe = "/Applications/Code Bar.app/MacOS/code-bar";
    let dir = "C:\\Users\\User Name\\memory";
    let original = vec![
        "resume".into(),
        "native-id".into(),
        "fix `literal` $PATH".into(),
    ];
    let args = super::mcp::launch_args("codex", exe, dir, "token", original.clone());
    assert_eq!(&args[args.len() - original.len()..], original.as_slice());
    for pair in args[..args.len() - original.len()].chunks(2) {
        assert_eq!(pair[0], "-c");
        let _: toml::Table = toml::from_str(&pair[1]).unwrap();
    }
    let args = super::mcp::launch_args("claude-code", exe, dir, "token", vec!["prompt".into()]);
    assert_eq!(args[0], "--mcp-config");
    let config: serde_json::Value = serde_json::from_str(&args[1]).unwrap();
    assert_eq!(config["mcpServers"]["codebar-memory"]["command"], exe);
    assert_eq!(args.last().unwrap(), "prompt");
}

#[test]
fn parses_provider_evidence_without_private_reasoning_and_redacts_credentials() {
    use super::collect::{message_text, redact};
    let claude = json!({"type":"assistant","message":{"role":"assistant","content":[{"type":"thinking","thinking":"private"},{"type":"text","text":"Test failed"},{"type":"tool_result","content":"exit 1"}]}});
    let text = message_text("claude-code", &claude).unwrap();
    assert!(text.contains("Test failed"));
    assert!(!text.contains("private"));
    let codex = json!({"type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"Fix the transaction"}]}});
    assert!(message_text("codex", &codex)
        .unwrap()
        .contains("Fix the transaction"));
    assert!(message_text(
        "codex",
        &json!({"type":"response_item","payload":{"type":"reasoning","text":"private"}})
    )
    .is_none());
    let clean=redact("OPENAI_API_KEY=sk-abcdefghijklmnop123456\nAuthorization: Bearer token123\nuse transactions");
    assert!(!clean.contains("sk-abcdefghijkl"));
    assert!(!clean.contains("token123"));
    assert!(clean.contains("use transactions"));
}

#[test]
fn ingests_real_git_history_and_retains_evidence_after_branch_removal() {
    let root = temp();
    let git = |args: &[&str]| {
        let o = crate::util::background_command("git")
            .current_dir(&root)
            .args(args)
            .output()
            .unwrap();
        assert!(o.status.success(), "{}", String::from_utf8_lossy(&o.stderr));
    };
    git(&["init", "-q"]);
    git(&["config", "user.email", "test@example.test"]);
    git(&["config", "user.name", "Test"]);
    std::fs::write(root.join("app.txt"), "Use a transaction\n").unwrap();
    git(&["add", "app.txt"]);
    git(&["commit", "-qm", "Avoid partial writes"]);
    let db = Store::open(&root.join("data")).unwrap();
    db.configure(&json!({"enabled":true})).unwrap();
    let b = db
        .register(&json!({"workspacePath":root,"sessionId":"a"}))
        .unwrap();
    assert_eq!(super::collect::collect_git(&db, &b).unwrap(), 1);
    assert_eq!(super::collect::collect_git(&db, &b).unwrap(), 0);
    let rows = db.sources(&b).unwrap();
    let id = rows[0]["id"].as_str().unwrap();
    std::fs::remove_dir_all(root.join(".git")).unwrap();
    assert!(db.source(&b, id).unwrap()["content"]
        .as_str()
        .unwrap()
        .contains("Avoid partial writes"));
    drop(db);
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn hindsight_payload_enforces_strict_scope_and_cites_immutable_document() {
    let root = temp();
    let db = Store::open(&root).unwrap();
    let b = db
        .register(&json!({"workspacePath":root,"sessionId":"a"}))
        .unwrap();
    let id = db
        .enqueue(&b, "agent", "note", "Use transactions", "task", json!({}))
        .unwrap();
    let source = db.source(&b, &id).unwrap();
    let retain = super::client::retain_payload(&source);
    assert_eq!(retain["async"], false);
    assert_eq!(retain["items"][0]["document_id"], id);
    let query = super::client::recall_payload(&b, "transactions");
    assert_eq!(query["tags_match"], "any_strict");
    assert_eq!(
        query["tags"],
        json!([format!("task:{}", b.task_id), "scope:repo"])
    );
    assert_eq!(query["types"], json!(["world", "experience"]));
    drop(db);
    std::fs::remove_dir_all(root).unwrap();
}

fn temp() -> std::path::PathBuf {
    let p = std::env::temp_dir().join(format!("codebar-memory-test-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&p).unwrap();
    p
}

#[test]
fn repository_identity_survives_workspace_ids_and_reopening() {
    let root = temp();
    let db = Store::open(&root.join("data")).unwrap();
    let a = db
        .register(&json!({"workspacePath":root,"sessionId":"a","runnerType":"codex"}))
        .unwrap();
    let b = db
        .register(&json!({"workspacePath":root,"sessionId":"b","runnerType":"codex"}))
        .unwrap();
    assert_eq!(a.repo_id, b.repo_id);
    drop(db);
    let db = Store::open(&root.join("data")).unwrap();
    assert_eq!(db.binding(&a.token).unwrap().repo_id, a.repo_id);
    drop(db);
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn private_sources_cannot_cross_tasks_or_repositories_and_sharing_is_explicit() {
    let root = temp();
    let other = temp();
    let db = Store::open(&root.join("data")).unwrap();
    let a = db
        .register(&json!({"workspacePath":root,"sessionId":"a"}))
        .unwrap();
    let b = db
        .register(&json!({"workspacePath":root,"sessionId":"b"}))
        .unwrap();
    let c = db
        .register(&json!({"workspacePath":other,"sessionId":"a"}))
        .unwrap();
    let id = db
        .enqueue(&a, "agent", "note", "Use transactions", "task", json!({}))
        .unwrap();
    assert!(db.source(&b, &id).is_err());
    assert!(db.source(&c, &id).is_err());
    db.set_scope(&a, &id, "repo").unwrap();
    assert_eq!(db.source(&b, &id).unwrap()["content"], "Use transactions");
    assert!(db.source(&c, &id).is_err());
    db.invalidate(&a, &id).unwrap();
    assert!(db.source(&b, &id).is_err());
    drop(db);
    std::fs::remove_dir_all(root).unwrap();
    std::fs::remove_dir_all(other).unwrap();
}

#[test]
fn repeated_ingestion_is_idempotent_and_snapshot_outlives_source() {
    let root = temp();
    let db = Store::open(&root.join("data")).unwrap();
    let b = db
        .register(&json!({"workspacePath":root,"sessionId":"a"}))
        .unwrap();
    let one = db
        .enqueue(
            &b,
            "git",
            "abc123",
            "patch evidence",
            "task",
            json!({"sha":"abc123"}),
        )
        .unwrap();
    let two = db
        .enqueue(
            &b,
            "git",
            "abc123",
            "patch evidence",
            "task",
            json!({"sha":"abc123"}),
        )
        .unwrap();
    assert_eq!(one, two);
    assert_eq!(db.status(&b).unwrap()["sources"], 1);
    drop(db);
    let db = Store::open(&root.join("data")).unwrap();
    assert_eq!(db.source(&b, &one).unwrap()["content"], "patch evidence");
    drop(db);
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn rejects_non_http_service_urls_and_preserves_key_on_update() {
    let root = temp();
    let db = Store::open(&root).unwrap();
    assert!(db.configure(&json!({"baseUrl":"file:///tmp/db"})).is_err());
    db.configure(&json!({"enabled":true,"baseUrl":"http://127.0.0.1:8888","apiKey":"secret"}))
        .unwrap();
    let config = db.configure(&json!({"autoCollect":false})).unwrap();
    assert_eq!(config["hasApiKey"], true);
    assert!(config.get("apiKey").is_none());
    assert_eq!(db.config().unwrap().api_key, "secret");
    drop(db);
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn transcript_cursor_waits_for_complete_records_and_never_duplicates_replay() {
    let root = temp();
    let db = Store::open(&root.join("data")).unwrap();
    let b=db.register(&json!({"workspacePath":root,"sessionId":"a","runnerType":"codex","providerSessionId":"native-1"})).unwrap();
    let path = root.join("session.jsonl");
    let line=json!({"type":"response_item","payload":{"type":"message","role":"assistant","content":[{"type":"output_text","text":"The regression test fails before this fix."}]}}).to_string();
    std::fs::write(&path, &line).unwrap();
    assert_eq!(
        super::collect::collect_transcript_file(&db, &b, &path).unwrap(),
        0
    );
    std::fs::write(&path, format!("{line}\n")).unwrap();
    assert_eq!(
        super::collect::collect_transcript_file(&db, &b, &path).unwrap(),
        1
    );
    assert_eq!(
        super::collect::collect_transcript_file(&db, &b, &path).unwrap(),
        0
    );
    assert_eq!(db.sources(&b).unwrap().len(), 1);
    drop(db);
    std::fs::remove_dir_all(root).unwrap();
}

fn mock_http(
    responses: Vec<(u16, serde_json::Value)>,
) -> (
    String,
    std::thread::JoinHandle<Vec<(String, serde_json::Value)>>,
) {
    mock_http_hook(responses, || {})
}
fn mock_http_hook(
    responses: Vec<(u16, serde_json::Value)>,
    mut before_response: impl FnMut() + Send + 'static,
) -> (
    String,
    std::thread::JoinHandle<Vec<(String, serde_json::Value)>>,
) {
    use std::io::{Read, Write};
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let url = format!("http://{}", listener.local_addr().unwrap());
    let thread = std::thread::spawn(move || {
        let mut captured = Vec::new();
        for (status, response) in responses {
            let (mut stream, _) = listener.accept().unwrap();
            stream
                .set_read_timeout(Some(std::time::Duration::from_secs(5)))
                .unwrap();
            let mut header = Vec::new();
            let mut byte = [0];
            while !header.ends_with(b"\r\n\r\n") {
                stream.read_exact(&mut byte).unwrap();
                header.push(byte[0]);
            }
            let header = String::from_utf8(header).unwrap();
            let len = header
                .lines()
                .find_map(|s| {
                    s.to_ascii_lowercase()
                        .strip_prefix("content-length:")
                        .map(|s| s.trim().parse::<usize>().unwrap())
                })
                .unwrap_or(0);
            let mut body = vec![0; len];
            stream.read_exact(&mut body).unwrap();
            captured.push((header, serde_json::from_slice(&body).unwrap_or(json!(null))));
            before_response();
            let body = response.to_string();
            write!(stream,"HTTP/1.1 {status} Test\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",body.len(),body).unwrap();
        }
        captured
    });
    (url, thread)
}

#[test]
fn failed_upload_retries_same_document_and_recall_filters_untraceable_or_private_results() {
    let root = temp();
    let db = Store::open(&root).unwrap();
    let a = db
        .register(&json!({"workspacePath":root,"sessionId":"a"}))
        .unwrap();
    let b = db
        .register(&json!({"workspacePath":root,"sessionId":"b"}))
        .unwrap();
    let id = db
        .enqueue(&a, "agent", "note", "Use transactions", "task", json!({}))
        .unwrap();
    let (url, server) = mock_http(vec![
        (503, json!({"error":"unavailable"})),
        (200, json!({"success":true,"async":false})),
        (
            200,
            json!({"results":[{"id":"one","text":"Use transactions","document_id":id},{"id":"bad","text":"Untraceable","document_id":"unknown"}]}),
        ),
        (
            200,
            json!({"results":[{"id":"one","text":"Use transactions","document_id":id}]}),
        ),
        (200, json!({"success":true})),
    ]);
    db.configure(&json!({"enabled":true,"baseUrl":url,"apiKey":"local-test-key"}))
        .unwrap();
    assert_eq!(super::client::deliver(&db).unwrap(), 0);
    assert_eq!(db.status(&a).unwrap()["failed"], 1);
    db.db
        .execute("UPDATE sources SET next_retry=0", [])
        .unwrap();
    assert_eq!(super::client::deliver(&db).unwrap(), 1);
    assert_eq!(
        super::client::recall(&db, &b, "transactions").unwrap()["results"],
        json!([])
    );
    db.set_scope(&a, &id, "repo").unwrap();
    let found = super::client::recall(&db, &b, "transactions").unwrap();
    assert_eq!(found["results"][0]["sourceId"], id);
    db.invalidate(&a, &id).unwrap();
    assert_eq!(super::client::deliver(&db).unwrap(), 1);
    let requests = server.join().unwrap();
    assert_eq!(
        requests[0].1["items"][0]["document_id"],
        requests[1].1["items"][0]["document_id"]
    );
    assert!(requests[0]
        .0
        .to_ascii_lowercase()
        .contains("authorization: bearer local-test-key"));
    assert!(requests[4]
        .0
        .starts_with("DELETE /v1/default/banks/codebar-"));
    drop(db);
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn never_marks_async_or_malformed_retention_response_synced() {
    let root = temp();
    let db = Store::open(&root).unwrap();
    let b = db
        .register(&json!({"workspacePath":root,"sessionId":"a"}))
        .unwrap();
    db.enqueue(&b, "agent", "x", "test evidence", "task", json!({}))
        .unwrap();
    let (url, server) = mock_http(vec![(200, json!({"async":true,"success":true}))]);
    db.configure(&json!({"enabled":true,"baseUrl":url}))
        .unwrap();
    assert_eq!(super::client::deliver(&db).unwrap(), 0);
    assert_eq!(db.status(&b).unwrap()["failed"], 1);
    server.join().unwrap();
    drop(db);
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn repository_review_can_access_archived_task_sources_but_cannot_cross_repos() {
    let root = temp();
    let other = temp();
    let db = Store::open(&root).unwrap();
    let a = db
        .register(&json!({"workspacePath":root,"sessionId":"a"}))
        .unwrap();
    let review = db
        .register(
            &json!({"workspacePath":root,"sessionId":"workspace-review","runnerType":"desktop"}),
        )
        .unwrap();
    let other_review = db
        .register(
            &json!({"workspacePath":other,"sessionId":"workspace-review","runnerType":"desktop"}),
        )
        .unwrap();
    let id = db
        .enqueue(
            &a,
            "agent",
            "archived",
            "Keep evidence after task deletion",
            "task",
            json!({}),
        )
        .unwrap();
    assert!(db.source(&review, &id).is_ok());
    assert!(db.source(&other_review, &id).is_err());
    db.set_scope(&review, &id, "repo").unwrap();
    drop(db);
    std::fs::remove_dir_all(root).unwrap();
    std::fs::remove_dir_all(other).unwrap();
}

#[test]
fn reopening_binding_after_worktree_removal_preserves_task_sources() {
    let root = temp();
    let wt = temp();
    std::fs::remove_dir_all(&wt).unwrap();
    let git = |args: &[&str]| {
        let o = crate::util::background_command("git")
            .current_dir(&root)
            .args(args)
            .output()
            .unwrap();
        assert!(o.status.success(), "{}", String::from_utf8_lossy(&o.stderr));
    };
    git(&["init", "-q"]);
    git(&["config", "user.email", "test@example.test"]);
    git(&["config", "user.name", "Test"]);
    git(&["commit", "--allow-empty", "-qm", "Initial"]);
    git(&["worktree", "add", "-qb", "task", wt.to_str().unwrap()]);
    let db = Store::open(&root.join("data")).unwrap();
    let input = json!({"workspacePath":root,"sessionId":"a","worktreePath":wt});
    let b = db.register(&input).unwrap();
    let id = db
        .enqueue(&b, "agent", "note", "Keep the rationale", "task", json!({}))
        .unwrap();
    git(&["worktree", "remove", wt.to_str().unwrap()]);
    let reopened = db.register(&input).unwrap();
    assert_eq!(reopened.token, b.token);
    assert!(db.source(&reopened, &id).is_ok());
    drop(db);
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn git_collection_pages_beyond_initial_window() {
    let root = temp();
    let git = |args: &[&str]| {
        let o = crate::util::background_command("git")
            .current_dir(&root)
            .args(args)
            .output()
            .unwrap();
        assert!(o.status.success());
    };
    git(&["init", "-q"]);
    git(&["config", "user.email", "test@example.test"]);
    git(&["config", "user.name", "Test"]);
    for i in 0..25 {
        git(&["commit", "--allow-empty", "-qm", &format!("Decision {i}")]);
    }
    let db = Store::open(&root.join("data")).unwrap();
    let b = db
        .register(&json!({"workspacePath":root,"sessionId":"a"}))
        .unwrap();
    assert_eq!(super::collect::collect_git(&db, &b).unwrap(), 20);
    assert_eq!(super::collect::collect_git(&db, &b).unwrap(), 5);
    // Pagination is persistent; it doesn't rescan the first page on every poll.
    let cursor = db
        .cursor(&format!("git-page:{}:{}", b.repo_id, b.task_id))
        .unwrap();
    assert_eq!(
        serde_json::from_str::<serde_json::Value>(&cursor).unwrap()["offset"],
        25
    );
    assert_eq!(super::collect::collect_git(&db, &b).unwrap(), 0);
    drop(db);
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn source_review_pages_preserve_access_to_older_private_evidence() {
    let root = temp();
    let db = Store::open(&root).unwrap();
    let b = db
        .register(&json!({"workspacePath":root,"sessionId":"a"}))
        .unwrap();
    for i in 0..205 {
        db.enqueue(&b, "agent", &i.to_string(), "evidence", "task", json!({}))
            .unwrap();
    }
    let first = db.sources_page(&b, 0).unwrap();
    let next = db.sources_page(&b, 200).unwrap();
    assert_eq!(first.len(), 200);
    assert_eq!(next.len(), 5);
    assert!(!first
        .iter()
        .any(|a| next.iter().any(|b| a["id"] == b["id"])));
    drop(db);
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn oversized_transcript_record_does_not_block_later_turns() {
    let root = temp();
    let db = Store::open(&root.join("data")).unwrap();
    let b = db
        .register(&json!({"workspacePath":root,"sessionId":"a","runnerType":"codex"}))
        .unwrap();
    let path = root.join("log.jsonl");
    let later = json!({"type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"Keep later turns"}]}});
    std::fs::write(
        &path,
        format!("{}\n{later}\n", "x".repeat(1024 * 1024 + 500)),
    )
    .unwrap();
    assert_eq!(
        super::collect::collect_transcript_file(&db, &b, &path).unwrap(),
        2
    );
    assert!(db.sources(&b).unwrap().iter().any(|s| db
        .source(&b, s["id"].as_str().unwrap())
        .unwrap()["content"]
        .as_str()
        .unwrap()
        .contains("Keep later turns")));
    assert_eq!(
        super::collect::collect_transcript_file(&db, &b, &path).unwrap(),
        0
    );
    drop(db);
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn changing_service_during_upload_requeues_all_and_stops_old_batch() {
    let root = temp();
    let db = Store::open(&root).unwrap();
    let b = db
        .register(&json!({"workspacePath":root,"sessionId":"a"}))
        .unwrap();
    db.enqueue(&b, "agent", "first", "First lesson", "task", json!({}))
        .unwrap();
    db.enqueue(&b, "agent", "second", "Second lesson", "task", json!({}))
        .unwrap();
    let (next_url, next_server) = mock_http(vec![
        (200, json!({"success":true,"async":false})),
        (200, json!({"success":true,"async":false})),
    ]);
    let next = next_url.clone();
    let data = root.clone();
    let (old_url, old_server) = mock_http_hook(
        vec![(200, json!({"success":true,"async":false}))],
        move || {
            Store::open(&data)
                .unwrap()
                .configure(&json!({"baseUrl":next,"apiKey":"new-key"}))
                .unwrap();
        },
    );
    db.configure(&json!({"enabled":true,"baseUrl":old_url}))
        .unwrap();
    super::client::deliver(&db).unwrap();
    assert_eq!(db.config().unwrap().base_url, next_url);
    assert_eq!(db.status(&b).unwrap()["synced"], 0);
    assert_eq!(db.status(&b).unwrap()["pending"], 2);
    assert_eq!(super::client::deliver(&db).unwrap(), 2);
    assert_eq!(old_server.join().unwrap().len(), 1);
    let requests = next_server.join().unwrap();
    assert_eq!(requests.len(), 2);
    assert!(requests[0]
        .0
        .to_ascii_lowercase()
        .contains("authorization: bearer new-key"));
    drop(db);
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn concurrent_registration_preserves_one_token_per_task() {
    let root = temp();
    let db = Store::open(&root).unwrap();
    drop(db);
    let handles = (0..4)
        .map(|_| {
            let root = root.clone();
            std::thread::spawn(move || {
                Store::open(&root)
                    .unwrap()
                    .register(&json!({"workspacePath":root,"sessionId":"same"}))
                    .unwrap()
                    .token
            })
        })
        .collect::<Vec<_>>();
    let tokens = handles
        .into_iter()
        .map(|h| h.join().unwrap())
        .collect::<Vec<_>>();
    assert!(tokens.iter().all(|token| token == &tokens[0]));
    let db = Store::open(&root).unwrap();
    assert_eq!(db.binding(&tokens[0]).unwrap().token, tokens[0]);
    drop(db);
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn hindsight_mcp_sse_and_tool_filtering_are_safe() {
    let parsed = super::mcp::parse_upstream_response(
        b"event: message\ndata: {\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{}}\n\n",
        true,
    )
    .unwrap();
    assert_eq!(parsed["result"], json!({}));
    let filtered = super::mcp::filter_upstream_tools(&json!({
        "jsonrpc":"2.0","id":1,"result":{"tools":[
            {"name":"retain"},{"name":"recall"},{"name":"delete_bank"}
        ]}
    }));
    let names: Vec<_> = filtered["result"]["tools"]
        .as_array()
        .unwrap()
        .iter()
        .map(|v| v["name"].as_str().unwrap())
        .collect();
    assert_eq!(names, vec!["retain", "recall", "memory_source"]);
}

#[test]
fn agent_retain_rewrite_fixes_repository_scope_and_links_source() {
    let root = temp();
    let db = Store::open(&root).unwrap();
    let b = db
        .register(
            &json!({"workspacePath":root,"sessionId":"session-1","providerSessionId":"provider-1"}),
        )
        .unwrap();
    let request = json!({
        "jsonrpc":"2.0","id":9,"method":"tools/call",
        "params":{"name":"retain","arguments":{"content":"Use transactions","tags":["other-repo"],"bank_id":"evil"}}
    });
    let (rewritten, source) = super::mcp::rewrite_upstream_call(&db, &b, &request).unwrap();
    let source_id = source.unwrap().0;
    assert_eq!(rewritten["params"]["name"], "retain");
    assert_eq!(rewritten["params"]["arguments"]["document_id"], source_id);
    assert_eq!(
        rewritten["params"]["arguments"]["tags"],
        json!([format!("task:{}", b.task_id)])
    );
    assert_eq!(
        db.source(&b, &source_id).unwrap()["metadata"]["session_id"],
        "session-1"
    );
    let forbidden = json!({
        "jsonrpc":"2.0","id":10,"method":"tools/call",
        "params":{"name":"retain","arguments":{"content":"x","scope":"repo"}}
    });
    assert!(super::mcp::rewrite_upstream_call(&db, &b, &forbidden).is_err());
    drop(db);
    std::fs::remove_dir_all(root).unwrap();
}
