#!/bin/bash
require_docker() {
    command -v docker >/dev/null 2>&1 || { printf 'Docker Engine / Docker Desktop を先に起動してください。\n' >&2; return 1; }
    docker info >/dev/null 2>&1 || { printf 'Docker daemon に接続できません。\n' >&2; return 1; }
}

verify_container() {
    read_state "$TEAM_DIR/session"; local expected=$REPLY actual
    [[ $expected =~ ^[a-f0-9]{32}$ ]] || return 1
    actual=$(docker inspect --format '{{ index .Config.Labels "org.tenkacloud.nightshift.session" }}' "$CONTAINER" 2>/dev/null) || {
        printf '対象コンテナがありません。start / reset を確認してください。\n' >&2; return 1;
    }
    [[ $actual == "$expected" ]] || { printf '所有ラベルが一致しないため操作を拒否しました。\n' >&2; return 1; }
}

lab_exec() {
    local uid=$1 gid home role; shift
    case "$uid" in
        0) gid=0; home=/root; role=root ;;
        1100) gid=1100; home=/home/auditor; role=auditor ;;
        1200) gid=1400; home=/home/operator; role=operator ;;
        1300) gid=1400; home=/home/batch; role=batch ;;
        *) return 64 ;;
    esac
    docker exec -i --user "$uid:$gid" "$CONTAINER" \
        /usr/bin/env -i PATH=/usr/sbin:/usr/bin:/sbin:/bin HOME="$home" USER="$role" LOGNAME="$role" \
        LANG=C.UTF-8 LC_ALL=C.UTF-8 "$@"
}

build_image() {
    docker build --label org.tenkacloud.nightshift.image=1 --tag "$IMAGE" "$PACKAGE_ROOT"
}

start_container() {
    local session key proof interval=${NIGHTSHIFT_INTERVAL:-5}
    [[ $interval =~ ^[0-9]+$ && ${#interval} -le 3 ]] || { echo 'Invalid NIGHTSHIFT_INTERVAL' >&2; return 64; }
    interval=$((10#$interval))
    if docker inspect "$CONTAINER" >/dev/null 2>&1; then
        verify_container
        printf '同名の演習が存在します。shell / score を使うか reset --yes してください。\n' >&2
        return 1
    fi
    [[ ! -f $TEAM_DIR/session ]] || { printf '前の状態が残っています。reset --yes を使ってください。\n' >&2; return 1; }
    docker image inspect "$IMAGE" >/dev/null 2>&1 || build_image
    session=$(random_hex); key=$(random_hex); proof=$(random_hex)
    printf '%s\n' "$session" > "$TEAM_DIR/session"
    printf '%s\n' "$key" > "$TEAM_DIR/settlement-key"
    printf '%s\n' "$proof" > "$TEAM_DIR/proof-token"
    printf 'audit\n' > "$TEAM_DIR/phase"
    # No host bind mounts, no published ports, no Docker socket, no external network.
    # Only the disposable application/home/run/tmp trees are writable.
    if ! docker run -d --name "$CONTAINER" \
        --label "org.tenkacloud.nightshift.session=$session" \
        --network none --read-only --security-opt no-new-privileges:true \
        --cap-drop ALL --cap-add CHOWN --cap-add DAC_OVERRIDE --cap-add FOWNER \
        --cap-add SETUID --cap-add SETGID --cap-add KILL \
        --pids-limit 96 --memory 256m --memory-swap 256m --cpus 1 \
        --ulimit nofile=256:256 --ulimit fsize=16777216:16777216 \
        --tmpfs /srv/nightshift:rw,nosuid,nodev,size=32m,mode=0755 \
        --tmpfs /home:rw,nosuid,nodev,size=16m,mode=0755 \
        --tmpfs /run:rw,nosuid,nodev,noexec,size=8m,mode=0755 \
        --tmpfs /tmp:rw,nosuid,nodev,noexec,size=8m,mode=1777 \
        --env "NIGHTSHIFT_INTERVAL=$interval" "$IMAGE" >/dev/null; then
        printf '起動に失敗しました。reset %s --yes で状態を消して再試行してください。\n' "$TEAM" >&2
        return 1
    fi
    local attempt ready=0
    for attempt in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20; do
        if lab_exec 0 /usr/bin/test -d /run/nightshift 2>/dev/null; then ready=1; break; fi
        sleep 0.2
    done
    (( ready )) || { printf 'Supervisor did not initialize. Inspect container logs.\n' >&2; return 1; }
    if ! printf '%s\n%s\n%s\n' "$session" "$key" "$proof" \
        | lab_exec 0 /bin/bash /opt/nightshift/control.sh init >/dev/null; then
        printf '初期化に失敗しました。docker logs %s を確認してください。\n' "$CONTAINER" >&2
        return 1
    fi
    printf '演習を開始しました: %s (調査フェーズ)\n' "$TEAM"
    printf '  ./gameday.sh shell %s\n' "$TEAM"
    printf '  コンテナ内で cat /srv/nightshift/START-HERE.md\n'
}

remove_container_and_state() {
    local preserve_lock=${1:-no}
    if docker inspect "$CONTAINER" >/dev/null 2>&1; then
        verify_container
        docker rm -f "$CONTAINER" >/dev/null
    fi
    # TEAM was validated before this function. Never remove arbitrary paths.
    [[ $TEAM_DIR == "$STATE_ROOT/$TEAM" && -n $TEAM && ! -L $TEAM_DIR ]] || return 1
    if [[ $preserve_lock == keep-lock ]]; then
        # Keep the lock throughout reset; do not open a second-start race.
        local file
        for file in "$TEAM_DIR"/*; do
            [[ -e $file || -L $file ]] || continue
            rm -rf -- "$file"
        done
    else
        rm -rf -- "$TEAM_DIR"
    fi
}
