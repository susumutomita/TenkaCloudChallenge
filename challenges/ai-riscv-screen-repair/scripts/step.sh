#!/usr/bin/env sh
# One stage at a time.
#
# `make test` reports all three defect classes at once, which is the right
# shape for the grader and the wrong shape for learning: a beginner faces three
# unfamiliar failures simultaneously and cannot tell which change caused which
# movement. This wrapper shows only the FIRST unsolved stage, so there is always
# exactly one thing to understand and one value to change.
#
# It parses the simulation's own output. It adds no new checks and cannot pass a
# stage `make test` would fail.
set -eu

out="$(cat)"

stage() {
  printf '\n════ ステージ %s / 3 : %s\n\n' "$1" "$2"
  printf '  いま起きていること\n    %s\n\n' "$3"
  printf '  直す値\n    %s\n\n' "$4"
  printf '  読む場所\n    %s\n\n' "$5"
  printf '  なぜそうなるか\n    %s\n\n' "$6"
  printf '  直したら  make step\n\n'
}

line() { printf '%s\n' "$out" | grep -F "$1" | head -1; }

if printf '%s\n' "$out" | grep -q "CDC_ASSERT_FAIL"; then
  stage 1 "ふたつの時計をまたぐ" \
    "$(line CDC_ASSERT_FAIL)
    request が ack になるまで pixel 側で 2 edge しかかかっていない。設計は 3 以上を要求している。" \
    ".CDC_SYNC_STAGES  — 受け取り側で何段うけわたすか" \
    "artifacts/architecture.md の「CDC contract」。段数がそのまま書いてある。" \
    "CPU 側と画面側は別々の時計で動き、速さも揃っていない。信号が変わる
    ちょうどその瞬間に読むと、0 でも 1 でもない中途半端な値をつかむ。
    1 段だと、そのつかんだ段の値をそのまま次で使ってしまう。落ち着く
    ための段をもう一段はさむのが定石で、その段数だけ ack が遅れる。
    観測された edge 数が、まさにその段数を映している。"
  exit 1
fi

if printf '%s\n' "$out" | grep -q "TIMING_ASSERT_FAIL"; then
  stage 2 "0 から数える" \
    "$(line TIMING_ASSERT_FAIL)
    1 フレームが 352 clock であるべきところ、足りていない。" \
    ".H_TOTAL_ADJUST と .V_TOTAL_ADJUST  — 数え終わりの位置のずれ" \
    "artifacts/architecture.md の表「Exclusive total」と、その下の h_count / v_count の範囲。" \
    "22 個ならんだものに 0 から番号をふると、最後の番号は 21 になる。
    個数は 22、最後の番号は 21。この 1 の差を取りちがえると、1 行が
    1 clock ずつ短くなり、行数ぶん積み上がってフレーム全体が縮む。
    表にあるのは「個数」。カウンタが必要とするのは「最後の番号」。
    ADJUST はそのズレを足し引きする値で、表の数え方が正しければ
    ズラす必要はない。"
  exit 1
fi

if printf '%s\n' "$out" | grep -q "WRITE_STROBE_ASSERT_FAIL"; then
  stage 3 "4 つのうち 1 つだけ書く" \
    "$(line WRITE_STROBE_ASSERT_FAIL)
    192 画素のうち 144 画素が壊れている。書いた覚えのない画素まで変わっている。" \
    ".RESPECT_WRITE_STROBES  — どのバイトを書くかの指定を守るか" \
    "artifacts/memory-map.md の FRAMEBUFFER の段落。data_wstrb の扱いが書いてある。" \
    "CPU は 4 バイトをまとめて 1 回で書く。だが firmware は 1 画素ずつ
    塗るので、4 バイトのうち 1 バイトだけ変えたい。どれを変えるかは
    4 本の strobe 信号で指定される。これを無視して 4 バイトまとめて
    上書きすると、となりの 3 画素が巻きぞえで消える。壊れた画素が
    ちょうど 4 分の 3 なのはそのため。"
  exit 1
fi

if printf '%s\n' "$out" | grep -q "SIM_PASS"; then
  printf '\n════ 3 / 3 完了\n\n'
  line SIM_PASS | sed 's/^/  /'
  line FRAME_SHA256 | sed 's/^/  /'
  printf '\n  ポータルには VERIFY と入力する。\n\n'
  exit 0
fi

printf '%s\n' "$out"
printf '\nassertion も SIM_PASS も出ていない。上の出力を確認する。\n'
exit 1
