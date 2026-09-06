#!/bin/sh
set -eu
portal_root=${1:?usage: run.sh /absolute/path/to/TenkaCloud}
script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
AC26_PROBLEM_ROOT=$(CDPATH= cd -- "$script_dir/../../../.." && pwd)
export AC26_PROBLEM_ROOT
component_dir="$portal_root/apps/participant-portal/src/components"
scratch_dir=$(mktemp -d "${TMPDIR:-/tmp}/Ac26LinearSharesAcceptance.XXXXXX")
test_path="$component_dir/$(basename "$scratch_dir").test.tsx"
if ! (set -C; : > "$test_path"); then
    rmdir "$scratch_dir"
    exit 1
fi
trap 'rm -f "$test_path"; rmdir "$scratch_dir"' EXIT HUP INT TERM
cp "$script_dir/acceptance.test.tsx" "$test_path"
cd "$portal_root/apps/participant-portal"
bun run test "src/components/$(basename "$test_path")"
