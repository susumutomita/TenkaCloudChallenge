"""
JA: 計算に使える標準ライブラリ（Python に付属する道具）は collections, decimal, fractions, functools, hashlib, hmac, itertools, json, math, operator, random, statistics, time, typing。提出ファイル内で import できます。追加パッケージ、ファイルの読み書き、ネットワーク通信は使えません。公開テストの実行は15秒、採点の実行は20秒までです。
EN: Available computational standard libraries (tools included with Python): collections, decimal, fractions, functools, hashlib, hmac, itertools, json, math, operator, random, statistics, time, typing. Import them in your submitted files. Installing packages, file access and network access are unavailable. Public tests allow 15 seconds; grading allows 20 seconds.
Beaver乗算：ここに4関数を書き、5つの採点欄へ同じファイルを提出します。
Beaver multiplication: implement four functions here; all five checks use this file.

share（シェア）は数の持ち分、partyはその持ち主です。各リストの同じ位置が
同じpartyを表します。全shareの合計を素数pで割った余りが元の数です。
A share is one piece; a party holds one row. Corresponding list positions belong
to the same party. The original value is the total remainder after division by p.

このPython教材は全partyの行をまとめて扱う算術模型です。実MPCでは各partyが
自分の行だけを持ちます。この模型は通信や秘匿性全体を検証するものではありません。
This program simulates every party's arithmetic. A real MPC party holds its own
row only. This exercise does not certify communication or whole-protocol privacy.

前処理の三つ組 / preprocessed triple:
    c = (a*b) % p; share lists a_shares, b_shares, c_shares
手順 / stages:
    d_shares = mask(x_shares, a_shares, p)
    e_shares = mask(y_shares, b_shares, p)
    d = open_value(d_shares, p)        # public integer / 公開整数
    e = open_value(e_shares, p)        # public integer / 公開整数
    out = combine(c_shares, a_shares, b_shares, d, e, p)

展開 / expansion, taking all remainders modulo p:
    x*y = (a+d)*(b+e) = c + d*b + e*a + d*e
各partyは自分のa/b/cのshareとd/eを使います。最後のd*eは公開定数なので、
追加分の合計がd*eになるようにします。簡単な方法はparty 0にだけ足すことです。
Each party uses its a/b/c row and public d/e. The extra public term must enter
once in the total. Adding it to party 0 only is one simple valid distribution.

p=7の例 / example (all lists have n=3):
    x=[3,4,5], y=[1,5,4], a=[1,2,6], b=[2,3,1], c=[4,2,6]
    d_shares=[2,2,6] -> d=3; e_shares=[6,2,3] -> e=4
    first three terms / 最初の3項: [0,5,5]
    add d*e to party 0 / 0番へだけ追加: [5,5,5] -> total % 7 = 1
    x*y = 5*3 -> remainder / 余り 1

同じ長さのshareリストが渡ります。pは引数、人数はlenで取り、返す各整数は
0以上p未満にしてください。sumは合計、lenは長さ、% pはpで割った余りです。
Lists passed together have equal lengths. Use p and list lengths from arguments.
Return integers in 0..p-1. sum adds a list, len counts it, and % p takes a remainder.

実手順で差を安全に公開するには、入力と独立な一様乱数a/bを一度だけ使い、
観測者がa/bを復元できないことが必要です。全リストを見せるこの教材とは別の条件です。
Real opening privacy requires independent uniform masks used once, hidden from
that observer. That condition differs from this all-rows-visible teaching view.
"""

from __future__ import annotations


def mask(value_shares: list[int], mask_shares: list[int], p: int) -> list[int]:
    """差のshareを作る / Form difference shares without opening the inputs.

    式 / formula: out[i] = (value_shares[i] - mask_shares[i]) % p
    p=7: [3,4,5] minus [1,2,6] -> [2,2,6]. 5-6=-1 -> remainder 6.

    各行をforで計算し、長さnのリストを返します。合計は返しません。
    Compute each matching row in a loop; return n rows, not their total.
    Run public tests / 「公開テストを実行」 → Submit checkpoint mask.
    """
    return list(value_shares)


def open_value(shares: list[int], p: int) -> int:
    """差を公開整数へ戻す / Reconstruct the difference as one public integer.

    式 / formula: sum(shares) % p
    p=7: [2,2,6] -> 10 -> remainder / 余り 3.

    10も同じ余りを表しますが、関数の返り値は0..p-1にそろえる約束です。
    これは返値の形式の条件で、後段の積が必ずずれるという意味ではありません。
    10 represents the same residue, but this function promises the canonical
    range 0..p-1; it is not a claim that the later product must otherwise change.
    Return one integer, not a list / リストではなく整数1個。
    Run public tests / 「公開テストを実行」 → Submit checkpoint open.
    """
    return 0


def combine(
    c_shares: list[int],
    a_shares: list[int],
    b_shares: list[int],
    d: int,
    e: int,
    p: int,
) -> list[int]:
    """三つ組の各行と公開d/eで積のshareを作る / Assemble product shares.

    各行 / each row: (c_shares[i] + d*b_shares[i] + e*a_shares[i]) % p
    最後の公開定数d*eが合計に一度分だけ入るようにします。party 0へだけ足す
    方法なら、i=0の行へd*eを追加してから% pします。別の配り方でも合計が同じなら可。
    The extra public term must contribute d*e once to the total. One method adds
    d*e only to row i=0 before taking % p. Other correct distributions are valid.

    p=7, a=[1,2,6], b=[2,3,1], c=[4,2,6], d=3, e=4:
        before / 追加前 [0,5,5]; after / 追加後 [5,5,5]; total % 7 = 1.
        adding to everybody / 全員へ追加 [5,3,3] -> 4 (wrong / 不正解).
    dはbに、eはaに掛けます。d/eは整数、a/b/cはリストです。
    d multiplies b; e multiplies a. d/e are integers; a/b/c are lists.
    Return n canonical integers / 長さn、各要素0..p-1のリスト。
    Run public tests / 「公開テストを実行」 → Submit checkpoint combine.
    """
    return list(c_shares)


def rounds() -> int:
    """2つの差をまとめて公開する最小ラウンド数 / Minimum batched opening rounds.

    dの計算にeは不要、eの計算にもdは不要なので、同じ段階で送れます。
    公開値2個、最小1ラウンド。Python関数の呼び出し回数とは区別します。
    Neither difference needs the other to be opened first. Two opened values,
    one minimum round; distinguish that from two Python function calls.
    Return an integer (not bool) / 整数で返す (boolは不可)。
    The protocol/transfer checkpoints reuse this file / 新しい関数の追加は不要。
    """
    return 0
