"""あなたが編集する唯一のファイル。

複数の組織が、 それぞれ **インシデント件数 count** と **深刻度 severity** を
持っている。 どちらも外に出したくない。 全員が欲しいのは合計スコアだけ。

    score = sum_i (count_i * severity_i) + bias        (bias は公開、 mod p)

新しい概念は無い。 前の 3 問で作った部品を組み立てる。

    秘密の分割         各組織の 2 つの数字は、すでに share の形で配られている
    公開定数の足し算   bias を足すのは 1 人だけ (linear-shares の規則)
    Beaver 掛け算      count_i * severity_i は両方の因子が秘密。 組織ごとに 1 回

新しいのは **コスト** の見方だけ。

## 語彙 1: spec — `plan` と `aggregate` が受け取る辞書

    "p"        int   法 (素数)
    "parties"  int   **組織の数。 list ではなく整数**。 share の本数も同じ数
    "bias"     int   公開されている加算定数

`spec["parties"]` は整数なので `len()` は使えない。 share の list に対しては
`len(sharing)` が使える。

## 語彙 2: aggregate が受け取るもの

    counts[i]        組織 i の count の share      (長さ n の list)
    severities[i]    組織 i の severity の share   (長さ n の list)
    triple_list[i]   {"a": [...], "b": [...], "c": [...]}   c = a*b。 3 つとも share
    spec             上記の辞書
    io               開示の唯一の窓口 (下記)

## 語彙 3: io — 開示できる唯一の手段

    io.open_batch(sharings: list[list[int]]) -> list[int]

渡した share を **全部まとめて開示** し、 対応する値を **同じ順序で** 返す。
そして **1 回の呼び出しが 1 ラウンド** として数えられる。

    io.open_batch([sharing_a, sharing_b])   -> [value_a, value_b]      1 ラウンド
    io.open_batch([sharing_a])
    io.open_batch([sharing_b])              -> 同じ値が返る            2 ラウンド

どうまとめるかは **設計判断** で、 聞かれるのではなく **測られる**。
`aggregate` が返すのは **開いていない share**。 最終スコアは採点側が開く。

## 採点は 3 つを別々に測る

正しくて高い / 正しくて漏れる / 秘匿できていて間違い —— どれも実際に起こる。
1 つの判定にまとめると、 自分が作ったのがどれか分からなくなるので分けてある。

    multiply   スコアが平文計算と一致するか (正しさ)
    privacy    実際に開示した値の集合が、 開示してよい集合と厳密に一致するか
    cost       実測のラウンド数と、 plan に書いた見積りが一致するか

## どの関数にも共通の約束

  - 返す share の list は長さ n、 要素はすべて `% p` で 0..p-1 に正規化する。
  - p と組織数は起動ごとに変わる。 数値を書き込まず、 spec から取る。

この問題に、 JSON を手入力する checkpoint は無い。 4 つとも関数を書く。
"""

from __future__ import annotations


def plan(spec: dict) -> dict:
    """プロトコルを書く **前** に、コストを見積もる。

    **見積りの中身はこの問題の主題**なので、数は書いていない。 代わりに、
    採点のしかたと考える順序を書く。

    返り値の形:
        {"multiplications": int, "triples": int, "rounds": int} の 3 キーちょうど。

    それぞれの意味:
        multiplications  秘密どうしの掛け算が何回必要か
        triples          そのために三つ組が何組必要か
        rounds           開示のために何ラウンドの往復が必要か

    採点のしかた:
        3 つとも別々に検査される。 さらに `rounds` は、後の cost checkpoint で
        **実際に走らせたときの実測値と突き合わされる**。 見積りだけ小さく書いて
        実装が違えば、そこで落ちる。

    考える順序:
        1. 式 `score = sum_i (count_i * severity_i) + bias` に、秘密どうしの
           掛け算はいくつあるか (bias は公開定数なので掛け算ではない)
        2. Beaver 掛け算 1 回につき三つ組はいくつ要るか。 使い回してよいか
           (同じマスクで 2 つの秘密を覆うと、 2 つの開示値の差が 2 つの秘密の
            差になる)
        3. 開示する値どうしに依存関係はあるか。 組織 i の差分を計算するのに、
           組織 j の値は要るか
        4. 要らないなら、それらは同時に計算できる。 `io.open_batch` は渡した
           share を全部まとめて開示して 1 ラウンドと数える

    ありがちな失敗:
      - 3 つとも同じ数を答える (バッチ化を考えていないことになる)
      - 組織数を数値で書き込む (`spec["parties"]` から取る)
    """
    return {"multiplications": 0, "triples": 0, "rounds": 0}


def share_inputs(secrets: list[int], randoms: list[list[int]], p: int) -> list[list[int]]:
    """複数の秘密を、それぞれ 1 人 1 個ずつの share に分ける。

    この関数は算術だけ。 ac26-w2-secret-sharing でやったことを、
    複数の秘密に対してまとめて行う。

    手順:
      1. `secrets` を index つきで回す
      2. `randoms[index]` (先頭 n-1 個ぶん) を `% p` して、そのまま先頭に置く
      3. 最後の 1 個を「secret から、それまでの合計を引いた値」にする
      4. その list を結果に追加し、全部終わったら返す

    式:
        head = [value % p for value in randoms[index]]
        out[index] = [*head, (secrets[index] - sum(head)) % p]

    例: p=101, secret=5, randoms[index]=[70, 40]
        head = [70, 40]、 最後 = (5 - 110) % 101 = 97
        sharing = [70, 40, 97]、 検算 207 % 101 = 5

    返り値の形:
        share の list の list。 `out[i]` の長さは `spec["parties"]`。

    ありがちな失敗:
      - `randoms` を使わず自前で乱数を作る。 採点は「渡された乱数がそのまま
        先頭に並んでいるか」を確認するので落ちる
      - `% p` を忘れる
    """
    return []


def add_public(shares: list[int], constant: int, p: int) -> list[int]:
    """公開定数を、共有された値に足す。返すのはその share。

    ac26-w2-linear-shares の `add_constant` と同じもの。 大きなプロトコルの
    中に再登場している。

    採点のしかた:
        (1) 合計が `(x + constant) % p` であること
        (2) 長さ n、 要素はすべて 0..p-1
        (3) **合計が `(x + n*constant) % p` になっていたら明示的に落とす**

    考える順序:
        全員が constant を足すと、合計に constant が何回入るか。
        欲しいのは何回か。

    ありがちな失敗:
      - 全員に足す (下の出荷時のコードは入力をそのまま返すので、そもそも
        定数が 1 回も入っていない)
      - 組織ごとに足す (`aggregate` の中で使うときの話。 bias は最後に
        1 回だけ足す)
    """
    return list(shares)


def aggregate(counts, severities, triple_list, spec, io) -> list[int]:
    """プロトコル本体。score の share を返す。開示はしない。

    **組み合わせ方とラウンド数の見積りがこの問題の主題**なので、手順は
    書いていない。 代わりに、部品の呼び出し方と採点のしかたを書く。

    部品の呼び出し方 (1 つの積について):
        d_i の share = counts[i] から triple_list[i]["a"] を引いたもの (ローカル)
        e_i の share = severities[i] から triple_list[i]["b"] を引いたもの (ローカル)
        d_i, e_i を開示したあと、
        積の share = triple_list[i]["c"] + d_i*triple_list[i]["b"]
                     + e_i*triple_list[i]["a"] + d_i*e_i
        最後の d_i*e_i は **公開値どうしの積 = 公開定数**。 share ではない

    開示のしかた:
        `io.open_batch(sharings)` に share の list を渡すと、値の list が
        **同じ順序で** 返る。 1 回の呼び出しが 1 ラウンド。

    採点のしかた (3 つが別々に測られる):
        multiply  返した share を開くと、平文で計算したスコアと一致するか
        privacy   **実際に `open_batch` に渡した share の集合**が、供給された
                  三つ組から決まる差分の集合と **厳密に一致** するか。
                  ブラックリストではなく厳密一致なので、三つ組の使い回しは
                  「正しいのに落ちる」形でここに出る
        cost      実測のラウンド数と `plan()["rounds"]` が一致し、かつ開示した
                  share の総数がちょうど 2 * 組織数 であるか

    考える順序:
        1. k 個の積それぞれについて、開示したい share は何個か
        2. それらは互いに依存しているか。 組織 i の差分に組織 j の値は要るか
        3. 依存していないなら、`open_batch` を何回呼ぶのが最小か
        4. 積が k 個できたあと、それらをどう 1 つの share にまとめるか
        5. `bias` はどこで、誰が足すか

    返り値の形:
        長さ `spec["parties"]` の list。 要素は 0..p-1 の整数。
        **開いていない share** を返すこと (開くと privacy と cost の両方が落ちる)。

    ありがちな失敗:
      - `io.open_batch` を積ごとに呼ぶ (正しく秘匿もできるが、cost が落ちる)
      - 三つ組を 1 組だけ使い回す (正しくラウンドも 1 回だが、privacy が落ちる)
      - 入力そのものや途中の合計、最終スコアを開示する
      - `spec["parties"]` を list だと思って `len()` を取る (整数なので例外になる)
      - `d` と `e` の対応を取り違える (`open_batch` は渡した順序で返す)
    """
    return [0] * spec["parties"]
