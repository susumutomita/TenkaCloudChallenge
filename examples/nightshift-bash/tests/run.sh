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
    if [[ $backend == docker && $IMAGE == nightshift-bash:test-* ]]; then docker image rm "$IMAGE" >/dev/null 2>&1 || true; fi
    [[ $TEST_TEMP == */nightshift-tests.* ]] && rm -rf -- "$TEST_TEMP"
}
trap cleanup EXIT
if [[ $backend == docker ]]; then
    source "$PACKAGE_ROOT/lib/docker.sh"
    require_docker
    build_image
    IMAGE="nightshift-bash:test-$$"
    # Simulate an old existing tag; start must rebuild from the current sources.
    printf 'FROM nightshift-bash:0.1.0\nLABEL org.tenkacloud.nightshift.stale=1\n' | docker build -t "$IMAGE" -
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
if [[ $backend == docker ]]; then
    stale=$(docker inspect --format '{{ index .Config.Labels "org.tenkacloud.nightshift.stale" }}' "$CONTAINER")
    [[ $stale != 1 ]] || fail 'start reused a stale runtime image'
    pass 'start rebuilds current sources even when its image tag already exists'
fi
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
# A safe symlink to the shipped implementation remains a valid repair.
lab_exec 1100 /usr/bin/cp /opt/nightshift/seed/app/bin/render-receipt /srv/nightshift/vendor/linked/renderer
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
# Read-only does not mean protected when auditor still owns the inode.
lab_exec 1200 /usr/bin/chmod 0777 /srv/nightshift/vendor/bin
lab_exec 1100 /bin/bash -s <<'OWNED'
set -euo pipefail
cat > /srv/nightshift/vendor/bin/render-receipt <<'APP'
#!/bin/bash
exec /srv/nightshift/app/bin/render-receipt "$@"
APP
chmod 0555 /srv/nightshift/vendor/bin/render-receipt
OWNED
lab_exec 1200 /bin/bash -c 'chmod 0755 /srv/nightshift/vendor/bin; printf "export PATH=/srv/nightshift/vendor/bin:/srv/nightshift/app/bin:/usr/bin:/bin\n" > /srv/nightshift/app/config/runtime.env'
grade
assert_contains "$RESULT" '"pathProtected":0,"durable":0' 'auditor-owned read-only executable is rejected'
reference_repair
lab_exec 1200 /usr/bin/chmod 0777 /srv/nightshift/vendor/bin
printf '%s\n' "$good_key" | lab_exec 1100 /bin/bash -c 'cat > /srv/nightshift/vendor/bin/key; chmod 0004 /srv/nightshift/vendor/bin/key'
lab_exec 1200 /bin/bash -c 'chmod 0755 /srv/nightshift/vendor/bin; rm /srv/nightshift/backup/settlement.key; ln -s /srv/nightshift/vendor/bin/key /srv/nightshift/backup/settlement.key'
grade
assert_contains "$RESULT" '"backupProtected":0' 'auditor-owned unreadable backup target is rejected'
lab_exec 1200 /usr/bin/rm /srv/nightshift/backup/settlement.key
printf '%s\n' "$good_key" | lab_exec 1200 /bin/bash -c 'umask 027; cat > /srv/nightshift/backup/settlement.key'
lab_exec 1200 /usr/bin/chmod 0777 /srv/nightshift/vendor/bin
lab_exec 1100 /bin/bash -c 'printf "#!/bin/bash\ntrue\n" > /srv/nightshift/vendor/bin/startup; chmod 0555 /srv/nightshift/vendor/bin/startup'
lab_exec 1200 /bin/bash -c 'chmod 0755 /srv/nightshift/vendor/bin; ln -s /srv/nightshift/vendor/bin/startup /srv/nightshift/app/startup.d/50-linked.sh'
grade
assert_contains "$RESULT" '"pathProtected":0,"durable":0' 'protected startup directory cannot hide an auditor-owned hook'
lab_exec 1200 /usr/bin/rm /srv/nightshift/app/startup.d/50-linked.sh
# Owner can re-enable search/write permissions on a locked directory too.
lab_exec 1200 /usr/bin/chmod 0777 /srv/nightshift/vendor
lab_exec 1100 /bin/bash -c 'mkdir /srv/nightshift/vendor/owned; chmod 0000 /srv/nightshift/vendor/owned'
lab_exec 1200 /bin/bash -c 'chmod 0755 /srv/nightshift/vendor; printf "export PATH=/srv/nightshift/vendor/owned:/srv/nightshift/app/bin:/usr/bin:/bin\n" > /srv/nightshift/app/config/runtime.env'
grade
assert_contains "$RESULT" '"pathProtected":0,"durable":0' 'auditor-owned non-searchable PATH ancestor is rejected'
reference_repair
# Sticky directory removal uses the link inode owner, not its target owner.
lab_exec 1100 /usr/bin/ln -s /srv/nightshift/app/bin/render-receipt /tmp/render-receipt
lab_exec 1200 /bin/bash -c 'printf "export PATH=/tmp:/srv/nightshift/app/bin:/usr/bin:/bin\n" > /srv/nightshift/app/config/runtime.env'
grade
assert_contains "$RESULT" '"pathProtected":0,"durable":0' 'auditor-owned symlink in sticky directory remains replaceable'
lab_exec 1100 /usr/bin/rm /tmp/render-receipt
reference_repair
# A complete-file verdict must not silently grade only the first MiB.
lab_exec 1300 /bin/bash -c 'head -c 1048577 /dev/zero | tr "\\0" " " >> /srv/nightshift/orders/receipts.csv'
grade
assert_contains "$RESULT" '"repair":0,"service":0' 'oversized receipts fail instead of grading a truncated prefix'
lab_exec 1300 /bin/bash -c ': > /srv/nightshift/orders/receipts.csv; head -c 1048577 /dev/zero | tr "\\0" " " >> /srv/nightshift/orders/rejected.csv'
grade
assert_contains "$RESULT" '"repair":0,"service":0' 'oversized rejections fail instead of grading a truncated prefix'
lab_exec 1300 /bin/bash -c ': > /srv/nightshift/orders/rejected.csv'
grade
assert_contains "$RESULT" '"score":1000,' 'complete output validation recovers after operator clears oversized fixtures'
# Configuration cannot override command lookup with shell functions or hashes.
lab_exec 1200 /bin/bash -s <<'FUNCTION'
cat > /srv/nightshift/app/config/runtime.env <<'CONFIG'
export PATH=/srv/nightshift/app/bin:/usr/bin:/bin
render-receipt() { /srv/nightshift/app/bin/render-receipt "$@"; }
CONFIG
FUNCTION
grade
assert_contains "$RESULT" '"pathProtected":0,"durable":0' 'runtime config shell function override is rejected'
lab_exec 1200 /bin/bash -s <<'HASH'
cat > /srv/nightshift/app/config/runtime.env <<'CONFIG'
export PATH=/srv/nightshift/app/bin:/usr/bin:/bin
hash -p /srv/nightshift/app/bin/render-receipt render-receipt
CONFIG
HASH
grade
assert_contains "$RESULT" '"pathProtected":0,"durable":0' 'runtime config hash override is rejected'
reference_repair
lab_exec 1200 /bin/bash -c 'printf "# safe configuration\nexport PATH=\"/srv/nightshift/app/bin:/usr/bin:/bin\"\n" > /srv/nightshift/app/config/runtime.env'
grade
assert_contains "$RESULT" '"score":1000,' 'quoted PATH assignment and comments remain valid'
# Removing ancestor traversal does not invalidate a retained directory handle.
lab_exec 1200 /usr/bin/chmod 0777 /srv/nightshift/vendor/bin
lab_exec 1100 /bin/bash -s <<'HELD'
mkdir /srv/nightshift/vendor/bin/held
cat > /srv/nightshift/vendor/bin/held/render-receipt <<'APP'
#!/bin/bash
exec /srv/nightshift/app/bin/render-receipt "$@"
APP
chmod 0755 /srv/nightshift/vendor/bin/held/render-receipt
HELD
lab_exec 1200 /bin/bash -c 'chmod 0750 /srv/nightshift/vendor/bin; printf "export PATH=/srv/nightshift/vendor/bin/held:/srv/nightshift/app/bin:/usr/bin:/bin\n" > /srv/nightshift/app/config/runtime.env'
grade
assert_contains "$RESULT" '"pathProtected":0,"durable":0' 'unverifiable descendants below a non-searchable ancestor are rejected'
reference_repair
lab_exec 1300 /bin/bash -c 'printf "\\0" >> /srv/nightshift/orders/receipts.csv'
grade
assert_contains "$RESULT" '"repair":0,"service":0' 'NUL-containing receipts cannot be normalized into passing CSV'
lab_exec 1300 /bin/bash -c ': > /srv/nightshift/orders/receipts.csv; printf "\\0" >> /srv/nightshift/orders/rejected.csv'
grade
assert_contains "$RESULT" '"repair":0,"service":0' 'NUL-containing rejections cannot be normalized into passing CSV'
lab_exec 1300 /bin/bash -c ': > /srv/nightshift/orders/rejected.csv'
grade
assert_contains "$RESULT" '"score":1000,' 'valid text outputs recover after binary corruption is cleared'
# Protected wrappers cannot delegate to an unverified writable program.
lab_exec 1100 /bin/bash -c 'chmod 0755 /home/auditor; cp /opt/nightshift/seed/app/bin/render-receipt /home/auditor/payload; chmod 0755 /home/auditor/payload'
lab_exec 1200 /bin/bash -s <<'FORWARD'
cat > /srv/nightshift/app/bin/render-receipt <<'APP'
#!/bin/bash
exec /home/auditor/payload "$@"
APP
FORWARD
grade
assert_contains "$RESULT" '"pathProtected":0,"durable":0' 'protected wrapper cannot hide a writable transitive executable'
lab_exec 1200 /usr/bin/cp /opt/nightshift/seed/app/bin/render-receipt /srv/nightshift/app/bin/render-receipt
lab_exec 1200 /bin/bash -s <<'WORKER'
cat > /srv/nightshift/app/bin/process-orders.sh <<'APP'
#!/bin/bash
exec /opt/nightshift/seed/app/bin/process-orders.sh "$@"
APP
WORKER
grade
assert_contains "$RESULT" '"pathProtected":0,"durable":0' 'replacement business worker cannot bypass declared command lookup'
lab_exec 1200 /usr/bin/cp /opt/nightshift/seed/app/bin/process-orders.sh /srv/nightshift/app/bin/process-orders.sh
if [[ $backend == docker ]]; then
    # Keep a real auditor write descriptor open across chmod; grading must revoke it.
    lab_exec 1200 /usr/bin/chmod 0777 /srv/nightshift/app/bin/render-receipt
    lab_exec 1100 /bin/bash -c 'exec 3<>/srv/nightshift/app/bin/render-receipt; echo $$ > /tmp/held-auditor; exec /usr/bin/sleep 120' &
    holder=$!
    for attempt in {1..30}; do
        if lab_exec 0 /usr/bin/test -f /tmp/held-auditor; then break; fi
        sleep 0.1
    done
    held_pid=$(lab_exec 0 /usr/bin/cat /tmp/held-auditor)
    lab_exec 1200 /usr/bin/chmod 0755 /srv/nightshift/app/bin/render-receipt
    grade
    wait "$holder" || true # The expected UID-scoped revocation terminates this exec.
    assert_denied 'grading terminates the old auditor process with an open write descriptor' lab_exec 0 /usr/bin/kill -0 "$held_pid"
    assert_contains "$RESULT" '"score":1000,' 'trusted repair is awarded only after prior auditor descriptors close'
fi
if [[ $backend == docker ]]; then
    # An audit payload can fork as batch; that old process must not forge receipts.
    lab_exec 1300 /bin/bash -c 'echo $$ > /tmp/held-batch; exec /usr/bin/sleep 120' &
    batch_holder=$!
    for attempt in {1..30}; do
        if lab_exec 0 /usr/bin/test -f /tmp/held-batch; then break; fi
        sleep 0.1
    done
    batch_pid=$(lab_exec 0 /usr/bin/cat /tmp/held-batch)
    printf '00000000000000000000000000000000\n' | lab_exec 1200 /bin/bash -c 'cat > /srv/nightshift/backup/settlement.key'
    grade
    wait "$batch_holder" || true
    assert_denied 'grading revokes batch daemons created by earlier audit payloads' lab_exec 0 /usr/bin/kill -0 "$batch_pid"
    assert_contains "$RESULT" '"repair":0,"service":0' 'an incorrect key cannot earn points after compromised processes are revoked'
    printf '%s\n' "$good_key" | lab_exec 1200 /bin/bash -c 'cat > /srv/nightshift/backup/settlement.key'
    # Startup may fork an operator daemon as well; each restart must close it.
    lab_exec 1200 /bin/bash -s <<'DAEMON'
cat > /srv/nightshift/app/startup.d/50-background.sh <<'HOOK'
#!/bin/bash
/usr/bin/sleep 120 </dev/null >/dev/null 2>&1 &
echo $! > /home/operator/background-pid
HOOK
DAEMON
    grade
    daemon_pid=$(lab_exec 0 /usr/bin/cat /home/operator/background-pid)
    assert_denied 'restart does not leave editable startup-hook daemons running' lab_exec 0 /usr/bin/kill -0 "$daemon_pid"
    assert_contains "$RESULT" '"score":1000,' 'trusted processing still completes after startup descendants are revoked'
    lab_exec 1200 /usr/bin/rm /srv/nightshift/app/startup.d/50-background.sh /home/operator/background-pid
fi
# CR is part of a Bash assignment, not ignorable trailing whitespace.
lab_exec 1200 /bin/bash -c 'mkdir $'"'"'/srv/nightshift/app/bin\r'"'"'; chmod 0777 $'"'"'/srv/nightshift/app/bin\r'"'"'; printf "export PATH=/srv/nightshift/app/bin\r\n" > /srv/nightshift/app/config/runtime.env'
lab_exec 1100 /bin/bash -c 'cp /opt/nightshift/seed/app/bin/render-receipt $'"'"'/srv/nightshift/app/bin\r/render-receipt'"'"'; chmod 0755 $'"'"'/srv/nightshift/app/bin\r/render-receipt'"'"''
grade
assert_contains "$RESULT" '"pathProtected":0,"durable":0' 'carriage-return PATH cannot validate an unrelated clean directory'
assert_contains "$RESULT" '"validOrders":1,"deduplication":1,"invalidRejected":1' 'CR regression really executes working code from the unvalidated directory'
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
