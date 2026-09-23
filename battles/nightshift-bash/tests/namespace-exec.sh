#!/bin/bash
# A new user/mount/PID/network namespace for every test call, persistent test data.
# No Docker API is simulated. This does NOT certify Docker image builds or flags.
set -euo pipefail
[[ $# -ge 3 && $EUID -eq 0 ]] || exit 64
root=$1 uid=$2; shift 2
[[ -f $root/.nightshift-test-root && ! -L $root ]] || exit 1
case "$uid" in
    0) gid=0; role=root ;;
    1100) gid=1100; role=auditor ;;
    1200) gid=1400; role=operator ;;
    1300) gid=1400; role=batch ;;
    *) exit 64 ;;
esac
exec unshare --user --map-users=0:0:65536 --map-groups=0:0:65536 \
    --mount --pid --net --fork --kill-child \
    /bin/bash -c '
        set -euo pipefail
        root=$1 uid=$2 gid=$3 role=$4; shift 4
        mount --make-rprivate /
        mount --bind "$root" "$root"
        mount -o remount,bind,ro "$root"
        for tree in srv/nightshift home run tmp; do
            mount --bind "$root/$tree" "$root/$tree"
            mount -o remount,bind,rw "$root/$tree"
        done
        # /proc is intentionally empty: nested environments may prohibit a new proc mount.
        # The test suite does not certify ps/process-inspection behavior.
        for device in null zero random urandom; do mount --bind "/dev/$device" "$root/dev/$device"; done
        exec chroot "$root" /usr/bin/setpriv --reuid "$uid" --regid "$gid" --clear-groups --no-new-privs \
            /usr/bin/env -i PATH=/usr/sbin:/usr/bin:/sbin:/bin HOME="/home/$role" \
            USER="$role" LOGNAME="$role" LANG=C.UTF-8 LC_ALL=C.UTF-8 "$@"
    ' namespace "$root" "$uid" "$gid" "$role" "$@"
