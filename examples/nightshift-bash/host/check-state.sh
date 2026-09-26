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

# Check the complete pathname as the low-privilege auditor. This includes every
# replaceable directory entry, intermediate link, and the final link destination.
# No participant-controlled file is opened or evaluated as root.
path_is_protected() {
    as_role auditor /bin/bash --noprofile --norc -s -- "$1" <<'CHECK_PATH'
set -euo pipefail
pending=$1
[[ $pending == /* && $pending != *$'\n'* ]] || exit 1
parent=/
links=0
while [[ -n $pending ]]; do
    pending=${pending#/}
    part=${pending%%/*}
    if [[ $pending == */* ]]; then pending=${pending#*/}; else pending=''; fi
    case "$part" in
        ''|.) continue ;;
        ..) parent=${parent%/*}; [[ -n $parent ]] || parent=/; continue ;;
    esac
    entry="${parent%/}/$part"
    # A non-searchable directory blocks all auditor access below it. Its own
    # replacement possibility was already checked on the previous iteration.
    [[ -x $parent ]] || exit 0
    if [[ -w $parent ]]; then
        # Sticky directories only permit replacing one's own entries, unless
        # the auditor owns the directory itself (or can create a missing entry).
        if [[ ! -k $parent || -O $parent || -O $entry || ( ! -e $entry && ! -L $entry ) ]]; then
            exit 1
        fi
    fi
    if [[ -L $entry ]]; then
        links=$((links + 1)); (( links <= 40 )) || exit 1
        target=$(/usr/bin/readlink -- "$entry") || exit 1
        [[ -n $target && $target != *$'\n'* ]] || exit 1
        [[ -z $pending ]] || target="$target/$pending"
        if [[ $target == /* ]]; then parent=/; fi
        pending=$target
    else
        # A missing component cannot be created under its protected parent.
        [[ -e $entry ]] || exit 0
        if [[ -z $pending ]]; then [[ ! -w $entry ]]; exit $?; fi
        [[ -d $entry ]] || exit 1
        parent=$entry
    fi
done
[[ ! -w $parent ]]
CHECK_PATH
}

path_check() {
    local batch_path directory candidate
    # Config and startup code can change the next invocation's PATH even when
    # today's selected executable is protected.
    path_is_protected "$LAB/app/config/runtime.env" || return 1
    path_is_protected "$LAB/app/bin/process-orders.sh" || return 1
    path_is_protected "$LAB/app/startup.d" || return 1
    batch_path=$(/usr/bin/timeout --signal=TERM --kill-after=1 4 \
        /usr/bin/setpriv --reuid 1300 --regid 1400 --clear-groups --no-new-privs \
        /usr/bin/env -i PATH=/usr/bin:/bin HOME=/home/batch USER=batch LOGNAME=batch \
        /bin/bash --noprofile --norc -c '
            set -euo pipefail
            source /srv/nightshift/app/config/runtime.env
            builtin printf "%s\n" "$PATH"
        ' < /dev/null 9>&-) || return 1
    [[ -n $batch_path && $batch_path != *$'\n'* ]] || return 1
    # Examine earlier directories too: an auditor can add an executable there
    # even if the batch currently falls through to a protected command later.
    while :; do
        directory=${batch_path%%:*}
        [[ $directory == /* ]] || return 1
        candidate="${directory%/}/render-receipt"
        path_is_protected "$candidate" || return 1
        if as_role batch /usr/bin/test -f "$candidate" && as_role batch /usr/bin/test -x "$candidate"; then
            return 0
        fi
        [[ $batch_path == *:* ]] || return 1
        batch_path=${batch_path#*:}
    done
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
