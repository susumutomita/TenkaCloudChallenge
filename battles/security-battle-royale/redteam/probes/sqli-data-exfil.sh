#!/usr/bin/env bash
# SQL injection — data exfil against /api/v1/auth.
# Uses UNION SELECT to coerce the auth query into returning rows from any
# table the DB user can read. The patched defender returns no rows / 4xx;
# the unpatched defender leaks structured data back through the response.
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
body=$(printf '%s\n' "$response" | sed '/^HTTP_STATUS:/d')

if [[ "$status" == "000" ]]; then
  echo "ERR sqli-data-exfil ${API_URL} (network)"
  exit 2
fi

# Heuristic: unpatched UNION exfil returns rows; patched returns nothing
# meaningful or 4xx.
if [[ "$status" == "200" && ${#body} -gt 20 && "$body" == *"username"* ]]; then
  echo "FAIL sqli-data-exfil ${API_URL} (rows returned, status=${status})"
  exit 1
fi

echo "OK   sqli-data-exfil ${API_URL} (patched, status=${status})"
