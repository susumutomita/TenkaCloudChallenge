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

probe() {
  # $1 = slot, $2 = expected ("200" or "5xx")
  local slot="$1" expected="$2" code
  code=$(curl -s -o /dev/null -m 10 -w '%{http_code}' "$BASE_URL/$slot/meta" || echo "000")
  case "$expected" in
    200) [[ "$code" == "200" ]] ;;
    5xx) [[ "$code" =~ ^5 || "$code" == "000" ]] ;;
  esac
  local ok=$?
  if [[ $ok -eq 0 ]]; then
    echo "  OK   /$slot/meta → $code (expected $expected)"
  else
    echo "  FAIL /$slot/meta → $code (expected $expected)"
    FAILURES=$((FAILURES + 1))
  fi
}

run_fault() {
  # $1 = disruption id, $2 = stop command, $3 = start command, rest = slots
  local id="$1" stop_cmd="$2" start_cmd="$3"
  shift 3
  local slots=("$@")

  echo "=== $id ==="
  echo "  inject: $stop_cmd"
  ssm_shell "$stop_cmd" || { echo "  FAIL ssm send-command (inject)"; FAILURES=$((FAILURES + 1)); return; }
  sleep 5
  for slot in "${slots[@]}"; do probe "$slot" 5xx; done

  echo "  revert: $start_cmd"
  ssm_shell "$start_cmd" || { echo "  FAIL ssm send-command (revert)"; FAILURES=$((FAILURES + 1)); return; }
  sleep 5
  for slot in "${slots[@]}"; do probe "$slot" 200; done
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
