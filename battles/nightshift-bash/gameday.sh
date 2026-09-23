#!/bin/bash
# Bash 3.2+ on the organizer host; Bash 5 + Linux utilities inside the image.
set -euo pipefail
umask 077
PACKAGE_ROOT=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
STATE_ROOT="$PACKAGE_ROOT/.state"
IMAGE=nightshift-bash:0.1.0
source "$PACKAGE_ROOT/host/score.sh"
source "$PACKAGE_ROOT/lib/docker.sh"

usage() {
    cat <<'HELP'
NIGHTSHIFT — Bash GameDay / 夜間バッチを守れ

./gameday.sh doctor                       Dockerと必要コマンドの確認
./gameday.sh build                        演習イメージのビルド
./gameday.sh start [team]                 新しい演習を開始（既定: team1）
./gameday.sh shell [team] [auditor]        現フェーズの権限で入る
./gameday.sh submit [team]                調査の証拠3件を採点・記録
./gameday.sh repair [team] --yes          調査得点を確定し修復フェーズへ
./gameday.sh score [team] [--json]         採点（修復中はバッチを再起動）
./gameday.sh tick [team]                  注文バッチを1回実行
./gameday.sh reboot [team]                バッチサービスの再起動（OSではない）
./gameday.sh status [team]                フェーズと最後の採点結果
./gameday.sh hint <mission:1-3> <step:1-3> 無料の段階的ヒント
./gameday.sh reset [team] --yes           全進捗を消し、新しい秘密値で作り直す
./gameday.sh down [team] --yes            この演習のコンテナと状態を削除
./gameday.sh test                        Dockerで統合テスト（専用testチーム）

調査はauditor、修復はoperator。どちらもrootではありません。
ホスト側のCLI・.state・host・tests は運営専用です。
HELP
}

command=${1:-help}; shift || true
case "$command" in
    help|-h|--help) usage; exit 0 ;;
    hint)
        [[ $# -eq 2 && $1 =~ ^[123]$ && $2 =~ ^[123]$ ]] || { usage >&2; exit 64; }
        cat "$PACKAGE_ROOT/runtime/participant/hint-$1-$2.md"
        exit 0
        ;;
    doctor)
        for utility in bash od tr cat date; do
            command -v "$utility" >/dev/null 2>&1 || { printf 'Missing: %s\n' "$utility" >&2; exit 1; }
        done
        require_docker
        docker version --format 'Docker client={{.Client.Version}} server={{.Server.Version}}'
        printf 'OK: ホスト側の依存を確認しました。イメージの実行検証は test です。\n'
        exit 0
        ;;
    build) [[ $# -eq 0 ]] || exit 64; require_docker; build_image; exit 0 ;;
    test) [[ $# -eq 0 ]] || exit 64; exec bash "$PACKAGE_ROOT/tests/run.sh" docker ;;
    start|shell|submit|repair|score|tick|reboot|status|reset|down) ;;
    *) usage >&2; exit 64 ;;
esac
TEAM=team1
if [[ $# -gt 0 && $1 != --* ]]; then TEAM=$1; shift; fi
[[ $TEAM =~ ^[a-z0-9][a-z0-9-]{0,30}$ ]] || { printf 'team は英小文字・数字・ハイフンの1〜31文字です。\n' >&2; exit 64; }
TEAM_DIR="$STATE_ROOT/$TEAM"
CONTAINER="nightshift-$TEAM"
[[ ! -L $STATE_ROOT && ! -L $TEAM_DIR ]] || { echo 'Symlink state directory refused' >&2; exit 1; }
case "$command" in
    repair|reset|down) [[ $# -eq 1 && $1 == --yes ]] || { printf '進捗の確定/破棄には --yes が必要です。\n' >&2; exit 64; } ;;
    score) [[ $# -eq 0 || ( $# -eq 1 && $1 == --json ) ]] || exit 64 ;;
    shell) [[ $# -eq 0 || ( $# -eq 1 && $1 == auditor ) ]] || exit 64 ;;
    *) [[ $# -eq 0 ]] || exit 64 ;;
esac
require_docker
if [[ $command == start || $command == reset ]]; then
    mkdir -p -- "$TEAM_DIR"
fi
[[ -d $TEAM_DIR ]] || { printf '先に ./gameday.sh start %s を実行してください。\n' "$TEAM" >&2; exit 1; }
# Portable host lock (macOS ships no flock). Never remove another live process's lock.
LOCK_DIR="$TEAM_DIR/.lock"
if ! mkdir -- "$LOCK_DIR" 2>/dev/null; then
    printf '同じチームへの操作が実行中、または中断したロックが残っています: %s\n' "$LOCK_DIR" >&2
    printf '別の操作が動いていないことを確認してから .lock を削除してください。\n' >&2
    exit 75
fi
printf '%s\n' "$$" > "$LOCK_DIR/pid"
release_lock() { if [[ -d $LOCK_DIR ]]; then rm -f -- "$LOCK_DIR/pid"; rmdir -- "$LOCK_DIR" 2>/dev/null || true; fi; }
trap release_lock EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
case "$command" in
    start) start_container ;;
    reset)
        remove_container_and_state keep-lock
        start_container
        ;;
    down) remove_container_and_state; printf '演習を削除しました: %s\n' "$TEAM" ;;
    *)
        verify_container
        case "$command" in
            shell)
                read_state "$TEAM_DIR/phase"; phase=$REPLY
                case "$phase" in audit) uid=1100; gid=1100; role=auditor ;; repair) uid=1200; gid=1400; role=operator ;; *) exit 1 ;; esac
                if [[ ${1:-} == auditor ]]; then uid=1100; gid=1100; role=auditor; fi
                [[ -t 0 && -t 1 ]] || { printf 'shell は対話ターミナルで実行してください。\n' >&2; exit 1; }
                release_lock; trap - EXIT
                exec docker exec -it --user "$uid:$gid" --workdir /srv/nightshift "$CONTAINER" \
                    /usr/bin/env -i PATH=/usr/bin:/bin HOME="/home/$role" USER="$role" LOGNAME="$role" \
                    LANG=C.UTF-8 LC_ALL=C.UTF-8 TERM="${TERM:-xterm-256color}" \
                    "PS1=[$TEAM:$role] \w \$ " /bin/bash --noprofile --norc
                ;;
            submit) record_evidence ;;
            repair)
                read_state "$TEAM_DIR/phase"
                [[ $REPLY == audit ]] || { printf 'すでに修復フェーズです。\n'; exit 0; }
                printf 'repair\n' > "$TEAM_DIR/phase"
                printf '調査得点を確定しました。新しい shell は operator で開きます。\n'
                ;;
            score) SCORE_FORMAT=text; [[ ${1:-} != --json ]] || SCORE_FORMAT=json; collect_score ;;
            tick) lab_exec 0 /bin/bash /opt/nightshift/control.sh tick ;;
            reboot) lab_exec 0 /bin/bash /opt/nightshift/control.sh restart; printf 'バッチサービスを再起動しました。\n' ;;
            status)
                read_state "$TEAM_DIR/phase"; printf 'team=%s phase=%s\n' "$TEAM" "$REPLY"
                if [[ -f $TEAM_DIR/score.json ]]; then cat "$TEAM_DIR/score.json"; else printf '未採点\n'; fi
                ;;
        esac
        ;;
esac
