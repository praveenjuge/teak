#!/usr/bin/env bash
set -euo pipefail

# Smoke the public API/MCP surface.
# Usage: BASE_URL=https://preview-url.vercel.app bash scripts/smoke-urls.sh
#        SMOKE_BASE_URL=... bash scripts/smoke-urls.sh
# Defaults to production https://teakvault.com for scheduled checks.
BASE_URL="${SMOKE_BASE_URL:-${BASE_URL:-https://teakvault.com}}"
BASE_URL="${BASE_URL%/}"
IS_PROD="false"
if [[ "$BASE_URL" == "https://teakvault.com" ]]; then
  IS_PROD="true"
fi
echo "Smoke base: $BASE_URL (prod: $IS_PROD)"

json_rpc='{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"teak-smoke","version":"1.0.0"}}}'
curl_common=(
  --connect-timeout 10
  --max-time 30
  --retry 3
  --retry-all-errors
  --retry-delay 2
)

tmp_body="$(mktemp)"
tmp_headers="$(mktemp)"
trap 'rm -f "$tmp_body" "$tmp_headers"' EXIT

check_status() {
  local expected="$1"
  local url="$2"
  local status
  status="$(curl "${curl_common[@]}" -fsS -o "$tmp_body" -w '%{http_code}' "$url")"
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
  if ! grep -Fq "$expected" "$tmp_body"; then
    echo "Expected $url body to contain $expected" >&2
    cat "$tmp_body" >&2
    exit 1
  fi
}

check_matches() {
  local url="$1"
  local expected="$2"
  check_status 200 "$url"
  if ! grep -Eq "$expected" "$tmp_body"; then
    echo "Expected $url body to match $expected" >&2
    cat "$tmp_body" >&2
    exit 1
  fi
}

check_mcp_unauthorized() {
  local url="$1"
  local expected_metadata="$2"
  local status
  status="$(
    curl "${curl_common[@]}" -sS -o "$tmp_body" -D "$tmp_headers" -w '%{http_code}' \
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

check_status 200 "$BASE_URL/api/healthz"
check_contains "$BASE_URL/api" '"version":"v1"'
# Preview deployments rewrite /api* to the fixed production Convex site, whose
# public metadata uses canonical prod URLs. Assert liveness against BASE_URL
# but assert metadata against the canonical origin in preview mode.
EXPECTED_BASE="$BASE_URL"
if [[ "$IS_PROD" != "true" ]]; then
  EXPECTED_BASE="https://teakvault.com"
fi
check_contains "$BASE_URL/api/v1" "\"endpoint\":\"$EXPECTED_BASE/mcp\""
check_contains "$BASE_URL/api/openapi.json" '"openapi":"3.1.0"'
check_mcp_unauthorized \
  "$BASE_URL/mcp" \
  "$EXPECTED_BASE/.well-known/oauth-protected-resource/mcp"
check_contains \
  "$BASE_URL/.well-known/oauth-protected-resource/mcp" \
  "\"resource\":\"$EXPECTED_BASE/mcp\""
check_status 200 "$BASE_URL/llms.txt"
check_matches \
  "$BASE_URL/.well-known/mcp.json" \
  "\"endpoint\"[[:space:]]*:[[:space:]]*\"$(printf '%s' "$EXPECTED_BASE" | sed 's/\./\\./g')/mcp\""

check_redirect() {
  local url="$1"
  local expected_location="$2"
  local result status location
  result="$(curl "${curl_common[@]}" -sS -o "$tmp_body" -w '%{http_code} %{redirect_url}' "$url")"
  status="${result%% *}"
  location="${result#* }"
  if [[ "$status" != "308" ]]; then
    echo "Expected 308 for $url, got $status" >&2
    cat "$tmp_body" >&2
    exit 1
  fi
  if [[ "$location" != "$expected_location" ]]; then
    echo "Expected Location $expected_location for $url, got $location" >&2
    exit 1
  fi
}

# The API lives at teakvault.com/api*; the legacy subdomain permanently redirects (308 keeps methods intact).
# Preview deployments have no api.* alias, so only check redirects in prod.
if [[ "$IS_PROD" == "true" ]]; then
  check_redirect "https://api.teakvault.com/" "https://teakvault.com/api/v1"
  check_redirect "https://api.teakvault.com/v1" "https://teakvault.com/api/v1"
  check_redirect "https://api.teakvault.com/healthz" "https://teakvault.com/api/healthz"
  check_redirect "https://api.teakvault.com/openapi.json" "https://teakvault.com/api/openapi.json"
  check_redirect "https://api.teakvault.com/mcp" "https://teakvault.com/mcp"
  check_redirect \
    "https://api.teakvault.com/.well-known/oauth-protected-resource/mcp" \
    "https://teakvault.com/.well-known/oauth-protected-resource/mcp"
fi
