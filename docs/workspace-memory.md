# Workspace memory with Hindsight

Code Bar can connect Claude Code and Codex to persistent project memory. Hindsight extracts and searches facts; Code Bar controls repository/task scope and keeps the original evidence locally.

## Enable

1. Release builds include a Hindsight sidecar and an ONNX embedding model. With the default local URL (`http://127.0.0.1:8888`), Code Bar starts or reuses that sidecar automatically. Release CI runs `scripts/build-hindsight-sidecar.py` to package the executable and model. A remote Hindsight URL can also be entered; in that mode Code Bar does not start a local process.
2. In **Settings → System → Workspace memory**, enter the Hindsight API base URL (for example `http://127.0.0.1:8888`), the model service URL (default `https://api.deepseek.com/v1`), model name and API key. The key is kept in the backend and passed to the local sidecar as its LLM key. Enter the normal API URL, **not** its `/mcp` URL; Code Bar derives `/mcp/codebar-<repository-uuid>/` for each repository. Automatic collection is separately configurable.
3. Start or restart a Code Bar Agent session. Existing running CLI processes must restart to receive MCP configuration. Code Bar adds a scoped stdio server using its own executable, without rewriting global Claude/Codex configuration.
4. Keep Code Bar's existing hooks integration enabled to bind newly created native Claude/Codex sessions. Resumed sessions already carrying a native session ID can be collected without waiting for a new binding hook. The collector intentionally does not guess a native session from cwd alone.
5. Open the brain icon in the sidebar. Collect evidence manually, inspect queue status, search memories and open source snapshots. Use **Review repository evidence** to browse all tasks locally, including deleted sessions. Evidence lists support pagination.
6. Review useful task evidence and select **Share with repository**. Other sessions in that repository can then retrieve it after synchronization. Unreviewed task evidence stays private to its originating Code Bar session.

Memory is off by default. Enabling it authorizes transmission of collected transcripts and Git evidence to the configured service. Hindsight deployment/model credentials are separate from the coding Agent's login. An unavailable memory service does not prevent the terminal from starting.

## Agent tools

| Tool | Arguments | Behavior |
|---|---|---|
| `recall` / `reflect` | Hindsight query arguments | Proxies the official Hindsight tools with task and repository tags forced by Code Bar. |
| `retain` / `sync_retain` | Hindsight retain arguments | Proxies the official Hindsight tools after creating a task-private, source-linked Code Bar snapshot. `memory_retain` remains a compatibility alias for `sync_retain`. |
| `memory_source` | `sourceId` | Reads a retained evidence snapshot with its provenance. |

The server fixes repository and task identity at launch; tools do not accept bank IDs, scope overrides or arbitrary source paths. Desktop review bindings cannot be used through MCP. Server guidance encourages recall before work and retaining decisions, failed approaches and verified outcomes. Newly queued notes are not immediately searchable; wait for **Synced**. The local snapshot is available immediately.

Each repository uses `codebar-<repository-uuid>` as its Hindsight bank. Code Bar mounts the Hindsight MCP server into the Agent's local stdio MCP process, keeps the API key in the backend, and filters out bank-management tools. Task and repository tags are applied by Code Bar, with `any_strict` filtering. The local `memory_source` tool remains the authority for immutable provenance and visibility checks. The Agent never receives a writable bank ID or can select another repository.

## Collection and provenance

- Git common-directory identity joins linked worktrees into one repository. Canonical paths avoid symlink aliases. Re-adding the same repository path retains its bank. Separate clones and repository moves to new paths currently create separate identities; no automatic cross-clone merging is performed.
- A Code Bar session is the task boundary. Resuming its provider session preserves the task. A new Code Bar session gets its own private memory and can retrieve reviewed repository knowledge.
- Native JSONL files are located by bound provider session ID and verified cwd, including configured provider storage directories. The collector reads public messages and tool evidence, not private reasoning fields. Codex response-item records are used to avoid ingesting duplicate event-message copies.
- JSONL byte offsets persist across application restarts; incomplete final records wait for the writer to finish. Records over 1 MiB get an explicit omission marker and are streamed past so later turns are not blocked. Normal large messages are split into bounded UTF-8 documents.
- Reachable Git history is backfilled in persisted pages of 20 commits per collection pass, restarting the scan when HEAD changes. Already collected commits are skipped. Commit messages and patches are evidence, not proof that the task succeeded; individual patches are capped at 96 KiB with a truncation notice. Other branches are collected when their worktrees/sessions are registered.
- Automatic collection runs while Code Bar is open, normally every 15 seconds and when woken by hooks or desktop actions. A slow Hindsight request can delay the next collection pass, but runs outside the terminal/UI thread.
- Source snapshots include repository/task/provider identifiers, message byte location or commit SHA, collection time, source metadata and the SHA-256 of the retained text. They survive deletion of a worktree or session. Common credential assignments, known token patterns and private-key blocks are redacted before storage; this is a best-effort filter, not comprehensive secret detection.
- SQLite stores snapshots, bindings, queue states and settings in the Tauri application data directory under `memory/` (`dev/memory/` in development). The directory has owner-only permissions on Unix. The service key stays in backend SQLite settings and is not included in Agent arguments or frontend persistence. Storage is not encrypted at rest; this is a local-user application boundary, not a sandbox against programs already running as that same user.

## Delivery, invalidation and failure handling

Delivery uses synchronous Hindsight retain inside the background worker. Only a successful synchronous response marks a source synced. Failed requests remain durable, retry with increasing delays up to one hour, and show their error in the panel. HTTP calls have a three-second connection timeout and 45-second total timeout. Deterministic document IDs make retries idempotent.

Changing the service URL or API key atomically requeues local sources. Batches stop when configuration changes; version checks prevent old acknowledgements from clearing newly queued work. An HTTP request already in flight may complete at the prior endpoint. Changing endpoints does not erase the previous endpoint's data.

**Invalidate** immediately removes a source from Code Bar retrieval and queues deletion of the corresponding Hindsight document. The local snapshot remains for provenance/audit. Invalidation is not permanent local erasure. Disabling memory stops subsequent collection/transmission and MCP tool access, while local evidence review remains available. Re-enabling resumes queued work. Already in-flight HTTP requests may finish.

## Verify

```bash
cargo test --manifest-path src-tauri/Cargo.toml --lib
pnpm build
cargo build --manifest-path src-tauri/Cargo.toml --bin code-bar
python3 scripts/test-memory-mcp.py
HINDSIGHT_TEST_API_KEY=... python3 scripts/test-hindsight-live.py
```

The live smoke test requires a temporary Hindsight API key in the environment and performs initialize, tool discovery, retain, recall and reflect without printing the key. The Rust suite covers isolation, repository identity, concurrent registration, durable sources, pagination, transcript parsing, redaction, real temporary Git repositories, outbox retries and Hindsight HTTP/MCP contracts using loopback mocks. The Python smoke test starts the real headless executable and verifies MCP initialization, native-session rebinding, Hindsight MCP mounting, write/read/search, scoped HTTP, disable behavior and parse errors. The smoke script uses Unix `select`; the Rust tests are the cross-platform core checks.

The Rust and frontend builds, mock-backed protocol flow and sidecar startup configuration are verified. Release CI must complete the model download and packaged Windows/macOS launch validation before publishing an installer; the model artifact is intentionally generated per target and is not committed to Git. The installed Codex CLI on this machine lacks its native executable, so a real Codex session could not be launched here. No live model credentials or external service configuration were changed by the implementation.
