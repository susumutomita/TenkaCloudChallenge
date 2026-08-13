"""あなたが編集する唯一のファイル。

## この問題で使う仕組み (前提知識は不要)

素数 p の有限体 F_p 上の **加法的秘密分散**。 秘密 s を n 人に配り、 全員の
share を足すと s に戻る。 足りない人数では何も分からない。

    分ける: share[0..n-2] = 渡された乱数、
            share[n-1]    = (s - それまでの合計) % p
    戻す:   s = (share[0] + ... + share[n-1]) % p

数値例 (p=101, n=3, s=5, randomness=[70, 40]):

    share = [70, 40, (5 - 110) % 101] = [70, 40, 97]
    復元  = (70 + 40 + 97) % 101 = 207 % 101 = 5   OK

## 4 つの関数の役割

    share / reconstruct / rerandomize   機械的な算術。 式は下の docstring にある
    complete_shares                     この問題の主題。 式は書いていない

## どの関数にも共通の約束

  - 返す整数はすべて `% p` で 0..p-1 に正規化する。 -105 のような負の値は
    F_101 では 97 と同じ元だが、 表現が違うので落ちる。
  - 乱数は自分で作らず、 引数 `randomness` の値をそのまま使う。 自前で作ると
    走らせるたびに答えが変わり、 採点が再現できない。
  - p と n は起動ごとに変わる。 数値を書き込まず、 必ず引数から取る
    (人数は `n` / `len(shares)` / `len(partial) + 1`)。

## コードではない checkpoint がひとつある: `threshold`

`threshold` だけは Portal の回答欄に **JSON を直接書く**。 回答欄は
**1 行の入力欄** なので、 改行を入れずに 1 行で貼ること。

    {"sharesNeeded": 3, "partial": [1, 2], "completions": [{"secret": 0,
     "lastShare": 98}, {"secret": 1, "lastShare": 99}]}
    (実際には改行なしの 1 行。 上は紙面の都合で折り返しているだけ)

読みやすく折り返すと次の構造になる
(下の例は p=101, n=3 の場合。 自分の p と n は「証拠を調べる」で確認する)。

    {
      "sharesNeeded": 3,                  整数。 復元に必要な share の数 = n。
                                          t < n のしきい値ではない
      "partial": [1, 2],                  整数の配列。 長さはちょうど n-1。
                                          中身は 0..p-1 の好きな値でよい
      "completions": [                    要素ちょうど 2 個
        {"secret": 0, "lastShare": 98},   secret と lastShare の 2 キー。
        {"secret": 1, "lastShare": 99}    2 つの secret は互いに異なること
      ]
    }

合格条件は、 各 completion について
`(partial の合計 + lastShare) % p == secret` が成り立つこと。
上の 98 は `(0 - 3) % 101`、 99 は `(1 - 3) % 101` (partial の合計が 3)。
**あなたの p と n はこれとは違う**ので、 長さも数値も自分の値で作り直すこと。
とくに `partial` の長さは n-1 なので、 n=6 なら 5 個になる。 上の 2 個を
そのまま写すと落ちる。
"""

from __future__ import annotations


def share(secret: int, n: int, p: int, randomness: list[int]) -> list[int]:
    """秘密 `secret` を、合計が `secret` になる `n` 個の share に分ける。

    この関数は算術だけ。 この問題の主題は下の complete_shares のほう。

    手順:
      1. 最初の n-1 個は `randomness` の値をそのまま使う
      2. 最後の 1 個は「secret から、それまでの合計を引いた値」にする
      3. すべて 0..p-1 に正規化して、長さ n の list で返す

    式:
        share[i]   = randomness[i] % p                     (i = 0 .. n-2)
        share[n-1] = (secret - sum(share[0..n-2])) % p

    例: secret=5, n=3, p=101, randomness=[70, 40]
        head = [70, 40]、 sum(head) = 110
        share = [70, 40, (5 - 110) % 101] = [70, 40, 97]
        検算: 70 + 40 + 97 = 207 = 2*101 + 5 -> 復元すると 5

    ありがちな失敗:
      - `% p` を忘れて -105 のような負の値を返す (値は正しいのに落ちる)
      - `randomness` を使わず自前で乱数を作る (採点が再現できなくなる)
      - `randomness[:2]` のように固定長で切る (n は起動ごとに変わる)
      - party 0 に secret をそのまま渡して残りを 0 にする
        (合計は合うが、 party 0 が最初から全部知っているので分散ではない。
         出荷時の下のコードがちょうどこの形で、 だから落ちる)
    """
    return [secret] + [0] * (n - 1)


def reconstruct(shares: list[int], p: int) -> int:
    """全部そろった share から秘密を戻す。

    手順:
      1. share を全部足す
      2. `% p` して 0..p-1 の整数ひとつで返す

    式:
        secret = (shares[0] + ... + shares[len(shares)-1]) % p

    例: shares=[70, 40, 97], p=101 -> 207 % 101 = 5

    ありがちな失敗:
      - `% p` を忘れて 207 を返す (0..p-1 の外なので落ちる)
      - 人数を仮定して `shares[0] + shares[1] + shares[2]` と書く
        (人数は起動ごとに変わる)
    """
    return 0


def complete_shares(partial: list[int], secret: int, p: int) -> int:
    """n-1 個の share と、狙った秘密が与えられる。足りない最後の 1 個を返す。

    **ここがこの問題の主題**なので、式は書いていない。 代わりに、採点のしかたと
    考える順序を書く。

    何を示す関数か:
        同じ n-1 個を握ったまま、 どんな秘密に対しても辻褄の合う最後の 1 個を
        作れるなら、 その n-1 個は「秘密がどれか」を 1 つも排除していない。
        つまり n-1 個は秘密について何の証拠にもなっていない。 これが
        「n-1 個では何も分からない」の実行可能な定義になる。

    採点のしかた:
        `partial` を固定したまま、 `secret` を 0, 1, 2, ..., p-1 と
        **field の全要素**について呼び出す。 毎回、 返り値 `last` が

            (sum(partial) + last) % p == secret

        を満たすことが要求される。 1 つの secret で成功しても通らない。

    考える順序:
        1. 上の等式を書き出す。 未知数は返り値ただ 1 つ
        2. `sum(partial)` は既知の固定値。 残りを解く
        3. F_p では引き算がいつでもできるので、解は必ず存在し、しかも 1 つ

    返り値の形:
        `0 <= last < p` の整数ひとつ (list ではない)。

    ありがちな失敗:
      - `secret` をそのまま返す (partial が全部 0 のときだけ通る)
      - `partial` の長さや p を関数内に書き込む (どちらも引数から来る)
    """
    return 0


def rerandomize(shares: list[int], p: int, randomness: list[int]) -> list[int]:
    """秘密を変えずに、share を全部入れ替えた新しい分け方を返す。

    この関数も算術だけ。 実プロトコルでは、 同じ share の集合がラウンドを跨いで
    結び付けられないようにするために使う。

    手順:
      1. 人数 k を `len(shares)` から取る
      2. offset を k 個作る。 先頭 k-1 個は `randomness` から取る
      3. 最後の 1 個は「それまでの offset の合計を打ち消す値」にする。
         こうすると offset の合計が 0 になるので、秘密は動かない
      4. share と offset を 1 対 1 で足し、 `% p` して返す

    式:
        offset[i]   = randomness[i] % p                    (i = 0 .. k-2)
        offset[k-1] = (-sum(offset[0..k-2])) % p
        out[i]      = (shares[i] + offset[i]) % p

    例: shares=[70, 40, 97] (秘密 5), p=101, randomness=[3, 8]
        offset = [3, 8, (-11) % 101] = [3, 8, 90]
        offset の合計 = 3 + 8 + 90 = 101 = 0 (mod 101)
        out = [73, 48, (97 + 90) % 101] = [73, 48, 86]
        検算: (73 + 48 + 86) % 101 = 207 % 101 = 5 -> 秘密は 5 のまま
              3 個とも入力と違う値になっている

    採点は固定の期待値ではなく 2 つの関係で見る:
      (1) 復元すると秘密が変わっていない
      (2) 返した list が入力とまったく同じではない

    ありがちな失敗:
      - 全員に同じ値 r を足す (合計が n*r ずれるので秘密が動く)
      - offset を全部 0 にする (秘密は保たれるが 1 個も動かず (2) で落ちる)
      - 入力をそのまま返す (下の出荷時のコードがこれ。 だから落ちる)
    """
    return list(shares)
