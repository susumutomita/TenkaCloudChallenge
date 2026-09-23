#!/bin/bash
# OPERATOR ONLY. Sent on stdin to immutable /bin/bash; not copied into the image.
# EXPECTED_KEY and CHECK_NONCE are supplied by host/score.sh, not the participant.
set -euo pipefail
source /opt/nightshift/lib.sh
require_lab
[[ ${EXPECTED_KEY:-} =~ ^[a-f0-9]{32}$ && ${CHECK_NONCE:-} =~ ^[a-f0-9]{32}$ ]] || exit 64

backup_check() {
    # An absent key is NOT secure: independent receipt checks must also pass.
    as_role batch /usr/bin/test -f "$LAB/backup/settlement.key" || return 1
    if as_role auditor /usr/bin/test -r "$LAB/backup/settlement.key"; then return 1; fi
    return 0
}

service_check() {
    local stage=$1 prefix a b c d i1 i2 i3 i4 quantity price content rejected_content
    local line commas id q p total digest rest expected found_a=0 found_b=0 found_c=0 found_d=0
    local bad=0 valid_a valid_b valid_c valid_d
    prefix="T-${CHECK_NONCE:0:12}-${stage}"
    a="$prefix-A"; b="$prefix-B"; c="$prefix-C"; d="$prefix-D"
    i1="$prefix-X1"; i2="$prefix-X2"; i3="$prefix-X3"; i4="$prefix-X4"
    quantity=$((RANDOM % 8 + 2)); price=$((RANDOM % 9000 + 10))
    valid_a="$a,$quantity,$price,$((quantity * price))"
    valid_b="$b,3,50,150"; valid_c="$c,1,0,0"; valid_d="$d,5,21,105"
    NORMAL_OK=0; DUPLICATE_OK=0; INVALID_OK=0
    if ! printf '%s\n' "$a,$quantity,$price" "$b,003,000050" "$c,1,0" \
        "$d,5,21" "$d,5,21" "$i1,0,100" "$i2,-1,100" "$i3,1,abc" "$i4,1,100,999" \
        | deliver_unlocked >/dev/null 2>&1; then return 0; fi
    tick_unlocked >/dev/null 2>&1 || return 0
    printf '%s\n' "$d,5,21" | deliver_unlocked >/dev/null 2>&1 || return 0
    tick_unlocked >/dev/null 2>&1 || return 0
    # Bounded reads, under the data owner's privileges; never follow a link as root.
    content=$(as_role batch /usr/bin/head -c 1048576 "$LAB/orders/receipts.csv") || return 0
    rejected_content=$(as_role batch /usr/bin/head -c 1048576 "$LAB/orders/rejected.csv") || return 0
    while IFS= read -r line; do
        IFS=, read -r id q p total digest rest <<< "$line"
        commas=${line//[^,]/}
        case "$id" in
            "$a"|"$b"|"$c"|"$d")
                expected=$(printf '%s|%s|%s|%s|%s' "$id" "$q" "$p" "$total" "$EXPECTED_KEY" | /usr/bin/sha256sum)
                if [[ $digest != "${expected%% *}" || -n $rest || ${#commas} -ne 4 ]]; then bad=1; fi
                case "$id" in
                    "$a") found_a=$((found_a + 1)); [[ "$id,$q,$p,$total" == "$valid_a" ]] || bad=1 ;;
                    "$b") found_b=$((found_b + 1)); [[ "$id,$q,$p,$total" == "$valid_b" ]] || bad=1 ;;
                    "$c") found_c=$((found_c + 1)); [[ "$id,$q,$p,$total" == "$valid_c" ]] || bad=1 ;;
                    "$d") found_d=$((found_d + 1)); [[ "$id,$q,$p,$total" == "$valid_d" ]] || bad=1 ;;
                esac
                ;;
            "$i1"|"$i2"|"$i3"|"$i4") bad=1 ;;
        esac
    done <<< "$content"
    if (( found_a == 1 && found_b == 1 && found_c == 1 && bad == 0 )); then NORMAL_OK=1; fi
    if (( NORMAL_OK && found_d == 1 )); then DUPLICATE_OK=1; fi
    if (( NORMAL_OK )) && [[ $rejected_content == *"$i1,0,100,"* \
        && $rejected_content == *"$i2,-1,100,"* \
        && $rejected_content == *"$i3,1,abc,"* \
        && $rejected_content == *"$i4,1,100,999,"* ]]; then INVALID_OK=1; fi
}

probe_cleanup() {
    [[ -n ${ACTIVE_PROBE:-} ]] || return 0
    as_role auditor /bin/bash --noprofile --norc -s -- "$ACTIVE_PROBE" <<'CLEANUP'
set -euo pipefail
nonce=$1
scratch="/home/auditor/.probe-$nonce"
target=/srv/nightshift/vendor/bin/render-receipt
[[ -d $scratch && ! -L $scratch ]] || exit 1
IFS= read -r mode < "$scratch/mode"
case "$mode" in
    move)
        rm -f -- "$target"
        if [[ -e $scratch/original || -L $scratch/original ]]; then mv -- "$scratch/original" "$target"; fi
        ;;
    overwrite)
        cat "$scratch/original" > "$target"
        IFS= read -r permissions < "$scratch/permissions"
        [[ $permissions =~ ^[0-7]{3,4}$ ]] || exit 1
        current=$(stat -c '%a' "$target")
    [[ $current == "$permissions" ]] || chmod "$permissions" "$target"
        ;;
    *) exit 1 ;;
esac
rm -rf -- "$scratch"
CLEANUP
    ACTIVE_PROBE=''
}
ACTIVE_PROBE=''
trap 'probe_cleanup >/dev/null 2>&1 || true' EXIT

path_check() {
    local stage=$1 nonce="${CHECK_NONCE}-$1" result rc=0
    # Exercise the SAME writable command location an auditor can reach.
    # All probe placement/restoration runs as auditor, never root.
    result=$(as_role auditor /bin/bash --noprofile --norc -s -- "$nonce" <<'PLACE'
set -euo pipefail
nonce=$1
target=/srv/nightshift/vendor/bin/render-receipt
scratch="/home/auditor/.probe-$nonce"
if [[ -d /srv/nightshift/vendor/bin && -w /srv/nightshift/vendor/bin && -x /srv/nightshift/vendor/bin ]]; then
    mkdir -m 0700 -- "$scratch"
    printf 'move\n' > "$scratch/mode"
    if [[ -e $target || -L $target ]]; then mv -- "$target" "$scratch/original"; fi
elif [[ -f $target && ! -L $target && -w $target ]]; then
    mkdir -m 0700 -- "$scratch"
    printf 'overwrite\n' > "$scratch/mode"
    cp -- "$target" "$scratch/original"
    stat -c '%a' "$target" > "$scratch/permissions"
else
    printf 'blocked\n'
    exit 20
fi
{
    printf '#!/bin/bash\n'
    printf 'printf "probe\\n" > /srv/nightshift/evidence/probe-%s\n' "$nonce"
    printf 'exec /srv/nightshift/app/bin/render-receipt "$@"\n'
} > "$target"
[[ -x $target ]] || chmod 0755 "$target"
printf 'placed\n'
PLACE
    ) || rc=$?
    if (( rc == 20 )) && [[ $result == blocked ]]; then return 0; fi
    # Unexpected inability to place/restore is a failed check, never a free pass.
    if [[ $result != placed || $rc -ne 0 ]]; then
        ACTIVE_PROBE=$nonce
        probe_cleanup >/dev/null 2>&1 || true
        return 1
    fi
    ACTIVE_PROBE=$nonce
    printf 'P-%s-%s,1,7\n' "${CHECK_NONCE:0:12}" "$stage" | deliver_unlocked >/dev/null 2>&1 || {
        probe_cleanup >/dev/null 2>&1 || true; return 1;
    }
    tick_unlocked >/dev/null 2>&1 || true
    if as_role batch /usr/bin/test -e "$LAB/evidence/probe-$nonce"; then rc=1; else rc=0; fi
    probe_cleanup >/dev/null 2>&1 || return 1
    return "$rc"
}

before_backup=0; before_path=0; restart_ok=0
backup_check >/dev/null 2>&1 && before_backup=1
path_check before >/dev/null 2>&1 && before_path=1
# Score is an announced resilience test, including a real batch-service restart.
restart_unlocked >/dev/null 2>&1 && restart_ok=1
backup=0; path=0
backup_check >/dev/null 2>&1 && backup=1
path_check after >/dev/null 2>&1 && path=1
service_check after
normal=$NORMAL_OK; duplicate=$DUPLICATE_OK; invalid=$INVALID_OK
durable=0
if (( restart_ok && backup && path && normal && duplicate && invalid )); then
    # Run a second restart: a fix must survive more than a one-shot reset.
    # The reported state must be the LAST state, not a stale first-restart success.
    restart_ok=0; backup=0; path=0
    restart_unlocked >/dev/null 2>&1 && restart_ok=1
    backup_check >/dev/null 2>&1 && backup=1
    path_check twice >/dev/null 2>&1 && path=1
    service_check twice
    normal=$NORMAL_OK; duplicate=$DUPLICATE_OK; invalid=$INVALID_OK
    if (( restart_ok && backup && path && normal && duplicate && invalid )); then durable=1; fi
fi
printf '%s,%s,%s,%s,%s,%s,%s,%s,%s\n' "$before_backup" "$before_path" "$restart_ok" "$backup" "$path" "$durable" "$normal" "$duplicate" "$invalid"
