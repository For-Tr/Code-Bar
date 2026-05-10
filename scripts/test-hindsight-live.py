#!/usr/bin/env python3
"""Live Hindsight MCP smoke test.

Required: HINDSIGHT_TEST_API_KEY (never printed).
Optional: HINDSIGHT_TEST_URL, default http://127.0.0.1:8888/mcp/codebar-live-test/
"""
import json, os, sys, urllib.error, urllib.request, uuid

url = os.environ.get("HINDSIGHT_TEST_URL", "http://127.0.0.1:8888/mcp/codebar-live-test/")
key = os.environ.get("HINDSIGHT_TEST_API_KEY", "")
if not key:
    raise SystemExit("HINDSIGHT_TEST_API_KEY is required")

counter = 0
def rpc(method, params=None):
    global counter
    counter += 1
    payload = {"jsonrpc": "2.0", "id": counter, "method": method}
    if params is not None:
        payload["params"] = params
    headers = {"Content-Type": "application/json", "Accept": "application/json, text/event-stream", "Authorization": f"Bearer {key}"}
    if rpc.session:
        headers["Mcp-Session-Id"] = rpc.session
    req = urllib.request.Request(url, json.dumps(payload).encode(), headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=90) as response:
            if response.headers.get("Mcp-Session-Id"):
                rpc.session = response.headers["Mcp-Session-Id"]
            body = response.read().decode()
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode(errors="replace")[:500]
        raise RuntimeError(f"Hindsight MCP {method} returned HTTP {exc.code}: {detail}") from exc
    for line in body.splitlines():
        if line.startswith("data: "):
            return json.loads(line[6:])
    return json.loads(body)

rpc.session = ""
init = rpc("initialize", {"protocolVersion": "2025-03-26", "capabilities": {}, "clientInfo": {"name": "codebar-live-test", "version": "1"}})
if "result" not in init:
    raise RuntimeError(f"initialize failed: {init}")
tools = rpc("tools/list", {}).get("result", {}).get("tools", [])
names = {tool.get("name") for tool in tools}
required = {"retain", "recall", "reflect"}
if not required.issubset(names):
    raise RuntimeError(f"required tools missing: {sorted(required - names)}")

doc_id = "codebar-live-test-" + uuid.uuid4().hex
retained = rpc("tools/call", {"name": "retain", "arguments": {"content": "Code Bar live MCP smoke test: Rust Tauri workspace memory keeps Commit SHA and Session provenance.", "context": "project", "tags": ["codebar-live-test"], "document_id": doc_id}})
if retained.get("result") is None or retained.get("error"):
    raise RuntimeError(f"retain failed: {retained}")
recalled = rpc("tools/call", {"name": "recall", "arguments": {"query": "Commit SHA Session provenance", "tags": ["codebar-live-test"], "tags_match": "all"}})
if recalled.get("result") is None or recalled.get("error"):
    raise RuntimeError(f"recall failed: {recalled}")
reflected = rpc("tools/call", {"name": "reflect", "arguments": {"query": "What provenance does Code Bar memory keep?", "tags": ["codebar-live-test"], "budget": "low"}})
if reflected.get("result") is None or reflected.get("error"):
    raise RuntimeError(f"reflect failed: {reflected}")
print("PASS: Hindsight MCP initialize, tools/list, retain, recall and reflect")
