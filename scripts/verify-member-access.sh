#!/usr/bin/env bash
# Verify a member's area access against the running instance.
# Usage: bash verify.sh <ownerPassword> <memberPassword>
set -euo pipefail
BASE="https://9router.aidonext.com"
OWNER="$1"; MPW="$2"

OC=$(curl -s -i -X POST "$BASE/api/auth/login" -H 'Content-Type: application/json' \
  -d '{"password":"'"$OWNER"'"}' | grep -i '^set-cookie:' | sed 's/.*auth_token=\([^;]*\).*/\1/' | tr -d '\r')
[ -z "$OC" ] && { echo "owner login failed"; exit 1; }
MC=$(curl -s -i -X POST "$BASE/api/auth/login" -H 'Content-Type: application/json' \
  -d '{"password":"'"$MPW"'"}' | grep -i '^set-cookie:' | sed 's/.*auth_token=\([^;]*\).*/\1/' | tr -d '\r')
[ -z "$MC" ] && { echo "member login failed"; exit 1; }
AUTH="Cookie: auth_token=$MC"

echo "=== member identity + areas:"
curl -s "$BASE/api/auth/status" -H "$AUTH" | python3 -c "import sys,json;d=json.load(sys.stdin);print('  role:',d.get('role'),'| user:',d.get('username'),'| areas:',d.get('areas'))"

echo
echo "=== model picker (must NOT be empty):"
curl -s "$BASE/api/combos" -H "$AUTH" | python3 -c "import sys,json;d=json.load(sys.stdin);c=d.get('combos',[]);print('  combos:',len(c),[x.get('name') for x in c][:6])"
curl -s "$BASE/api/providers" -H "$AUTH" | python3 -c "import sys,json;d=json.load(sys.stdin);c=d.get('connections',[]);print('  providers:',len(c),[x.get('name') for x in c][:6])"

echo
echo "=== API gates:"
for p in /api/settings /api/keys /api/team/members /api/usage/stats /api/combos /api/prompt-templates /api/health/matrix; do
  echo "  $p -> $(curl -s -o /dev/null -w '%{http_code}' "$BASE$p" -H "$AUTH")"
done

echo
echo "=== the member's own objects (must be writable when the area is held):"
MCID=$(curl -s -X POST "$BASE/api/combos" -H "$AUTH" -H 'Content-Type: application/json' \
  -d '{"name":"zz-verify-combo","models":[]}' | python3 -c "import sys,json;print(json.load(sys.stdin).get('id',''))" 2>/dev/null)
echo "  POST /api/combos -> ${MCID:-failed}"
if [ -n "$MCID" ]; then
  echo "  PUT own combo    -> $(curl -s -o /dev/null -w '%{http_code}' -X PUT "$BASE/api/combos/$MCID" -H "$AUTH" -H 'Content-Type: application/json' -d '{"name":"zz-verify-combo-2","models":[]}')"
  echo "  DELETE own combo -> $(curl -s -o /dev/null -w '%{http_code}' -X DELETE "$BASE/api/combos/$MCID" -H "$AUTH")"
fi

echo
echo "=== pages:"
for p in /dashboard/basic-chat /dashboard/usage /dashboard/combos /dashboard/prompts /dashboard/providers /dashboard/endpoint /dashboard/health; do
  echo "  $p -> $(curl -s -o /dev/null -w '%{http_code}' "$BASE$p" -H "$AUTH")"
done

echo
echo "=== owner can still read settings + matrix:"
echo "  owner /api/settings -> $(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/settings" -H "Cookie: auth_token=$OC")"
echo "  owner /api/health/matrix -> $(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/health/matrix" -H "Cookie: auth_token=$OC")"
echo "  anon  /api/health -> $(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/health")"
echo "  anon  /api/health/matrix -> $(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/health/matrix")"
