#!/usr/bin/env bash
# Pre-event smoke test for StackStack's real-fault disruptions.
#
# Inputs:
#   $1 / $INSTANCE_ID — EC2 instance id (InstanceId stack output)
#   $2 / $BASE_URL    — app URL (AppUrlHint stack output)
#
# Requires operator-side credentials with ssm:SendCommand on the instance.

set -uo pipefail

INSTANCE_ID="${1:-${INSTANCE_ID:?INSTANCE_ID required}}"
BASE_URL="${2:-${BASE_URL:?BASE_URL required}}"
BASE_URL="${BASE_URL%/}"
FAILURES=0

ssm_shell() {
  local cmd="$1"
  local command_id
  command_id=$(aws ssm send-command \
    --instance-ids "$INSTANCE_ID" \
    --document-name AWS-RunShellScript \
    --parameters "commands=[\"$cmd\"]" \
    --query 'Command.CommandId' --output text) || return 1
  aws ssm wait command-executed --command-id "$command_id" --instance-id "$INSTANCE_ID" 2>/dev/null
}

http_code_until() {
  local path="$1" expected="$2" timeout="${3:-30}" code="000" deadline
  deadline=$((SECONDS + timeout))
  while ((SECONDS < deadline)); do
    code=$(curl -s -o /dev/null -m 10 -w '%{http_code}' "$BASE_URL$path" || echo "000")
    case "$expected" in
      200) [[ "$code" == "200" ]] && { echo "  OK   $path -> $code"; return 0; } ;;
      5xx) [[ "$code" =~ ^5 || "$code" == "000" ]] && { echo "  OK   $path -> $code"; return 0; } ;;
    esac
    sleep 2
  done
  echo "  FAIL $path -> $code (expected $expected)"
  FAILURES=$((FAILURES + 1))
  return 1
}

posture_until() {
  local key="$1" expected="$2" timeout="${3:-45}" value="" deadline
  deadline=$((SECONDS + timeout))
  while ((SECONDS < deadline)); do
    value=$(curl -s -m 10 "$BASE_URL/posture" | jq -r ".posture.$key // empty" 2>/dev/null || true)
    if [[ "$value" == "$expected" ]]; then
      echo "  OK   posture.$key -> $value"
      return 0
    fi
    sleep 2
  done
  echo "  FAIL posture.$key -> ${value:-<empty>} (expected $expected)"
  FAILURES=$((FAILURES + 1))
  return 1
}

run_pair() {
  local id="$1" inject="$2" revert="$3"
  echo "=== $id ==="
  echo "  inject: $inject"
  ssm_shell "$inject" || { echo "  FAIL ssm send-command (inject)"; FAILURES=$((FAILURES + 1)); return; }
  shift 3
  "$@"
  echo "  revert: $revert"
  ssm_shell "$revert" || { echo "  FAIL ssm send-command (revert)"; FAILURES=$((FAILURES + 1)); return; }
}

echo "=== stackstack red-team smoke test ==="
echo "  instance: $INSTANCE_ID"
echo "  base url: $BASE_URL"
echo

echo "=== baseline ==="
http_code_until /healthz 200
ssm_shell "/opt/tenkacloud/vibe/restore_database_from_s3.sh || true"
posture_until db_present true
ssm_shell "python3 /opt/tenkacloud/vibe/set_auth_required.py true >/tmp/stackstack-token.txt && systemctl restart tenkacloud-vibe"
posture_until auth_enabled true
echo

run_pair "ai-wipes-database" \
  "/opt/tenkacloud/vibe/wipe_database.sh || true" \
  "/opt/tenkacloud/vibe/restore_database_from_s3.sh || true" \
  posture_until db_present false
posture_until db_present true
echo

run_pair "auth-setting-removed" \
  "cp /etc/tenkacloud-vibe/config.json /etc/tenkacloud-vibe/config.json.redteam-auth.bak || true; python3 /opt/tenkacloud/vibe/set_auth_required.py false || true; systemctl restart tenkacloud-vibe || true" \
  "test -f /etc/tenkacloud-vibe/config.json.redteam-auth.bak && mv /etc/tenkacloud-vibe/config.json.redteam-auth.bak /etc/tenkacloud-vibe/config.json || true; systemctl restart tenkacloud-vibe || true" \
  posture_until auth_enabled false
posture_until auth_enabled true
echo

run_pair "vibe-app-stopped" \
  "systemctl stop tenkacloud-vibe || true" \
  "systemctl start tenkacloud-vibe || true" \
  http_code_until /healthz 5xx
http_code_until /healthz 200
echo

if [[ $FAILURES -gt 0 ]]; then
  echo "=== smoke test FAILED ($FAILURES check(s)) ==="
  exit 1
fi

echo "=== smoke test passed ==="
exit 0
