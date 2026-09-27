#!/bin/bash
# Trusted runtime. Never source files from the editable application as root.
set -euo pipefail
export PATH=/usr/sbin:/usr/bin:/sbin:/bin
export LC_ALL=C
LAB=/srv/nightshift

as_role() {
    local role=$1; shift
    local uid gid home
    case "$role" in
        auditor) uid=1100; gid=1100; home=/home/auditor ;;
        operator) uid=1200; gid=1400; home=/home/operator ;;
        batch) uid=1300; gid=1400; home=/home/batch ;;
        *) printf 'Unknown role\n' >&2; return 64 ;;
    esac
    /usr/bin/setpriv --reuid "$uid" --regid "$gid" --clear-groups --no-new-privs \
        /usr/bin/env -i PATH=/usr/bin:/bin HOME="$home" USER="$role" LOGNAME="$role" \
        LANG=C.UTF-8 LC_ALL=C.UTF-8 TERM=xterm-256color "$@" 9>&-
}

require_lab() {
    [[ $EUID -eq 0 && -f /etc/nightshift-image && -d /run/nightshift ]] || {
        printf 'Run only inside the disposable Nightshift image.\n' >&2; return 1;
    }
}

# Commands below run while the caller holds /run/nightshift/service.lock.
deliver_unlocked() {
    as_role batch /bin/bash --noprofile --norc -c '
        set -euo pipefail
        target=/srv/nightshift/orders/inbox.csv
        [[ -f "$target" && ! -L "$target" ]] || exit 1
        /usr/bin/cat >> "$target"
    '
}

tick_unlocked() {
    /usr/bin/timeout --signal=TERM --kill-after=1 4 \
        /usr/bin/setpriv --reuid 1300 --regid 1400 --clear-groups --no-new-privs \
        /usr/bin/env -i PATH=/usr/bin:/bin HOME=/home/batch USER=batch LOGNAME=batch \
        LANG=C.UTF-8 LC_ALL=C.UTF-8 \
        /bin/bash --noprofile --norc "$LAB/app/bin/process-orders.sh" < /dev/null 9>&-
}

restart_unlocked() {
    local result=0
    # All editable startup code is executed as operator, NEVER root.
    /usr/bin/timeout --signal=TERM --kill-after=1 5 \
        /usr/bin/setpriv --reuid 1200 --regid 1400 --clear-groups --no-new-privs \
        /usr/bin/env -i PATH=/usr/bin:/bin HOME=/home/operator USER=operator \
        LANG=C.UTF-8 LC_ALL=C.UTF-8 \
        /bin/bash --noprofile --norc -c '
            set -euo pipefail
            shopt -s nullglob
            for hook in /srv/nightshift/app/startup.d/*.sh; do
                /bin/bash --noprofile --norc "$hook"
            done
        ' < /dev/null 9>&- || result=$?
    # Editable startup hooks may fork: close descendants before validating state.
    close_exercise_sessions || return 1
    return "$result"
}

# Promotion/grading revokes old exercise processes and their open descriptors.
# The CLI lock prevents new supported shell sessions during this transition.
close_exercise_sessions() {
    require_lab
    [[ -r /proc/self/status ]] || { echo 'A private /proc is required.' >&2; return 1; }
    local attempt pids rc pid state live
    for attempt in {1..20}; do
        rc=0; pids=$(/usr/bin/pgrep -u 1100,1200,1300) || rc=$?
        (( rc == 1 )) && return 0
        (( rc == 0 )) || return 1
        live=0
        for pid in $pids; do
            [[ $pid =~ ^[0-9]+$ ]] || return 1
            if ! state=$(/usr/bin/ps -p "$pid" -o stat=); then
                kill -0 "$pid" 2>/dev/null && return 1
                continue
            fi
            [[ $state == Z* ]] && continue # Zombies retain no file descriptors.
            live=1
            kill -KILL "$pid" 2>/dev/null || { kill -0 "$pid" 2>/dev/null && return 1; }
        done
        (( live == 0 )) && return 0
        /usr/bin/sleep 0.05
    done
    echo 'Exercise processes did not stop; refusing to grade.' >&2
    return 1
}
