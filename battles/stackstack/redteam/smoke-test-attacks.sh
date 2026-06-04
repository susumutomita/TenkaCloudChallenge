#!/usr/bin/env bash
# Pre-event smoke test for stackstack's two real-fault disruptions.
# Replays the metadata.json `action` / `revert` command pairs directly via
# aws ssm send-command (= bypassing the platform executor) against a
# throwaway team stack, and confirms the probe-visible behavior:
#
#   env-credential-leak   stop tenkacloud-slot-auth            → /auth/meta 5xx → restart → 200
#   ai-committed-secret   stop tenkacloud-slot-{network,audit} → both 5xx      → restart → 200
#
# Inputs:
#   $1 / $INSTANCE_ID — EC2 instance id (InstanceId stack output)
#   $2 / $BASE_URL    — reverse-proxy base URL (BaseUrl stack output)
#
# Requires operator-side credentials with ssm:SendCommand on the instance
# (same permission the platform's disruption executor uses).
#
# Exit code: 0 if every fault both broke and recovered as declared; 1 otherwise.

set -uo pipefail

INSTANCE_ID="${1:-${INSTANCE_ID:?INSTANCE_ID required}}"
BASE_URL="${2:-${BASE_URL:?BASE_URL required}}"
BASE_URL="${BASE_URL%/}"

FAILURES=0

ssm_shell() {
  # Run a shell command on the instance and wait for it to land.
  local cmd="$1"
  local command_id
  command_id=$(aws ssm send-command \
    --instance-ids "$INSTANCE_ID" \
    --document-name AWS-RunShellScript \
    --parameters "commands=[\"$cmd\"]" \
    --query 'Command.CommandId' --output text) || return 1
  aws ssm wait command-executed --command-id "$command_id" --instance-id "$INSTANCE_ID" 2>/dev/null
}

probe_until() {
  # Poll /<slot>/meta until it returns the expected status class or the
  # deadline passes (= bounded retry; a fixed sleep is flaky under load).
  # $1 = slot, $2 = expected ("200" or "5xx"), $3 = timeout seconds (default 30)
  local slot="$1" expected="$2" timeout="${3:-30}" code="000" deadline
  deadline=$((SECONDS + timeout))
  while ((SECONDS < deadline)); do
    code=$(curl -s -o /dev/null -m 10 -w '%{http_code}' "$BASE_URL/$slot/meta" || echo "000")
    case "$expected" in
      200) [[ "$code" == "200" ]] && { echo "  OK   /$slot/meta → $code (expected $expected)"; return 0; } ;;
      5xx) [[ "$code" =~ ^5 || "$code" == "000" ]] && { echo "  OK   /$slot/meta → $code (expected $expected)"; return 0; } ;;
    esac
    sleep 2
  done
  echo "  FAIL /$slot/meta → $code (expected $expected, waited ${timeout}s)"
  FAILURES=$((FAILURES + 1))
  return 1
}

run_fault() {
  # $1 = disruption id, $2 = stop command, $3 = start command, rest = slots
  local id="$1" stop_cmd="$2" start_cmd="$3"
  shift 3
  local slots=("$@")

  echo "=== $id ==="
  echo "  inject: $stop_cmd"
  ssm_shell "$stop_cmd" || { echo "  FAIL ssm send-command (inject)"; FAILURES=$((FAILURES + 1)); return; }
  for slot in "${slots[@]}"; do probe_until "$slot" 5xx; done

  echo "  revert: $start_cmd"
  ssm_shell "$start_cmd" || { echo "  FAIL ssm send-command (revert)"; FAILURES=$((FAILURES + 1)); return; }
  for slot in "${slots[@]}"; do probe_until "$slot" 200; done
  echo
}

echo "=== stackstack red-team smoke test ==="
echo "  instance: ${INSTANCE_ID}"
echo "  base url: ${BASE_URL}"
echo

# Keep these command strings in sync with metadata.json disruptions[].action.
run_fault "env-credential-leak" \
  "systemctl stop tenkacloud-slot-auth || true" \
  "systemctl start tenkacloud-slot-auth || true" \
  auth

run_fault "ai-committed-secret" \
  "systemctl stop tenkacloud-slot-network tenkacloud-slot-audit || true" \
  "systemctl start tenkacloud-slot-network tenkacloud-slot-audit || true" \
  network audit

if [[ $FAILURES -gt 0 ]]; then
  echo "=== smoke test FAILED ($FAILURES check(s)) ==="
  exit 1
fi
echo "=== smoke test passed ==="
exit 0
