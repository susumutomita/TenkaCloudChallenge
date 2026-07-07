#!/usr/bin/env bash
# Availability stress — short burst against frontend + api endpoints.
# Single Flask process under nginx; sustained traffic saturates the worker
# pool and the scored endpoints (`/` and `/api/v1/apistatus`) drop below 200.
# The defender's uptime-multi score stops accruing while saturation lasts;
# rate limiting / horizontal scaling is the defender's path to mitigate.
#
# Deliberately tiny scale (= ~600 reqs total over 30s) so it can't be used
# as an actual DoS. Run only against stacks you operate.
#
# Inputs:
#   $1 / $FRONTEND_URL
#   $2 / $API_URL
#
# Output one line per endpoint:
#   OK    — endpoint stayed up under the burst (no 5xx)
#   FAIL  — endpoint dropped (some 5xx returned)
#   ERR   — request failed

set -euo pipefail

FRONTEND_URL="${1:-${FRONTEND_URL:?FRONTEND_URL required}}"
API_URL="${2:-${API_URL:?API_URL required}}"

burst() {
  local target="$1"
  local label="$2"
  local fail_count=0
  local err_count=0
  local total=300

  for _ in $(seq 1 $total); do
    code=$(
      curl --silent --output /dev/null --max-time 2 \
        --write-out '%{http_code}' "$target" \
      || echo "000"
    )
    if [[ "$code" == "000" ]]; then
      err_count=$((err_count + 1))
    elif [[ "$code" =~ ^5 ]]; then
      fail_count=$((fail_count + 1))
    fi
  done &

  wait

  if [[ $err_count -gt 30 ]]; then
    echo "ERR  availability-flood ${label} ${target} (network errors=${err_count}/${total})"
    return 2
  fi
  if [[ $fail_count -gt 10 ]]; then
    echo "FAIL availability-flood ${label} ${target} (5xx=${fail_count}/${total})"
    return 1
  fi
  echo "OK   availability-flood ${label} ${target} (no saturation, ${total} reqs)"
}

burst "$FRONTEND_URL" frontend || true
burst "${API_URL}/api/v1/apistatus" api || true
