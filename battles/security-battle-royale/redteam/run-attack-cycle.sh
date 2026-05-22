#!/usr/bin/env bash
# Single attack cycle against one team's deployed stack.
# Operator-side attacker (= platform Lambda / Fargate running under the
# operator AWS account) invokes this. Each probe in `probes/` runs once
# and prints a single OK / FAIL / ERR line.
#
# Inputs:
#   $1 / $FRONTEND_URL   — http://<host>:80
#   $2 / $API_URL        — http://<host>:8080
#
# Exit code: 0 always (= the operator-attacker keeps running across
# subsequent cycles regardless of per-probe outcome).

set -uo pipefail

FRONTEND_URL="${1:-${FRONTEND_URL:?FRONTEND_URL required}}"
API_URL="${2:-${API_URL:?API_URL required}}"

cd "$(dirname "$0")"

echo "=== security-battle-royale attack cycle ==="
echo "  frontend: ${FRONTEND_URL}"
echo "  api:      ${API_URL}"
echo

bash probes/sqli-auth-bypass.sh "$API_URL" || true
bash probes/sqli-data-exfil.sh "$API_URL" || true
bash probes/availability-flood.sh "$FRONTEND_URL" "$API_URL" || true

echo
echo "=== cycle complete ==="
exit 0
