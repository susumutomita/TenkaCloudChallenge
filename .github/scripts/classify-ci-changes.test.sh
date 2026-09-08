#!/usr/bin/env bash
set -euo pipefail
classifier="$(dirname "$0")/classify-ci-changes.sh"
check() {
  local expected="$1"
  shift
  local actual
  actual=$(printf '%s\n' "$@" | bash "$classifier")
  if [[ "$actual" != "$expected" ]]; then
    printf 'Unexpected CI routing: %s\n' "$actual" >&2
    exit 1
  fi
}
check $'battle=false\ncapacity=false' challenges/ac26-w3-nonce-reuse/local/participant/worker.py
check $'battle=false\ncapacity=false' README.md .github/workflows/ci.yml
check $'battle=false\ncapacity=false'
check $'battle=true\ncapacity=false' battles/ac26-crypto-battle/dev/src/App.tsx
check $'battle=true\ncapacity=true' battles/ac26-crypto-battle/game/src/reducer.ts
check $'battle=true\ncapacity=true' battles/ac26-crypto-battle/game/src/state-size.test.ts
check $'battle=true\ncapacity=true' battles/ac26-crypto-battle/game/bun.lock
check $'battle=true\ncapacity=true' challenges/example/metadata.json battles/ac26-crypto-battle/game/package.json
check $'battle=true\ncapacity=false' battles/ac26-crypto-battle/portal/StatusPanel.tsx
check $'battle=true\ncapacity=false' battles/ac26-crypto-battle/coordination/crypto-battle.ts
check $'battle=true\ncapacity=true' battles/ac26-crypto-battle/metadata.json
printf 'CI path routing: 11 cases passed\n'

# A move out of the Battle tree must retain the deleted source in both diff modes.
fixture=$(mktemp -d)
trap 'rm -rf "$fixture"' EXIT
git -C "$fixture" init -q
git -C "$fixture" config user.name 'CI routing test'
git -C "$fixture" config user.email 'ci@example.invalid'
mkdir -p "$fixture/battles/ac26-crypto-battle/game/src"
printf 'export const example = 1;\n' > "$fixture/battles/ac26-crypto-battle/game/src/example.ts"
git -C "$fixture" add .
git -C "$fixture" commit -qm 'Initial Battle source'
base=$(git -C "$fixture" rev-parse HEAD)
mkdir -p "$fixture/archive"
git -C "$fixture" mv battles/ac26-crypto-battle/game/src/example.ts archive/example.ts
git -C "$fixture" commit -qm 'Move source outside Battle'
for range in "$base...HEAD" "$base..HEAD"; do
  actual=$(git -C "$fixture" diff --no-renames --name-only "$range" | bash "$classifier")
  [[ "$actual" == $'battle=true\ncapacity=true' ]] || exit 1
done
printf 'CI rename routing: PR and push cases passed\n'
