"""あなたが編集する唯一のファイル。

3 つのチームが、同じ「秘密のリスクスコア」を計算するプロトコルを実装した。
**3 つとも正しい合計を出す**。 1 つは問題なく、残りは違う。 差は答えではなく、
**計算の途中で何が外から見えたか** にある。 あなたはその監査ツールを書く。

## 語彙 1: 仕様 (spec) — 監査ツールに渡される辞書

秘密の値は入っていない。 キーは次の 5 つで、 すべて必ずある。

    "p"             int        法 (素数)
    "parties"       list[str]  参加者の id  (例: ["p0", "p1", "p2"])
    "publicInputs"  list[str]  最初から公開されている値の label
    "masked"        list[str]  一度きりのマスクで覆われた値の label
    "result"        str        宣言された結果の label  (**文字列ひとつ。 list ではない**)

## 語彙 2: 開示してよいもの (allowed)

    allowed = publicInputs ∪ masked ∪ {result}

3 つとも理由が違う。 publicInputs はもともと公開。 masked は一度きりのマスクで
覆われているので元の秘密を語らない。 result は出すと宣言したもの。
**それ以外の label はすべて中間の秘密** で、 開けたら over-opening。

## 語彙 3: 実行の記録 (trace) — 外から観測できた出来事の列

ローカルな算術は event を 1 つも出さない。 プロトコルは「どれだけ計算したか」
ではなく「何を見せたか」で判定される。 各 event は次のキーを **必ず全部持つ**
辞書 (使わないキーは "" か 0 が入っている)。

    "kind"   str   "open" | "peek" | "emit" | "fail" | "output"
    "label"  str   その出来事が触れた値の名前   (peek では "")
    "party"  str   読んだ人                     (peek のみ)
    "owner"  str   読まれた側                   (peek のみ)
    "text"   str   ログ / エラーの文言          (emit / fail のみ)
    "value"  int   実際に漏れた数値

    open    その label の値が全員に見えた
    peek    party が owner の生の share 領域を読んだ
    emit    その label の値を含むログ行が出た
    fail    その label の値を含むエラーメッセージが出た
    output  宣言された結果が出力された

## 語彙 4: transcript — 開示された値の列

`derive_secret` に渡される。 各要素は `{"label": str, "value": int}` の 2 キー
だけを持つ辞書。 event とは形が違うので注意。

## 語彙 5: program — 操作のタプルの list (`repair` にだけ渡される)

Python のソースではない。 取りうる形はこの 10 種類がすべて。

    ("share",  label, owner)      owner の秘密が label という share になる
    ("const",  label, value)      公開定数
    ("mask",   out, val, msk)     out = val - msk   (ローカル、何も漏れない)
    ("scale",  out, val, k)       out = val * k     (k は公開、ローカル)
    ("addsh",  out, x, y)         out = x + y       (ローカル)
    ("open",   label)             label の値が全員に見える
    ("peek",   party, owner)      party が owner の生の share 領域を読む
    ("emit",   label, text)       label の値を含むログ行
    ("fail",   label, text)       label の値を含むエラーメッセージ
    ("output", label)             宣言された結果の出力

## 採点の共通の性質

どの checkpoint も、 **漏れる実行と漏れない実行を混ぜて**採点する。 しかも
「漏れない」側はいちばん紛らわしいもの —— 仕様が公開すると宣言した値を載せた
ログ行と、 自分自身の領域を読んだ party —— を含む。 **これらを違反だと言うのは、
本物の漏れを見逃すのと同じ重さの誤り**として扱われる。

なお label 名は deploy ごとに変わり、 mutation checkpoint では全部改名され、
独立な開示は並べ替えられる。 判定に使ってよいのは 3 つだけ:
`kind`、 `label` が allowed に入るか、 `party` と `owner` が一致するか。
文字列の中身・出現位置・event の個数を使うと mutation で落ちる。

この問題に、 JSON を手入力する checkpoint は無い。 4 つとも関数を書く。
"""

from __future__ import annotations

VIOLATIONS = (
    "opened-a-secret",
    "cross-party-read",
    "leaked-in-log",
    "leaked-in-error",
)


def allowed_opens(spec: dict) -> list[str]:
    """このプロトコルが外に見せてよい label を、ソート済みの list で返す。

    監査の土台。 ここが 1 つでもずれると、以降の 3 つが全部ずれる。

    手順:
      1. `spec["publicInputs"]` の全要素を集合に入れる
      2. `spec["masked"]` の全要素を同じ集合に入れる
      3. `spec["result"]` を **1 個の要素として** 入れる
      4. `sorted(...)` で list にして返す

    返り値の形:
        文字列の list、ソート済み。 set ではない。

    例: spec の publicInputs=["weight-p0","weight-p1","weight-p2"]、
        masked=["masked-p0","masked-p1","masked-p2"]、 result="total" のとき

        ["masked-p0", "masked-p1", "masked-p2", "total",
         "weight-p0", "weight-p1", "weight-p2"]

    ありがちな失敗:
      - `result` を list として扱い、`extend` して 1 文字ずつばらけさせる
        (文字列ひとつなので、要素として 1 個入れる)
      - label 名を関数内に書き込む (deploy ごとに変わる)
      - ソートせずに返す
    """
    return []


def first_violation(trace: list[dict], spec: dict) -> dict | None:
    """最初に何かを漏らした event を返す。漏れていなければ None。

    **ここがこの問題の主題**なので、判定規則は書いていない。 代わりに、
    採点のしかたと考える順序を書く。

    返り値の形:
        漏れているとき  {"kind": <VIOLATIONS のどれか>, "index": <trace 内の位置>}
        漏れていないとき  None

        `index` は trace 全体での位置 (`enumerate` の添字)。 違反だけを数えた
        番号ではない。 「first」なので、先頭から見て最初に当たったところで止める。

    採点のしかた:
        漏れる実行と漏れない実行が混ぜて渡される。
        (1) 漏れる実行で None を返すと落ちる
        (2) 漏れない実行で dict を返すと落ちる ((1) と同じ重さ)
        (3) 種類が違うと落ちる
        (4) 位置が違うと落ちる —— 「何か漏れた」とだけ言う監査ツールは
            何も局在化していないため

    考える順序:
        1. event の 5 つの kind のうち、どれが「外から観測できた開示」か
        2. その kind ごとに、**それが違反かどうかを分ける条件**は何か。
           kind だけでは決まらない —— 同じ kind で違反にならない場合がある
        3. 混ぜられている「紛らわしいが問題ない」実行を 2 つ思い出す
           (公開値を載せたログ行 / 自分の領域を読んだ party)。 その 2 つを
           違反にしない条件を、判定に組み込む
        4. VIOLATIONS の 4 つの名前と、event の kind の対応をつける

    ありがちな失敗:
      - ログ行を無条件に違反にする (公開値を載せただけの実行で落ちる)
      - share の読み取りを無条件に違反にする (自分の領域を読んだだけで落ちる)
      - `output` を違反にする (宣言された結果)
      - 最初ではなく最後の違反を返す
      - `event["text"]` の文言 ("debug: share" など) で判定する。
        文言はいくらでも変えられるので、判定基準にならない
    """
    return {"kind": "opened-a-secret", "index": 0}


def derive_secret(transcript: list[dict], spec: dict) -> dict:
    """開けすぎた transcript から、誰かの私的な値を実際に復元する。

    「開けすぎだ」と指摘するのと、「その結果この人の値がこうなる」と見せるのは、
    説得力がまったく違う。 ここは後者を要求する checkpoint。

    渡される transcript には 3 種類が混ざっている:
      (1) 仕様が許す開示、 (2) **許していない余計な開示**、 (3) 最終結果。
    (2) は「途中の部分和」で、参加者の一部ぶんだけを合計した値。

    採点のしかた:
        `party` が実在の参加者 id で、かつ `value` がその参加者の私的な値と
        **完全に一致**することを要求する。 どちらかが違えば落ちる。

    考える順序:
        1. transcript を label -> 値の辞書にする
        2. その label のうち、allowed に入っていないものを探す (それが (2))
        3. 最終結果から部分和を引くと、部分和に含まれていなかった参加者の
           **重み付き寄与**が残る
        4. 重みは公開値 (`publicInputs` にある) で、その数値も transcript に出ている
        5. p は素数なので重みには逆元がある (`pow(weight, -1, p)`)。 割り戻す

    どの参加者か: `spec["parties"]` の末尾と `spec["publicInputs"]` の末尾が
    対応している。

    返り値の形:
        {"party": <参加者 id の文字列>, "value": <0..p-1 の整数>}

    ありがちな失敗:
      - 重みで割り戻さず、`total - partial` をそのまま value にする
        (それは「重み × 私的な値」であって、私的な値ではない)
      - label 名を書き込む (deploy ごとに変わる)
    """
    return {}


def repair(program: list, spec: dict) -> list:
    """同じ合計を出しつつ、漏れないプログラムを返す。

    修理は **足す** のではなく **削る** 操作。 違反しているちょうどその操作だけを
    取り除き、それ以外は順序も含めてそのまま残す。

    採点のしかた (3 つとも満たす必要がある):
        (1) 直した後も同じ正しい合計を出す
        (2) もう漏れない
        (3) **仕様が許している開示は全部残っている**
            —— (3) が無いと「プロトコルを全部消す」が最強の修理になってしまう。
            何も実行しなければ何も漏れないが、それは修理ではない。

    考える順序:
        1. 10 種類の操作のうち、event を出す (= 外から見える) のはどれか。
           冒頭の表を見ると 5 種類しかない
        2. そのうち、`first_violation` で違反と判定したものと同じ条件に当たる
           操作だけを取り除く
        3. ローカルな算術 (`share` / `const` / `mask` / `scale` / `addsh`) は
           event を出さないので漏れない。 削ると合計が出なくなる
        4. `output` を削ると (1) で落ちる。 合法な `open` を削ると (3) で落ちる

    タプルの読み方 (冒頭の表を参照):
        `op[0]` が kind。 それ以降の位置は形ごとに違う。
        `open` / `output` は `op[1]` が label。
        `peek` は `op[1]` が読んだ人、`op[2]` が読まれた側。
        `emit` / `fail` は `op[1]` が label、`op[2]` が文言。

    返り値の形:
        同じ形の操作タプルの list。 順序は変えない。

    ありがちな失敗:
      - 合法な `open` まで消す ((3) で落ちる)
      - `output` を消す ((1) で落ちる)
      - ローカルな算術を消す (合計が出なくなる)
      - 操作を並べ替える
    """
    return list(program)
