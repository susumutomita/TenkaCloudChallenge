#!/bin/bash
# Library loaded by gameday.sh. lab_exec is supplied by the trusted host backend.
random_hex() {
    od -An -N16 -tx1 /dev/urandom | tr -d ' \n'
}

read_state() {
    local file=$1
    [[ -f $file && ! -L $file ]] || { printf 'Missing/unsafe state: %s\n' "$file" >&2; return 1; }
    IFS= read -r REPLY < "$file"
}

record_evidence() {
    read_state "$TEAM_DIR/phase"
    [[ $REPLY == audit ]] || { printf '調査得点は修復開始時に確定済みです。\n' >&2; return 1; }
    local expected actual uid checkpoint
    for checkpoint in leak path startup; do
        case "$checkpoint" in
            leak)
                read_state "$TEAM_DIR/settlement-key"; expected=$REPLY
                actual=$(lab_exec 1100 /usr/bin/timeout --kill-after=1 3 /usr/bin/head -c 128 /srv/nightshift/submissions/leak.txt 2>/dev/null) || actual=''
                ;;
            path)
                read_state "$TEAM_DIR/proof-token"; expected=$REPLY
                actual=$(lab_exec 1300 /usr/bin/timeout --kill-after=1 3 /bin/bash -c '[[ -f /srv/nightshift/evidence/path.txt && ! -L /srv/nightshift/evidence/path.txt ]] && /usr/bin/head -c 128 /srv/nightshift/evidence/path.txt' 2>/dev/null) || actual=''
                uid=$(lab_exec 1300 /usr/bin/timeout --kill-after=1 3 /usr/bin/stat -c '%u' /srv/nightshift/evidence/path.txt 2>/dev/null) || uid=''
                [[ $uid == 1300 ]] || actual=''
                ;;
            startup)
                expected=/srv/nightshift/app/startup.d/40-compat.sh
                actual=$(lab_exec 1100 /usr/bin/timeout --kill-after=1 3 /usr/bin/head -c 128 /srv/nightshift/submissions/startup.txt 2>/dev/null) || actual=''
                ;;
        esac
        if [[ $actual == "$expected" && -n $expected ]]; then
            printf '100\n' > "$TEAM_DIR/discovery-$checkpoint"
            printf '[PASS] %-8s 100 / 100\n' "$checkpoint"
        elif [[ -f $TEAM_DIR/discovery-$checkpoint ]]; then
            printf '[PASS] %-8s 100 / 100 (記録済み)\n' "$checkpoint"
        else
            printf '[----] %-8s   0 / 100\n' "$checkpoint"
        fi
    done
}

collect_score() {
    local discovery=0 name value phase expected output nonce
    for name in leak path startup; do
        if [[ -f $TEAM_DIR/discovery-$name ]]; then
            read_state "$TEAM_DIR/discovery-$name"
            [[ $REPLY == 100 ]] || { echo 'Invalid score state' >&2; return 1; }
            discovery=$((discovery + 100))
        fi
    done
    read_state "$TEAM_DIR/phase"; phase=$REPLY
    before_backup=0; before_path=0; restart_ok=0; backup=0; path=0; durable=0
    normal=0; duplicate=0; invalid=0
    if [[ $phase == repair ]]; then
        read_state "$TEAM_DIR/settlement-key"; expected=$REPLY
        [[ $expected =~ ^[a-f0-9]{32}$ ]] || return 1
        nonce=$(random_hex)
        output=$({
            printf 'EXPECTED_KEY=%q\nCHECK_NONCE=%q\n' "$expected" "$nonce"
            cat "$PACKAGE_ROOT/host/check-state.sh"
        } | lab_exec 0 /usr/bin/timeout --kill-after=1 45 /usr/bin/flock --close -w 12 /run/nightshift/service.lock /bin/bash --noprofile --norc -s) || {
            printf '採点器が完走しませんでした。得点記録は更新していません。\n' >&2; return 1;
        }
        [[ $output =~ ^[01](,[01]){8}$ ]] || { printf 'Invalid verifier output; no score recorded.\n' >&2; return 1; }
        IFS=, read -r before_backup before_path restart_ok backup path durable normal duplicate invalid <<< "$output"
    elif [[ $phase != audit ]]; then
        printf 'Invalid phase\n' >&2; return 1
    fi
    local service_ok=$((normal * duplicate * invalid))
    local repair_points=$((150 * backup * service_ok + 150 * path * service_ok + 100 * durable))
    local service_points=$((100 * normal + 100 * duplicate + 100 * invalid))
    local total=$((discovery + repair_points + service_points))
    # Only the organizer's host stores this result. Never trust a participant score file.
    SCORE_JSON=$(printf '{"schemaVersion":1,"team":"%s","phase":"%s","score":%s,"maxScore":1000,"discovery":%s,"repair":%s,"service":%s,"checks":{"backupBeforeRestart":%s,"pathBeforeRestart":%s,"restart":%s,"backupProtected":%s,"pathProtected":%s,"durable":%s,"validOrders":%s,"deduplication":%s,"invalidRejected":%s}}' \
        "$TEAM" "$phase" "$total" "$discovery" "$repair_points" "$service_points" \
        "$before_backup" "$before_path" "$restart_ok" "$backup" "$path" "$durable" "$normal" "$duplicate" "$invalid")
    printf '%s\n' "$SCORE_JSON" > "$TEAM_DIR/score.json.tmp"
    mv -- "$TEAM_DIR/score.json.tmp" "$TEAM_DIR/score.json"
    printf '{"recordedAt":"%s","result":%s}\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$SCORE_JSON" >> "$TEAM_DIR/history.jsonl"
    if [[ ${SCORE_FORMAT:-text} == json ]]; then printf '%s\n' "$SCORE_JSON"; return 0; fi
    printf '\nNIGHTSHIFT / %s / %s\n' "$TEAM" "$phase"
    printf 'TOTAL       %4d / 1000\n' "$total"
    printf '発見・実証   %4d /  300\n' "$discovery"
    printf '安全な修復   %4d /  400\n' "$repair_points"
    printf '正常な処理   %4d /  300\n\n' "$service_points"
    if [[ $phase == audit ]]; then
        printf '調査フェーズです。修復・正常処理の採点は repair 後に有効になります。\n'
    else
        printf '再起動後: バックアップ=%s / コマンド差し替え防止=%s / 再発防止=%s\n' "$backup" "$path" "$durable"
        printf '注文=%s / 重複防止=%s / 不正入力の拒否=%s (1=PASS、0=FAIL)\n' "$normal" "$duplicate" "$invalid"
        if (( before_backup > backup || before_path > path )); then
            printf '注意: 再起動前の修復が、再起動後に失われています。\n'
        fi
    fi
}
