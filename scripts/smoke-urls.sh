#!/usr/bin/env bash
set -euo pipefail

json_rpc='{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"teak-smoke","version":"1.0.0"}}}'

tmp_body="$(mktemp)"
tmp_headers="$(mktemp)"
trap 'rm -f "$tmp_body" "$tmp_headers"' EXIT

check_status() {
  local expected="$1"
  local url="$2"
  local status
  status="$(curl -fsS -o "$tmp_body" -w '%{http_code}' "$url")"
  if [[ "$status" != "$expected" ]]; then
    echo "Expected $expected for $url, got $status" >&2
    cat "$tmp_body" >&2
    exit 1
  fi
}

check_contains() {
  local url="$1"
  local expected="$2"
  check_status 200 "$url"
  if ! grep -q "$expected" "$tmp_body"; then
    echo "Expected $url body to contain $expected" >&2
    cat "$tmp_body" >&2
    exit 1
  fi
}

check_mcp_unauthorized() {
  local url="$1"
  local expected_metadata="$2"
  local status
  status="$(
    curl -fsS -o "$tmp_body" -D "$tmp_headers" -w '%{http_code}' \
      -X POST "$url" \
      -H 'Accept: application/json, text/event-stream' \
      -H 'Content-Type: application/json' \
      -d "$json_rpc" || true
  )"
  if [[ "$status" != "401" ]]; then
    echo "Expected 401 for $url, got $status" >&2
    cat "$tmp_body" >&2
    exit 1
  fi
  if ! grep -qi 'WWW-Authenticate:' "$tmp_headers"; then
    echo "Missing WWW-Authenticate header for $url" >&2
    cat "$tmp_headers" >&2
    exit 1
  fi
  if ! grep -q "$expected_metadata" "$tmp_headers"; then
    echo "WWW-Authenticate for $url did not reference $expected_metadata" >&2
    cat "$tmp_headers" >&2
    exit 1
  fi
}

check_status 200 "https://teakvault.com/api/healthz"
check_contains "https://teakvault.com/api" '"version":"v1"'
check_contains "https://teakvault.com/api/v1" '"endpoint":"https://teakvault.com/mcp"'
check_contains "https://teakvault.com/api/openapi.json" '"openapi":"3.1.0"'
check_mcp_unauthorized \
  "https://teakvault.com/mcp" \
  "https://teakvault.com/.well-known/oauth-protected-resource/mcp"
check_contains \
  "https://teakvault.com/.well-known/oauth-protected-resource/mcp" \
  '"resource":"https://teakvault.com/mcp"'
check_status 200 "https://teakvault.com/llms.txt"
check_contains "https://teakvault.com/.well-known/mcp.json" '"endpoint":"https://teakvault.com/mcp"'

check_status 200 "https://api.teakvault.com/healthz"
check_contains "https://api.teakvault.com/v1" '"endpoint":"https://teakvault.com/mcp"'
check_contains "https://api.teakvault.com/openapi.json" '"openapi":"3.1.0"'
check_mcp_unauthorized \
  "https://api.teakvault.com/mcp" \
  "https://teakvault.com/.well-known/oauth-protected-resource/mcp"
