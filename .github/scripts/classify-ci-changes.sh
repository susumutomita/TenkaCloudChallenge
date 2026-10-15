#!/usr/bin/env bash
# Read repository-relative changed paths. Catalog validation always runs.
set -euo pipefail
battle=false
capacity=false
while IFS= read -r path; do
  case "$path" in
    .github/workflows/ci.yml|.github/scripts/classify-ci-changes*|battles/crypto-battle/*)
      battle=true ;;
  esac
  case "$path" in
    .github/workflows/ci.yml|.github/scripts/classify-ci-changes*|battles/crypto-battle/metadata.json|battles/crypto-battle/game/src/*|battles/crypto-battle/game/package.json|battles/crypto-battle/game/bun.lock*|battles/crypto-battle/game/tsconfig*.json)
      capacity=true ;;
  esac
done
printf 'battle=%s\ncapacity=%s\n' "$battle" "$capacity"
