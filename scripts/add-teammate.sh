#!/usr/bin/env bash
# Create a teammate in the production 9router with one command.
#
# A teammate gets an API key restricted to the models/combos you name, plus a
# dashboard member whose password they type to sign in to Basic Chat. The key
# value never reaches them — the dashboard injects it server-side.
#
# Usage:
#   bash add-teammate.sh <ownerPassword> <name> <memberPassword> <model|combo> [budgetCents]
#
# Examples:
#   bash add-teammate.sh 'OWNER' andi 'andi-pass-123' 'Code-Freee' 500
#   bash add-teammate.sh 'OWNER' siti 'siti-pass-456' 'Code-Freee,Coding-Mantap' 2000
#
# budgetCents: monthly budget in cents (null = unlimited). Default 500 ($5).
set -euo pipefail
cd "$(dirname "$0")/.."

OWNER="$1"; NAME="$2"; MEMBER_PW="$3"; MODELS="$4"; BUDGET="${5:-500}"

if [ -z "$OWNER" ] || [ -z "$NAME" ] || [ -z "$MEMBER_PW" ] || [ -z "$MODELS" ]; then
  echo "Usage: bash add-teammate.sh <ownerPassword> <name> <memberPassword> <models> [budgetCents]"
  exit 2
fi

# Turn "Code-Freee,Coding-Mantap" into a JSON array.
ALLOW_JSON=$(python3 -c "
import json,sys
print(json.dumps([m.strip() for m in sys.argv[1].split(',') if m.strip()]))
" "$MODELS")

BUDGET_JSON=$(python3 -c "
import json,sys
v=sys.argv[1]
print('null' if v.lower() in ('null','unlimited','') else str(int(v)))
" "$BUDGET")

export NINEROUTER_URL="https://9router.aidonext.com"
export NINEROUTER_PASSWORD="$OWNER"

node scripts/seed-team-member.mjs \
  --url "$NINEROUTER_URL" \
  --password "$OWNER" \
  --member "{\"name\":\"$NAME\",\"password\":\"$MEMBER_PW\",\"allow\":$ALLOW_JSON,\"budgetCents\":$BUDGET_JSON,\"rpm\":0,\"tpm\":0}"
