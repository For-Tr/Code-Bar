#!/usr/bin/env python3
"""Exercise the real headless executable and Hindsight HTTP boundary without an LLM.
Run after cargo build: python3 scripts/test-memory-mcp.py [path/to/code-bar]
Only uses a temporary database and a loopback mock service; no user config is read.
"""
import hashlib
import json
import pathlib
import sqlite3
import subprocess
import sys
import tempfile
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

binary = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else "src-tauri/target/debug/code-bar").resolve()
with tempfile.TemporaryDirectory(prefix="codebar-mcp-smoke-") as directory:
    # Bootstrap the exact production schema through the headless entry point.
    bootstrap = subprocess.run([str(binary), "--memory-mcp", directory, "missing"], input="", text=True, capture_output=True, timeout=15)
    assert bootstrap.returncode == 1 and "Unknown memory session" in bootstrap.stderr, bootstrap
    database = pathlib.Path(directory) / "memory.sqlite3"
    db = sqlite3.connect(database)
    repo = "11111111-1111-4111-8111-111111111111"
    binding = dict(token="test-token", repoId=repo, sessionId="test-session", taskId=hashlib.sha256(b"task").hexdigest(), workspacePath=directory, worktreePath=directory, runnerType="codex", providerSessionId="", providerRoot="")
    db.execute("INSERT INTO repos VALUES (?,?)", ("dir:" + directory, repo))
    db.execute("INSERT INTO bindings VALUES (?,?,?,?)", (binding["token"], repo, binding["sessionId"], json.dumps(binding)))
    captured = []

    class Hindsight(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def do_POST(self):
            body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
            captured.append((self.path, body))
            assert self.headers["Authorization"] == "Bearer smoke-key"
            method = body.get("method")
            if method == "initialize":
                payload = {"jsonrpc": "2.0", "id": body["id"], "result": {"protocolVersion": "2025-06-18", "capabilities": {"tools": {}}, "serverInfo": {"name": "hindsight", "version": "test"}}}
            elif method == "tools/list":
                payload = {"jsonrpc": "2.0", "id": body["id"], "result": {"tools": [{"name": "retain", "inputSchema": {"type": "object"}}, {"name": "sync_retain", "inputSchema": {"type": "object"}}, {"name": "recall", "inputSchema": {"type": "object"}}, {"name": "reflect", "inputSchema": {"type": "object"}}, {"name": "delete_bank", "inputSchema": {"type": "object"}}]}}
            elif method == "tools/call" and body["params"]["name"] in ("retain", "sync_retain"):
                payload = {"jsonrpc": "2.0", "id": body["id"], "result": {"content": [{"type": "text", "text": "retained"}], "isError": False}}
            elif method == "tools/call" and body["params"]["name"] == "recall":
                with sqlite3.connect(database) as query_db:
                    source_id = query_db.execute("SELECT id FROM sources LIMIT 1").fetchone()[0]
                payload = {"jsonrpc": "2.0", "id": body["id"], "result": {"content": [{"type": "text", "text": "Use transactions"}], "structuredContent": {"results": [{"id": "fact-1", "text": "Use transactions", "document_id": source_id}, {"id": "untraceable", "text": "Must not escape", "document_id": "unknown"}]}, "isError": False}}
            else:
                payload = {"jsonrpc": "2.0", "id": body.get("id"), "result": {}}
            result = json.dumps(payload).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(result)))
            self.end_headers()
            self.wfile.write(result)

    server = ThreadingHTTPServer(("127.0.0.1", 0), Hindsight)
    worker = threading.Thread(target=server.serve_forever, daemon=True)
    worker.start()
    config = dict(enabled=True, autoCollect=False, baseUrl=f"http://127.0.0.1:{server.server_port}", apiKey="smoke-key")
    db.execute("INSERT INTO settings VALUES (1,?)", (json.dumps(config),))
    db.commit()
    process = subprocess.Popen([str(binary), "--memory-mcp", directory, binding["token"]], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    sequence = 0

    def call(method, params=None):
        global sequence
        sequence += 1
        process.stdin.write(json.dumps(dict(jsonrpc="2.0", id=sequence, method=method, params=params or {})) + "\n")
        process.stdin.flush()
        # select works for this Unix desktop smoke test; core protocol tests are cross-platform Rust.
        import select
        ready, _, _ = select.select([process.stdout], [], [], 10)
        assert ready, "MCP response timed out"
        response = json.loads(process.stdout.readline())
        assert response["id"] == sequence, response
        return response

    try:
        initialized = call("initialize", {"protocolVersion": "2025-06-18", "capabilities": {}, "clientInfo": {"name": "smoke", "version": "1"}})
        assert initialized["result"]["serverInfo"]["name"] == "hindsight"
        process.stdin.write('{"jsonrpc":"2.0","method":"notifications/initialized"}\n')
        process.stdin.flush()
        tool_names = {tool["name"] for tool in call("tools/list")["result"]["tools"]}
        assert tool_names == {"retain", "sync_retain", "recall", "reflect", "memory_source"}
        # A native session is bound after MCP startup; new notes must capture it.
        binding["providerSessionId"] = "native-after-start"
        db.execute("UPDATE bindings SET json=? WHERE token=?", (json.dumps(binding), binding["token"]))
        db.commit()
        saved = call("tools/call", {"name": "memory_retain", "arguments": {"content": "Use transactions; verified with a rollback regression test."}})["result"]
        assert not saved["isError"], saved
        source_id = saved["structuredContent"]["sourceId"]
        source = call("tools/call", {"name": "memory_source", "arguments": {"sourceId": source_id}})["result"]["structuredContent"]
        assert source["metadata"]["provider_session_id"] == "native-after-start"
        assert source["scope"] == "task" and "rollback" in source["content"]
        recalled = call("tools/call", {"name": "recall", "arguments": {"query": "transactions"}})["result"]["structuredContent"]
        assert len(recalled["results"]) == 1 and recalled["results"][0]["document_id"] == source_id
        assert captured[-1][0] == f"/mcp/codebar-{repo}/"
        assert captured[-1][1]["params"]["arguments"]["tags_match"] == "any_strict"
        forbidden = call("tools/call", {"name": "memory_retain", "arguments": {"content": "secret", "scope": "repo"}})
        assert forbidden["result"]["isError"]
        config["enabled"] = False
        db.execute("UPDATE settings SET json=? WHERE id=1", (json.dumps(config),))
        db.commit()
        disabled = call("tools/call", {"name": "memory_source", "arguments": {"sourceId": source_id}})
        assert disabled["result"]["isError"]
        process.stdin.write("not JSON\n")
        process.stdin.flush()
        assert json.loads(process.stdout.readline())["error"]["code"] == -32700
        process.stdin.close()
        assert process.wait(timeout=10) == 0
        assert not process.stderr.read(), "Headless MCP must not start GUI or emit unexpected errors"
        print("PASS: real stdio MCP handshake, native rebind, retain/source/recall, scoped HTTP, forbidden writes, disable and parse errors")
    finally:
        if process.poll() is None:
            process.kill()
            process.wait(timeout=10)
        db.close()
        server.shutdown()
        server.server_close()
        worker.join(timeout=5)
