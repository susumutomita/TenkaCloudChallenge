#!/bin/bash
# Linux test support only. Copies tools into a throwaway root; no host user changes.
set -euo pipefail
umask 022
[[ $# -eq 2 && $EUID -eq 0 ]] || { echo 'usage (Linux root): build-rootfs.sh PACKAGE_ROOT EMPTY_ROOTFS' >&2; exit 64; }
package=$1 root=$2
[[ -d $root && ! -L $root && ! -e $root/etc ]] || exit 1
mkdir -p "$root"/{bin,usr/bin,usr/sbin,etc,proc,dev,srv/nightshift,run/nightshift,home,tmp,opt/nightshift}
chmod 0755 "$root"
copy_file() {
    local source=$1
    mkdir -p -- "$root$(dirname -- "$source")"
    cp -L -- "$source" "$root$source"
}
for name in bash env setpriv timeout flock install cp chown find chmod cat grep sha256sum head stat rm mv mkdir rmdir sleep date od tr id ls sed awk ps sort touch tail wc ln readlink test cut base64 uname true false tee cmp printf basename dirname; do
    binary=$(command -v "$name")
    [[ $binary == /* ]] || binary="/usr/bin/$name"
    [[ -x $binary ]] || { echo "Missing $name" >&2; exit 1; }
    copy_file "$binary"
    while IFS= read -r library; do
        [[ -f $library ]] && copy_file "$library"
    done < <(ldd "$binary" 2>/dev/null | awk '{for(i=1;i<=NF;i++) if ($i ~ /^\//) print $i}')
    # Runtime deliberately uses fixed trusted paths, independent of host usr-merge.
    if [[ -f $root/usr/bin/$name && ! -e $root/bin/$name ]]; then ln -s "/usr/bin/$name" "$root/bin/$name"; fi
    if [[ -f $root/bin/$name && ! -e $root/usr/bin/$name ]]; then ln -s "/bin/$name" "$root/usr/bin/$name"; fi
done
if [[ -d /usr/lib/locale/C.utf8 ]]; then
    mkdir -p "$root/usr/lib/locale"
    cp -R /usr/lib/locale/C.utf8 "$root/usr/lib/locale/"
fi
cp -R "$package/runtime/." "$root/opt/nightshift/"
chmod -R a+rX "$root/opt/nightshift"
printf 'nightshift-v1\n' > "$root/etc/nightshift-image"
printf 'root:x:0:0:root:/root:/bin/bash\nauditor:x:1100:1100:auditor:/home/auditor:/bin/bash\noperator:x:1200:1400:operator:/home/operator:/bin/bash\nbatch:x:1300:1400:batch:/home/batch:/bin/bash\n' > "$root/etc/passwd"
printf 'root:x:0:\nauditor:x:1100:\nworkload:x:1400:operator,batch\n' > "$root/etc/group"
printf 'passwd: files\ngroup: files\nhosts: files\n' > "$root/etc/nsswitch.conf"
for device in null zero random urandom; do touch "$root/dev/$device"; done
ln -s /proc/self/fd "$root/dev/fd"
ln -s /proc/self/fd/0 "$root/dev/stdin"
ln -s /proc/self/fd/1 "$root/dev/stdout"
ln -s /proc/self/fd/2 "$root/dev/stderr"
chmod 1777 "$root/tmp"
printf 'owned-by-nightshift-tests\n' > "$root/.nightshift-test-root"
