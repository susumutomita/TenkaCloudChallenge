#!/bin/bash
set -euo pipefail
source /opt/nightshift/lib.sh
require_lab
operation=${1:-}
case "$operation" in
    init)
        [[ ! -e /run/nightshift/ready ]] || { echo 'Already initialized' >&2; exit 1; }
        IFS= read -r session
        IFS= read -r settlement_key
        IFS= read -r proof_token
        [[ $session =~ ^[a-f0-9]{32}$ && $settlement_key =~ ^[a-f0-9]{32}$ && $proof_token =~ ^[a-f0-9]{32}$ ]] || exit 64
        # This branch runs exactly once, before any participant receives a shell.
        /usr/bin/install -d -m 0755 "$LAB" /home /run/nightshift
        /usr/bin/install -d -o 1200 -g 1400 -m 0755 "$LAB/app" "$LAB/backup"
        /usr/bin/cp -R /opt/nightshift/seed/app/. "$LAB/app/"
        /usr/bin/chown -R 1200:1400 "$LAB/app"
        /usr/bin/find "$LAB/app" -type d -exec /usr/bin/chmod 0755 {} +
        /usr/bin/find "$LAB/app" -type f -exec /usr/bin/chmod 0644 {} +
        /usr/bin/chmod 0755 "$LAB/app/bin/"*
        /usr/bin/install -d -o 1200 -g 1400 -m 0755 "$LAB/vendor"
        /usr/bin/install -d -o 1200 -g 1400 -m 0777 "$LAB/vendor/bin"
        /usr/bin/install -d -o 1100 -g 1100 -m 0700 "$LAB/submissions"
        /usr/bin/install -d -o 1300 -g 1400 -m 0700 "$LAB/evidence"
        /usr/bin/install -d -o 0 -g 0 -m 0755 "$LAB/service"
        /usr/bin/install -d -o 1300 -g 1400 -m 0770 "$LAB/orders" "$LAB/logs"
        printf '%s\n' "$settlement_key" > "$LAB/backup/settlement.key"
        /usr/bin/chown 1200:1400 "$LAB/backup/settlement.key"
        /usr/bin/chmod 0644 "$LAB/backup/settlement.key"
        printf '%s\n' "$proof_token" > "$LAB/service/proof-token"
        /usr/bin/chown 1300:1400 "$LAB/service/proof-token"
        /usr/bin/chmod 0400 "$LAB/service/proof-token"
        for role in auditor operator batch; do
            case "$role" in auditor) uid=1100; gid=1100 ;; operator) uid=1200; gid=1400 ;; batch) uid=1300; gid=1400 ;; esac
            /usr/bin/install -d -o "$uid" -g "$gid" -m 0700 "/home/$role"
        done
        for file in inbox.csv receipts.csv rejected.csv; do
            : > "$LAB/orders/$file"
            /usr/bin/chown 1300:1400 "$LAB/orders/$file"
            /usr/bin/chmod 0660 "$LAB/orders/$file"
        done
        : > "$LAB/logs/batch.log"
        /usr/bin/chown 1300:1400 "$LAB/logs/batch.log"
        /usr/bin/chmod 0664 "$LAB/logs/batch.log"
        /usr/bin/chmod 0755 "$LAB/logs"
        /usr/bin/cp /opt/nightshift/participant/START-HERE.md "$LAB/START-HERE.md"
        printf '%s\n' "$session" > /run/nightshift/session
        printf '0\n' > /run/nightshift/counter
        : > /run/nightshift/service.lock
        /usr/bin/chmod 0700 /run/nightshift
        /usr/bin/chmod 0600 /run/nightshift/session /run/nightshift/counter /run/nightshift/service.lock
        restart_unlocked
        : > /run/nightshift/ready
        printf 'initialized\n'
        ;;
    tick|restart|deliver|live)
        [[ -f /run/nightshift/ready ]] || exit 1
        exec 9>/run/nightshift/service.lock
        /usr/bin/flock -w 12 9 || exit 75
        case "$operation" in
            tick) tick_unlocked ;;
            restart) restart_unlocked; tick_unlocked ;;
            deliver) deliver_unlocked ;;
            live)
                IFS= read -r count < /run/nightshift/counter
                [[ $count =~ ^[0-9]+$ ]] || exit 1
                count=$((count + 1))
                printf '%s\n' "$count" > /run/nightshift/counter
                printf 'LIVE-%s,%s,%s\n' "$count" "$((RANDOM % 5 + 1))" "$((RANDOM % 900 + 100))" | deliver_unlocked
                tick_unlocked
                ;;
        esac
        ;;
    *) printf 'Unknown control operation\n' >&2; exit 64 ;;
esac
