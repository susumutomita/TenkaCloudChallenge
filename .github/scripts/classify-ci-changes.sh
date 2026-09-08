#!/usr/bin/env bash
# Read repository-relative changed paths. Catalog validation always runs.
set -euo pipefail
battle=false
capacity=false
while IFS= read -r path; do
  case "$path" in
    battles/ac26-crypto-battle/*)
      battle=true ;;
  esac
  case "$path" in
    battles/ac26-crypto-battle/metadata.json|battles/ac26-crypto-battle/game/src/*|battles/ac26-crypto-battle/game/package.json|battles/ac26-crypto-battle/game/bun.lock*|battles/ac26-crypto-battle/game/tsconfig*.json)
      capacity=true ;;
  esac
done
printf 'battle=%s\ncapacity=%s\n' "$battle" "$capacity"
