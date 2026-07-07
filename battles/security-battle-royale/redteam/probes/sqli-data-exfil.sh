#!/usr/bin/env bash
# SQL injection — auth bypass via UNION payload against /api/v1/auth.
# A UNION SELECT payload coerces the auth query into matching a row. This is
# NOT a real data-exfil path: /api/v1/auth only returns a JSON bool, so the
# verdict is the HTTP status — an unpatched (injectable) box answers 200 (the
# injection matched); a patched (parameterized) box answers 403. Gate on status.
#
# Inputs:
#   $1 or $API_URL   — base API URL, e.g. http://<host>:8080
#
# Output one line:
#   OK    — patched (no exfil)
#   FAIL  — exfil succeeded (defender hasn't patched)
#   ERR   — request failed

set -euo pipefail

API_URL="${1:-${API_URL:?API_URL required}}"

payload=$'{"username":"x\\\' UNION SELECT username FROM username -- ","password":"x"}'

response=$(
  curl --silent --show-error --max-time 5 \
    -X POST "${API_URL}/api/v1/auth" \
    -H "Content-Type: application/json" \
    -d "$payload" \
    -w '\nHTTP_STATUS:%{http_code}\n' \
  || echo "HTTP_STATUS:000"
)

status=$(printf '%s\n' "$response" | sed -n 's/^HTTP_STATUS://p' | tail -n1)

if [[ "$status" == "000" ]]; then
  echo "ERR sqli-data-exfil ${API_URL} (network)"
  exit 2
fi

# 200 = the UNION injection matched a row (vulnerable); 403 (or any non-200) =
# parameterized (patched). Mirrors scoring.attackProbes vulnerableStatus:[200];
# the body is only true/false, so the status is the signal.
if [[ "$status" == "200" ]]; then
  echo "FAIL sqli-data-exfil ${API_URL} (SQLi succeeded, status=${status})"
  exit 1
fi

echo "OK   sqli-data-exfil ${API_URL} (patched, status=${status})"
