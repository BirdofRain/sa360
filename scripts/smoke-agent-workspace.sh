#!/usr/bin/env bash
# Read-only (default) smoke tests: API health, guidance, admin-coc /agent-workspace, CSP headers.
# Optional mutating lifecycle POST when ALLOW_MUTATING_SMOKE_TESTS=true and SA360_WEBHOOK_SECRET set.
#
# Required env: SA360_API_BASE_URL, SA360_ADMIN_COC_BASE_URL, SA360_WORKSPACE_KEY,
#               SA360_CLIENT_ACCOUNT_ID, SA360_GHL_LOCATION_ID
#
# Secrets are never printed. Exits 1 if any required check fails.

set -u

failures=0
skips=0

pass() { echo "[PASS] $*"; }
fail() { echo "[FAIL] $*"; failures=$((failures + 1)); }
skip() { echo "[SKIP] $*"; skips=$((skips + 1)); }
warn() { echo "[WARN] $*"; }

require_env() {
  local n="$1"
  if [ -z "${!n:-}" ]; then
    echo "[FAIL] missing required env: $n"
    exit 1
  fi
}

trim_slash() {
  local x="${1:-}"
  x="${x%/}"
  echo "$x"
}

require_env SA360_API_BASE_URL
require_env SA360_ADMIN_COC_BASE_URL
require_env SA360_WORKSPACE_KEY
require_env SA360_CLIENT_ACCOUNT_ID
require_env SA360_GHL_LOCATION_ID

API_BASE="$(trim_slash "$SA360_API_BASE_URL")"
COC_BASE="$(trim_slash "$SA360_ADMIN_COC_BASE_URL")"
NICHE="${SA360_NICHE_KEY:-FEX}"
STAGE="${SA360_LIFECYCLE_STAGE:-ATTEMPTING_CONTACT}"
PROTECTED="${SA360_PROTECTED_ROUTE:-/clients}"
case "$PROTECTED" in
  /*) ;;
  *) PROTECTED="/$PROTECTED" ;;
esac

MUT_RAW="${ALLOW_MUTATING_SMOKE_TESTS:-false}"
MUT=false
case "$MUT_RAW" in
  1|[Tt]rue|[Yy]es|[Oo]n) MUT=true ;;
esac

echo ""
echo "SA360 Agent Workspace smoke (bash; secrets redacted)"
echo "  API base:    $API_BASE"
echo "  admin-coc:   $COC_BASE"
echo "  client:      $SA360_CLIENT_ACCOUNT_ID"
echo "  location:    $SA360_GHL_LOCATION_ID"
echo "  niche/stage: $NICHE / $STAGE"
echo "  mutating:    $MUT"
echo ""

# --- A) Health ---
for path in /health /health/db /health/queue; do
  tmp="$(mktemp)"
  code=$(curl -sS -o "$tmp" -w "%{http_code}" "$API_BASE$path" || echo "000")
  if [ "$code" != "200" ]; then
    fail "api:$path HTTP $code"
    rm -f "$tmp"
    continue
  fi
  if ! grep -q '"ok"[[:space:]]*:[[:space:]]*true' "$tmp"; then
    fail "api:$path JSON ok!=true"
    rm -f "$tmp"
    continue
  fi
  if [ "$path" = "/health/db" ] && ! grep -q '"db"[[:space:]]*:[[:space:]]*"connected"' "$tmp"; then
    fail "api:$path db not connected"
    rm -f "$tmp"
    continue
  fi
  if [ "$path" = "/health/queue" ] && ! grep -q '"queue"[[:space:]]*:[[:space:]]*"PONG"' "$tmp"; then
    fail "api:$path queue not PONG"
    rm -f "$tmp"
    continue
  fi
  pass "api:$path HTTP 200 ok=true"
  rm -f "$tmp"
done

# --- B) Guidance ---
tmp="$(mktemp)"
code=$(
  curl -sS -o "$tmp" -w "%{http_code}" -G "$API_BASE/agent-workspace/v1/guidance" \
    -H "x-sa360-workspace-key: ${SA360_WORKSPACE_KEY}" \
    --data-urlencode "clientAccountId=${SA360_CLIENT_ACCOUNT_ID}" \
    --data-urlencode "locationId=${SA360_GHL_LOCATION_ID}" \
    --data-urlencode "nicheKey=${NICHE}" \
    --data-urlencode "lifecycleStage=${STAGE}" || echo "000"
)
if [ "$code" = "401" ]; then
  fail "api:guidance HTTP 401 (workspace key mismatch)"
elif [ "$code" = "503" ]; then
  fail "api:guidance HTTP 503 (workspace key not configured on API)"
elif [ "$code" != "200" ]; then
  fail "api:guidance HTTP $code"
elif ! grep -q '"ok"[[:space:]]*:[[:space:]]*true' "$tmp"; then
  fail "api:guidance ok is not true"
elif ! grep -q '"scripts"' "$tmp"; then
  fail "api:guidance scripts key missing"
elif ! grep -q '"objectionPlaybooks"' "$tmp"; then
  fail "api:guidance objectionPlaybooks key missing"
else
  pass "api:guidance HTTP 200 scripts+objectionPlaybooks present"
fi
rm -f "$tmp"

# --- C) /agent-workspace (no redirect to login) ---
hdr_ws="$(mktemp)"
code=$(curl -sS --max-redirs 0 -o /tmp/sa360-smoke-ws.html -w "%{http_code}" -D "$hdr_ws" -G "${COC_BASE}/agent-workspace" \
  --data-urlencode "locationId=${SA360_GHL_LOCATION_ID}" \
  --data-urlencode "clientAccountId=${SA360_CLIENT_ACCOUNT_ID}" || echo "000")
loc="$(grep -i '^[Ll]ocation:' "$hdr_ws" 2>/dev/null | head -1 | cut -d: -f2- | tr -d '\r' | xargs || true)"
rm -f "$hdr_ws"
if echo "$code" | grep -q '^3' && echo "$loc" | grep -qi login; then
  fail "coc:agent-workspace redirect to login (HTTP $code)"
elif [ "$code" != "200" ]; then
  fail "coc:agent-workspace HTTP $code"
else
  pass "coc:agent-workspace HTTP 200 not redirected to login"
fi

# --- D1) CSP on /agent-workspace ---
hdr_tmp="$(mktemp)"
curl -sS --max-redirs 0 -D "$hdr_tmp" -o /dev/null -G "${COC_BASE}/agent-workspace" \
  --data-urlencode "locationId=${SA360_GHL_LOCATION_ID}" \
  --data-urlencode "clientAccountId=${SA360_CLIENT_ACCOUNT_ID}" || true
csp="$(grep -i '^content-security-policy:' "$hdr_tmp" | head -1 | cut -d: -f2- | tr -d '\r' | xargs || true)"
xfo="$(grep -i '^x-frame-options:' "$hdr_tmp" | head -1 | cut -d: -f2- | tr -d '\r' | xargs || true)"
rm -f "$hdr_tmp"
if [ -z "$csp" ]; then
  fail "csp:agent-workspace Content-Security-Policy header missing"
elif ! echo "$csp" | grep -qi 'frame-ancestors'; then
  fail "csp:agent-workspace CSP missing frame-ancestors"
else
  if [ -n "${EXPECTED_FRAME_ANCESTORS:-}" ]; then
    ok=true
    for tok in $EXPECTED_FRAME_ANCESTORS; do
      if ! echo "$csp" | grep -qF "$tok"; then ok=false; break; fi
    done
    if [ "$ok" = true ]; then
      pass "csp:agent-workspace-frame-ancestors EXPECTED tokens present"
    else
      fail "csp:agent-workspace-frame-ancestors missing EXPECTED_FRAME_ANCESTORS token(s)"
    fi
  else
    if ! echo "$csp" | grep -qE 'app\.gohighlevel\.com|app\.leadconnectorhq\.com'; then
      warn "csp:agent-workspace default GHL/LC hosts not found; set EXPECTED_FRAME_ANCESTORS for white-label"
    fi
    pass "csp:agent-workspace frame-ancestors present"
  fi
fi
if [ -n "$xfo" ]; then
  xf="$(echo "$xfo" | tr '[:upper:]' '[:lower:]')"
  if [ "$xf" = "deny" ] || [ "$xf" = "sameorigin" ]; then
    fail "csp:x-frame-options X-Frame-Options=$xfo blocks typical GHL iframes"
  else
    warn "csp:x-frame-options X-Frame-Options=$xfo present"
  fi
else
  pass "csp:x-frame-options not set (OK for iframe)"
fi

# --- D2) API proxy CSP ---
hdr_tmp="$(mktemp)"
if curl -sS --max-redirs 0 -D "$hdr_tmp" -o /dev/null -G "${COC_BASE}/api/agent-workspace/context" \
  --data-urlencode "locationId=${SA360_GHL_LOCATION_ID}" \
  --data-urlencode "clientAccountId=${SA360_CLIENT_ACCOUNT_ID}"; then
  csp2="$(grep -i '^content-security-policy:' "$hdr_tmp" | head -1 | cut -d: -f2- | tr -d '\r' | xargs || true)"
  if [ -n "$csp2" ] && echo "$csp2" | grep -qi 'frame-ancestors'; then
    fail "csp:api-proxy-context unexpected frame-ancestors in CSP"
  else
    pass "csp:api-proxy-context no frame-ancestors in CSP"
  fi
else
  warn "csp:api-proxy-context could not fetch; skipping CSP check"
fi
rm -f "$hdr_tmp"

# --- D3) Protected route ---
hdr_pr="$(mktemp)"
code=$(curl -sS --max-redirs 0 -o /dev/null -w "%{http_code}" -D "$hdr_pr" "${COC_BASE}${PROTECTED}" || echo "000")
loc="$(grep -i '^[Ll]ocation:' "$hdr_pr" 2>/dev/null | head -1 | cut -d: -f2- | tr -d '\r' | xargs || true)"
rm -f "$hdr_pr"
if echo "$code" | grep -q '^3' && echo "$loc" | grep -qi login; then
  pass "coc:protected-route HTTP $code redirect to login"
elif [ "$code" = "401" ]; then
  pass "coc:protected-route HTTP 401"
elif [ "$code" = "200" ]; then
  warn "coc:protected-route HTTP 200 without redirect — confirm not unauthenticated dashboard"
else
  warn "coc:protected-route HTTP $code"
fi

# --- E) Optional lifecycle webhook ---
if [ "$MUT" != true ]; then
  skip "mutate:lifecycle-webhook ALLOW_MUTATING_SMOKE_TESTS is not true"
elif [ -z "${SA360_WEBHOOK_SECRET:-}" ]; then
  skip "mutate:lifecycle-webhook SA360_WEBHOOK_SECRET missing"
else
  ev="$(node -e "process.stdout.write(require('crypto').randomUUID())" 2>/dev/null || echo "smoke-$(date +%s)-$RANDOM$RANDOM")"
  ts="$(date +%s)"
  lead="smoke-agent-workspace-${ts}-$(echo "$ev" | tr -d '-' | cut -c1-16)"
  payload="$(printf '%s' "{\"schema_version\":\"1\",\"client_account_id\":\"%s\",\"contact\":{\"lead_uid\":\"%s\"},\"attribution\":{},\"state\":{\"lifecycle_stage\":\"%s\"},\"event\":{\"event_uuid\":\"%s\",\"event_name_internal\":\"lead_created\",\"event_name_meta\":\"Lead\",\"event_time_unix\":%s,\"send_to_meta\":false}}" \
    "$SA360_CLIENT_ACCOUNT_ID" "$lead" "$STAGE" "$ev" "$ts")"
  code=$(curl -sS -o /tmp/sa360-smoke-lc.json -w "%{http_code}" \
    -X POST "$API_BASE/webhooks/ghl/lifecycle-event" \
    -H "Content-Type: application/json" \
    -H "x-sa360-secret: ${SA360_WEBHOOK_SECRET}" \
    -d "$payload" || echo "000")
  if echo "$code" | grep -q '^2'; then
    pass "mutate:lifecycle-webhook HTTP $code send_to_meta=false lead_uid=$lead"
  else
    fail "mutate:lifecycle-webhook HTTP $code"
  fi
fi

echo ""
echo "Summary: failures=$failures skips=$skips"
if [ "$failures" -gt 0 ]; then
  exit 1
fi
exit 0
