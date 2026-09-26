#!/bin/bash
set -euo pipefail
umask 077
PACKAGE_ROOT=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)
backend=${1:-docker}
[[ $backend == docker || $backend == namespace ]] || exit 64
source "$PACKAGE_ROOT/host/score.sh"
TEST_TEMP=$(mktemp -d "${TMPDIR:-/tmp}/nightshift-tests.XXXXXXXX")
STATE_ROOT="$TEST_TEMP/state"
TEAM="test-$$"
TEAM_DIR="$STATE_ROOT/$TEAM"
CONTAINER="nightshift-$TEAM"
IMAGE=nightshift-bash:0.1.0
mkdir -p "$TEAM_DIR"
cleanup() {
    if [[ $backend == docker ]] && command -v docker >/dev/null 2>&1; then
        if [[ -f $TEAM_DIR/session ]] && verify_container >/dev/null 2>&1; then
            docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
        fi
    fi
    [[ $TEST_TEMP == */nightshift-tests.* ]] && rm -rf -- "$TEST_TEMP"
}
trap cleanup EXIT
if [[ $backend == docker ]]; then
    source "$PACKAGE_ROOT/lib/docker.sh"
    require_docker
    build_image
    NIGHTSHIFT_INTERVAL=0 start_container
else
    [[ $EUID -eq 0 ]] || { echo 'namespace backend requires Linux root and unshare user mappings.' >&2; exit 1; }
    ROOTFS="$TEST_TEMP/rootfs"
    mkdir "$ROOTFS"
    bash "$PACKAGE_ROOT/tests/build-rootfs.sh" "$PACKAGE_ROOT" "$ROOTFS"
    lab_exec() { bash "$PACKAGE_ROOT/tests/namespace-exec.sh" "$ROOTFS" "$@"; }
    session=$(random_hex); key=$(random_hex); proof=$(random_hex)
    printf '%s\n' "$session" > "$TEAM_DIR/session"
    printf '%s\n' "$key" > "$TEAM_DIR/settlement-key"
    printf '%s\n' "$proof" > "$TEAM_DIR/proof-token"
    printf 'audit\n' > "$TEAM_DIR/phase"
    printf '%s\n%s\n%s\n' "$session" "$key" "$proof" | lab_exec 0 /bin/bash /opt/nightshift/control.sh init >/dev/null
fi
passed=0
pass() { passed=$((passed + 1)); printf 'ok %02d - %s\n' "$passed" "$1"; }
fail() { printf 'not ok - %s\n' "$1" >&2; exit 1; }
assert_contains() { [[ $1 == *"$2"* ]] || { printf 'actual: %s\n' "$1" >&2; fail "$3"; }; pass "$3"; }
assert_denied() { local title=$1; shift; if "$@" >/dev/null 2>&1; then fail "$title"; else pass "$title"; fi; }
grade() { SCORE_FORMAT=json; RESULT=$(collect_score); }
reference_repair() { lab_exec 1200 /bin/bash -s < "$PACKAGE_ROOT/tests/reference-repair.sh"; }

printf '# Nightshift integration / backend=%s\n' "$backend"
english=$(lab_exec 1100 /usr/bin/cat /srv/nightshift/START-HERE.en.md)
assert_contains "$english" 'Start with `id`' 'English participant introduction is readable in the container'
for mission in 1 2 3; do
    for step in 1 2 3; do
        hint=$(bash "$PACKAGE_ROOT/gameday.sh" hint "$mission" "$step" en)
        assert_contains "$hint" "# $mission / Hint $step" "English mission $mission hint $step is available through CLI"
    done
done
assert_denied 'hint locale cannot escape the participant directory' bash "$PACKAGE_ROOT/gameday.sh" hint 1 1 ../../host/score

assert_denied 'auditor cannot read batch-only proof token' lab_exec 1100 /usr/bin/cat /srv/nightshift/service/proof-token
assert_denied 'operator is not root and cannot read batch-only token' lab_exec 1200 /usr/bin/cat /srv/nightshift/service/proof-token
assert_denied 'auditor cannot modify the trusted runtime' lab_exec 1100 /bin/bash -c 'echo tampered >> /opt/nightshift/lib.sh'
assert_denied 'operator cannot modify the trusted runtime' lab_exec 1200 /bin/bash -c 'echo tampered >> /opt/nightshift/lib.sh'
assert_denied 'grader is absent from the participant image' lab_exec 1100 /usr/bin/test -e /opt/nightshift/host/check-state.sh
grade
assert_contains "$RESULT" '"score":0,' 'new deployment earns no points'

assert_denied 'live environment cannot be initialized twice' lab_exec 0 /bin/bash /opt/nightshift/control.sh init
lab_exec 1100 /usr/bin/ln -s /run/nightshift/session /srv/nightshift/submissions/leak.txt
record_evidence >/dev/null
grade
assert_contains "$RESULT" '"score":0,' 'submission symlink does not grant supervisor-read authority'
lab_exec 1100 /usr/bin/rm /srv/nightshift/submissions/leak.txt
lab_exec 1100 /bin/bash -s < "$PACKAGE_ROOT/tests/reference-discover.sh"
lab_exec 0 /bin/bash /opt/nightshift/control.sh live
record_evidence >/dev/null
grade
assert_contains "$RESULT" '"discovery":300,' 'all three real discoveries score 300'
record_evidence >/dev/null
grade
assert_contains "$RESULT" '"score":300,' 'repeated evidence submission is idempotent'
printf 'repair\n' > "$TEAM_DIR/phase"
assert_denied 'discovery submissions freeze when repair begins' record_evidence
original=$(lab_exec 1100 /usr/bin/sha256sum /srv/nightshift/vendor/bin/render-receipt)
grade
assert_contains "$RESULT" '"score":600,' 'vulnerable but working service earns no repair points'
after=$(lab_exec 1100 /usr/bin/sha256sum /srv/nightshift/vendor/bin/render-receipt)
[[ $after == "$original" ]] || fail 'permission checks preserve participant executable'
pass 'permission checks preserve participant executable byte-for-byte'
lab_exec 1200 /bin/bash -s <<'PARTIAL'
set -euo pipefail
chmod 0640 /srv/nightshift/backup/settlement.key
printf 'export PATH=/srv/nightshift/app/bin:/usr/bin:/bin\n' > /srv/nightshift/app/config/runtime.env
PARTIAL
grade
assert_contains "$RESULT" '"backupBeforeRestart":1,"pathBeforeRestart":1' 'temporary repair works before restart'
assert_contains "$RESULT" '"backupProtected":0,"pathProtected":0' 'startup regression is detected after restart'
reference_repair
grade
assert_contains "$RESULT" '"score":1000,' 'reference repair reaches 1000 with real receipts'
assert_contains "$RESULT" '"durable":1,"validOrders":1,"deduplication":1,"invalidRejected":1' 'restart, free items, decimal padding, duplicates and malformed orders pass'
grade
assert_contains "$RESULT" '"score":1000,' 'repeated scoring stays at 1000'
assert_denied 'repaired key is unreadable by auditor' lab_exec 1100 /usr/bin/cat /srv/nightshift/backup/settlement.key
assert_denied 'repaired vendor directory is not writable by auditor' lab_exec 1100 /bin/bash -c 'echo bad > /srv/nightshift/vendor/bin/render-receipt'
lab_exec 1200 /usr/bin/chmod 000 /srv/nightshift/backup/settlement.key
grade
assert_contains "$RESULT" '"repair":0,"service":0' 'chmod 000 is rejected because business processing fails'
lab_exec 1200 /usr/bin/chmod 0640 /srv/nightshift/backup/settlement.key
read_state "$TEAM_DIR/settlement-key"; good_key=$REPLY
printf '00000000000000000000000000000000\n' | lab_exec 1200 /bin/bash -c 'cat > /srv/nightshift/backup/settlement.key'
grade
assert_contains "$RESULT" '"repair":0,"service":0' 'a replaced key cannot forge expected receipts'
printf '%s\n' "$good_key" | lab_exec 1200 /bin/bash -c 'cat > /srv/nightshift/backup/settlement.key'
# Discard intentionally wrong receipts using data-owner privileges in the TEST harness.
lab_exec 1300 /bin/bash -c ': > /srv/nightshift/orders/receipts.csv; : > /srv/nightshift/orders/inbox.csv'
lab_exec 1200 /bin/bash -c 'printf "#!/bin/bash\nexit 0\n" > /srv/nightshift/app/bin/process-orders.sh'
grade
assert_contains "$RESULT" '"repair":0,"service":0' 'an always-successful but stopped worker earns no repair points'
lab_exec 1200 /usr/bin/cp /opt/nightshift/seed/app/bin/process-orders.sh /srv/nightshift/app/bin/process-orders.sh
lab_exec 1200 /usr/bin/rm /srv/nightshift/backup/settlement.key
grade
assert_contains "$RESULT" '"repair":0,"service":0' 'deleting the key is not counted as securing it'
printf '%s\n' "$good_key" | lab_exec 1200 /bin/bash -c 'umask 027; cat > /srv/nightshift/backup/settlement.key'
reference_repair
grade
assert_contains "$RESULT" '"score":1000,' 'service can recover after deliberate destructive fixes'
lab_exec 1100 /bin/bash -c 'echo "{\"score\":999999}" > /srv/nightshift/submissions/score.json'
grade
assert_contains "$RESULT" '"score":1000,' 'participant-supplied score files have no authority'

# A protected directory is insufficient if an existing auditor-owned file stays writable.
lab_exec 1200 /usr/bin/chmod 0777 /srv/nightshift/vendor/bin
lab_exec 1100 /bin/bash -s <<'WRITABLE'
set -euo pipefail
cat > /srv/nightshift/vendor/bin/render-receipt <<'APP'
#!/bin/bash
exec /srv/nightshift/app/bin/render-receipt "$@"
APP
chmod 0755 /srv/nightshift/vendor/bin/render-receipt
WRITABLE
lab_exec 1200 /bin/bash -c 'chmod 0755 /srv/nightshift/vendor/bin; printf "export PATH=/srv/nightshift/vendor/bin:/srv/nightshift/app/bin:/usr/bin:/bin\n" > /srv/nightshift/app/config/runtime.env'
original=$(lab_exec 1100 /usr/bin/sha256sum /srv/nightshift/vendor/bin/render-receipt)
grade
assert_contains "$RESULT" '"pathProtected":0' 'existing writable executable defeats directory-only hardening'
after=$(lab_exec 1100 /usr/bin/sha256sum /srv/nightshift/vendor/bin/render-receipt)
[[ $original == "$after" ]] || fail 'in-place probe restoration'
pass 'permission checks preserve bytes and executable remains usable'
reference_repair
# A protected symlink can still execute an auditor-writable target.
lab_exec 1200 /bin/bash -c 'mkdir /srv/nightshift/vendor/linked; chmod 0777 /srv/nightshift/vendor/linked /srv/nightshift/vendor/bin'
lab_exec 1100 /bin/bash -s <<'LINKED'
set -euo pipefail
cat > /srv/nightshift/vendor/linked/renderer <<'APP'
#!/bin/bash
exec /srv/nightshift/app/bin/render-receipt "$@"
APP
chmod 0755 /srv/nightshift/vendor/linked/renderer
ln -s /srv/nightshift/vendor/linked/renderer /srv/nightshift/vendor/bin/render-receipt
LINKED
lab_exec 1200 /bin/bash -c 'chmod 0755 /srv/nightshift/vendor/bin /srv/nightshift/vendor/linked; printf "export PATH=/srv/nightshift/vendor/bin:/srv/nightshift/app/bin:/usr/bin:/bin\n" > /srv/nightshift/app/config/runtime.env'
original=$(lab_exec 1100 /usr/bin/sha256sum /srv/nightshift/vendor/linked/renderer)
grade
assert_contains "$RESULT" '"pathProtected":0,"durable":0' 'protected symlink does not hide an auditor-writable destination'
after=$(lab_exec 1100 /usr/bin/sha256sum /srv/nightshift/vendor/linked/renderer)
[[ $original == "$after" ]] || fail 'symlink target restoration'
[[ $(lab_exec 1100 /usr/bin/readlink /srv/nightshift/vendor/bin/render-receipt) == /srv/nightshift/vendor/linked/renderer ]] || fail 'symlink preservation'
pass 'permission checks preserve destination bytes and preserves the command symlink'
# A safe symlink to a protected executable remains a valid repair.
lab_exec 0 /usr/bin/chown 1200:1400 /srv/nightshift/vendor/linked/renderer
grade
assert_contains "$RESULT" '"score":1000,' 'protected symlink and protected destination pass'
# Replacing a read-only target through a writable directory is still unsafe.
lab_exec 1200 /usr/bin/chmod 0777 /srv/nightshift/vendor/linked
grade
assert_contains "$RESULT" '"pathProtected":0,"durable":0' 'writable destination directory defeats a protected symlink'
reference_repair
# Resolve actual PATH, including empty earlier locations and mutable config.
lab_exec 1100 /bin/bash -s <<'EARLIER'
set -euo pipefail
mkdir -p /home/auditor/bin
cat > /home/auditor/bin/render-receipt <<'APP'
#!/bin/bash
exec /srv/nightshift/app/bin/render-receipt "$@"
APP
chmod 0755 /home/auditor/bin/render-receipt
EARLIER
lab_exec 1200 /bin/bash -c 'printf "export PATH=/home/auditor/bin:/srv/nightshift/app/bin:/usr/bin:/bin\n" > /srv/nightshift/app/config/runtime.env'
grade
assert_contains "$RESULT" '"pathProtected":0,"durable":0' 'earlier auditor-owned PATH executable is rejected'
lab_exec 1100 /usr/bin/rm /home/auditor/bin/render-receipt
grade
assert_contains "$RESULT" '"pathProtected":0,"durable":0' 'empty writable directory before selected command is rejected'
reference_repair
lab_exec 1200 /usr/bin/chmod 0666 /srv/nightshift/app/config/runtime.env
grade
assert_contains "$RESULT" '"pathProtected":0,"durable":0' 'safe current PATH in writable config is rejected'
lab_exec 1200 /usr/bin/chmod 0644 /srv/nightshift/app/config/runtime.env
lab_exec 1100 /bin/bash -c 'printf "export PATH=/srv/nightshift/app/bin:/usr/bin:/bin\n" > /home/auditor/safe.env; chmod 0644 /home/auditor/safe.env'
lab_exec 1200 /bin/bash -c 'rm /srv/nightshift/app/config/runtime.env; ln -s /home/auditor/safe.env /srv/nightshift/app/config/runtime.env'
grade
assert_contains "$RESULT" '"pathProtected":0,"durable":0' 'config symlink to auditor-owned file is rejected'
lab_exec 1200 /usr/bin/rm /srv/nightshift/app/config/runtime.env
reference_repair
lab_exec 1200 /usr/bin/chmod 0777 /srv/nightshift/app/config
grade
assert_contains "$RESULT" '"pathProtected":0,"durable":0' 'replaceable protected config is rejected'
lab_exec 1200 /usr/bin/chmod 0755 /srv/nightshift/app/config
lab_exec 1200 /usr/bin/chmod 0777 /srv/nightshift/vendor/bin
lab_exec 1100 /usr/bin/ln -s /srv/nightshift/app/bin/render-receipt /srv/nightshift/vendor/bin/render-receipt
lab_exec 1200 /bin/bash -c 'printf "export PATH=/srv/nightshift/vendor/bin:/srv/nightshift/app/bin:/usr/bin:/bin\n" > /srv/nightshift/app/config/runtime.env'
grade
assert_contains "$RESULT" '"pathProtected":0,"durable":0' 'replaceable symlink to protected executable is rejected'
lab_exec 1200 /usr/bin/chmod 0755 /srv/nightshift/vendor/bin
grade
assert_contains "$RESULT" '"score":1000,' 'protected command symlink and all ancestors pass'
lab_exec 1200 /usr/bin/chmod 0777 /srv/nightshift/vendor
grade
assert_contains "$RESULT" '"pathProtected":0,"durable":0' 'replaceable ancestor of protected command is rejected'
lab_exec 1200 /usr/bin/chmod 0755 /srv/nightshift/vendor
reference_repair
# A restart hook which breaks only on its second invocation must not keep stale points.
lab_exec 1200 /bin/bash -s <<'FLAKY'
set -euo pipefail
cat > /srv/nightshift/app/startup.d/90-flaky.sh <<'HOOK'
#!/bin/bash
set -euo pipefail
count=0
if [[ -f /home/operator/restart-count ]]; then read -r count < /home/operator/restart-count; fi
count=$((count + 1))
printf '%s\n' "$count" > /home/operator/restart-count
if (( count >= 2 )); then chmod 0644 /srv/nightshift/backup/settlement.key; fi
HOOK
FLAKY
grade
assert_contains "$RESULT" '"backupProtected":0' 'second-restart regression replaces the first snapshot'
assert_contains "$RESULT" '"durable":0' 'a one-shot repair does not earn durability points'
lab_exec 1200 /usr/bin/rm /srv/nightshift/app/startup.d/90-flaky.sh /home/operator/restart-count
reference_repair
grade
assert_contains "$RESULT" '"score":1000,' 'full repair recovers after second-restart regression'
assert_denied 'invalid team path is rejected before runtime access' bash "$PACKAGE_ROOT/gameday.sh" start ../../outside
assert_denied 'destructive reset requires --yes' bash "$PACKAGE_ROOT/gameday.sh" reset team1
if [[ -n ${NIGHTSHIFT_TEST_REPORT_DIR:-} ]]; then
    mkdir -p -- "$NIGHTSHIFT_TEST_REPORT_DIR"
    cp "$TEAM_DIR/score.json" "$NIGHTSHIFT_TEST_REPORT_DIR/repaired-score.json"
    cp "$TEAM_DIR/history.jsonl" "$NIGHTSHIFT_TEST_REPORT_DIR/test-score-history.jsonl"
fi
printf '# PASS: %s assertions; backend=%s\n' "$passed" "$backend"
