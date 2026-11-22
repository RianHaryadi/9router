#!/usr/bin/env bash
# Fuzz the dashboard API as a member.
#
# A member may:
#   - read the endpoints of the areas the owner granted,
#   - create and manage THEIR OWN combos and prompt templates.
# A member may NOT:
#   - write anything else (keys, providers, settings, the team, the router),
#   - read the owner's own objects in a writable way,
#   - touch another member's objects.
#
# Usage: bash fuzz-member-writes.sh <ownerPassword> <memberPassword>
set -euo pipefail
BASE="${BASE:-https://9router.aidonext.com}"
OWNER="$1"; MPW="$2"

login() {
  curl -s -i -X POST "$BASE/api/auth/login" -H 'Content-Type: application/json' \
    -d '{"password":"'"$1"'"}' | grep -i '^set-cookie:' | sed 's/.*auth_token=\([^;]*\).*/\1/' | tr -d '\r'
}

OC=$(login "$OWNER"); [ -z "$OC" ] && { echo "owner login failed"; exit 1; }
MC=$(login "$MPW");   [ -z "$MC" ] && { echo "member login failed"; exit 1; }
AUTH="Cookie: auth_token=$MC"
OAUTH="Cookie: auth_token=$OC"

FAIL=0
code() { curl -s -o /dev/null -w '%{http_code}' -X "$1" "$BASE$2" -H "$AUTH" -H 'Content-Type: application/json' -d "${3:-{\}}"; }

# must_refuse <label> <method> <path> [body]
must_refuse() {
  local label="$1" method="$2" path="$3" body="${4:-{\}}"
  local c; c=$(code "$method" "$path" "$body")
  if [ "$c" = "403" ] || [ "$c" = "401" ]; then echo "  ok   $label -> $c"
  else echo "  FAIL $label -> $c   (must be 403/401)"; FAIL=1; fi
}

echo "=== member identity:"
curl -s "$BASE/api/auth/status" -H "$AUTH" | python3 -c "import sys,json;d=json.load(sys.stdin);print('  role:',d.get('role'),'| user:',d.get('username'),'| areas:',d.get('areas'))" || true

echo
echo "=== member must NOT write the owner's objects:"
must_refuse "POST   /api/keys"                  POST   /api/keys                  '{"name":"x"}'
must_refuse "POST   /api/providers"             POST   /api/providers             '{"name":"x"}'
must_refuse "PATCH  /api/settings"             PATCH  /api/settings              '{"foo":"bar"}'
must_refuse "POST   /api/team/members"         POST   /api/team/members          '{"name":"x","password":"abcd"}'
must_refuse "DELETE /api/team/members"         DELETE "/api/team/members?id=x"   '{}'
must_refuse "POST   /api/models/custom"        POST   /api/models/custom         '{"providerAlias":"x","id":"y"}'
must_refuse "PUT    /api/models/alias"         PUT    /api/models/alias          '{"model":"x","alias":"y"}'
must_refuse "POST   /api/combos/presets"       POST   /api/combos/presets        '{"source":"cursor"}'
must_refuse "POST   /api/version/shutdown"     POST   /api/version/shutdown      '{}'
must_refuse "POST   /api/tunnel/enable"        POST   /api/tunnel/enable         '{}'
must_refuse "POST   /api/tunnel/disable"       POST   /api/tunnel/disable        '{}'
must_refuse "POST   /api/usage/request-details" POST /api/usage/request-details '{}'

echo
echo "=== member must NOT read owner-only:"
for p in /api/settings /api/keys /api/team/members; do
  c=$(curl -s -o /dev/null -w '%{http_code}' "$BASE$p" -H "$AUTH")
  if [ "$c" = "403" ] || [ "$c" = "401" ]; then echo "  ok   GET $p -> $c"; else echo "  FAIL GET $p -> $c   (must be 403/401)"; FAIL=1; fi
done

echo
echo "=== the router must stay up (owner still in control):"
c=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/health" -H "$OAUTH")
if [ "$c" = "200" ]; then echo "  ok   owner GET /api/health -> $c"; else echo "  FAIL owner GET /api/health -> $c"; FAIL=1; fi

echo
if [ "$FAIL" = "0" ]; then echo "RESULT: all member writes and owner reads refused"; else echo "RESULT: FAILURES ABOVE"; exit 1; fi
