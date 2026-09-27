#!/bin/bash
set -euo pipefail
export PATH=/usr/sbin:/usr/bin:/sbin:/bin
[[ $EUID -eq 0 && -f /etc/nightshift-image ]] || exit 1
/usr/bin/install -d -m 0700 /run/nightshift
interval=${NIGHTSHIFT_INTERVAL:-5}
[[ $interval =~ ^[0-9]+$ && ${#interval} -le 3 ]] || exit 64
interval=$((10#$interval))
trap 'exit 0' TERM INT
while [[ ! -f /run/nightshift/ready ]]; do /usr/bin/sleep 0.2 & wait "$!" || true; done
while :; do
    if (( interval > 0 )); then
        /bin/bash /opt/nightshift/control.sh live >/dev/null 2>&1 || true
        /usr/bin/sleep "$interval" & wait "$!" || true
    else
        /usr/bin/sleep 1 & wait "$!" || true
    fi
done
