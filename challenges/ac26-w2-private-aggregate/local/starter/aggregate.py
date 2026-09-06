"""aggregate.py — 4関数を育て、同じファイルを8欄へ提出 / one file, eight checkpoints.
計算用標準ライブラリ（math, fractions, statistics, random 等）は事前読み込み済み。
使用可能一覧は問題文の Python 補助欄。追加ファイル/ネットワーク読み込みは不可。


起動 → 証拠を確認 → planを編集 → 公開テスト → planを提出。
Start → Inspect evidence → edit plan → Run public tests → submit plan.
planだけ先に提出できる。スコア側の公開テストはaggregate完成後に確認する。
Plan may be submitted first; the public score test needs aggregate later.
戻り値とopen_batchの順序付き列はlist/tuple同値（入れ子の外側・内側も）。例はlist。
Returns and open_batch inputs accept lists or tuples, including nested levels; examples use lists.

本問の加法的シェア（additive share）は、全破片の合計を素数pで割った余りが元の数になる分割。
Pythonでは余りを % p と書く。p7で[5,4]は2を表す。
An additive sharing represents sum(pieces) % p; with p7, [5,4] represents2.

組織iの入力 counts[i] と severities[i] はそれぞれn破片。
位置jは処理者の番号で、組織iの番号とは別。本問は組織数k=処理者数n。
Organization i's count and severity each have n pieces. Piece-owner j and input-owner
organization i are distinct roles; this model uses k=n=spec['parties'].

Beaver三つ組 triple_list[i] はa,b,cの破片（復元するとc=a*bの余り）。
マスクa,bは積ごとに新しく使う。公開する差の破片を各位置で作る:
Each product receives a fresh Beaver triple: reconstructed c=(a*b)%p.
For each organization i, t=triple_list[i], and each piece j:
    ds[j] = (counts[i][j] - t['a'][j]) % p
    es[j] = (severities[i][j] - t['b'][j]) % p
io.open_batch([ds0,es0,ds1,es1,...])は同じ順序で[d0,e0,d1,e1,...]を返す。
One actual call is one round, regardless of how many values it opens.

開示後、各組織の三つ組tを取り直して積の破片を作る:
After opening, select that organization's own t again:
    product[j] = (t['c'][j] + d*t['b'][j] + e*t['a'][j]) % p
簡単な実装例では公開項d*eを1位置に加える。各積を位置ごとに合計しbiasも全体に1回加える。
For a simple implementation add public d*e at one position; sum products, then add bias once.
一般には調整r_jの合計が公開定数とmod pで一致すればよい。
Offsets r_j at several positions also work when their sum equals the public constant modulo p.
Reason: x=a+d, y=b+e, so xy=c+d*b+e*a+d*e.

p7の表 / p7 example (organization i → list indexed by owner j):
 i  counts severity  a      b      c      ds→d      es→e     product
 0  [5,4]  [6,4]   [2,6] [3,6] [4,5]  [3,5]→1   [3,5]→1   [3,3]
 1  [3,5]  [2,2]   [1,2] [4,4] [6,4]  [2,3]→5   [5,5]→3   [2,2]
Open [ds0,es0,ds1,es1] once → [1,1,5,3]. Products sum to [5,5].
Add bias1 once → [6,5] → score4=(2*3+1*4+1)%7.

privacyはopen_batchで開いた値を重複込みで数える。順序は自由。
[1,1,5,3]と[3,1,5,1]は同じ開示、[1,5,3]では1が1個足りない。
Privacy checks the opened-value multiset (order ignored, repetitions retained).
Cost checks 2k values in one round. Triple reuse can still open2k values: it leaks
because d0-d1=x0-x1 when the same a masks two inputs, not because of its count.

これは開示窓口と算術の模型。Pythonは全破片を持つので自分で復元できる。
This is an opening-channel/arithmetic model, not confidentiality against this Python
program, which receives all shares. Return unopened score shares; the grader reconstructs.
"""


def plan(spec: dict) -> dict:
    """spec={'p': prime, 'parties': integer k, 'bias': public integer}.

    3キーの整数辞書で積数・三つ組数・最小ラウンドを見積もる。
    Return exactly three integer fields: multiplications, triples, rounds.
    k independent products each need a triple and two masked openings; consider which
    differences need to wait for another product before they can be batched.
    """
    return {"multiplications": 0, "triples": 0, "rounds": 0}


def share_inputs(secrets: list[int], randoms: list[list[int]], p: int) -> list[list[int]]:
    """各secretの先頭にはrandoms[i]を%pで並べ、最後を(secret-sum(head))%pへ。

    Use the supplied randoms[i] modulo p as the first pieces; append the modular
    complement. Output length per secret is len(randoms[i])+1, with no spec argument.
    secret2, randoms[i]=[5], p7 → [5,4]. Return canonical integer pieces in 0..p-1.
    """
    return []


def add_public(shares: list[int], constant: int, p: int) -> list[int]:
    """全体にconstantを1回加えた破片 / shares of the original value plus constant.

    Adding to one chosen piece works. p7: [5,4] + public1 → [6,4] →3;
    adding1 to both pieces gives [6,5] →4. Return an ordered sequence of canonical integer pieces.
    """
    return list(shares)


def aggregate(counts: list[list[int]], severities: list[list[int]],
              triple_list: list[dict], spec: dict, io) -> list[int]:
    """全積を足してbiasを1回加えたスコアの破片を返す。最終スコアは開かない。

    Return n canonical integer pieces of sum_i(count_i*severity_i)+bias modulo p.
    For each i, use triple_list[i] to prepare its d/e sharing at every owner position j.
    Collect all differences before io.open_batch. Its returned values follow your order.
    Select triple_list[i] AGAIN in the product loop; the previous loop's final triple
    does not belong to every organization. Use the formula above, sum by position,
    and add bias once (add_public can help).

    multiply checks the score; result checks re-sharing/order/input-delta relations;
    privacy checks only the supplied triples' d/e values were opened, with multiplicity;
    cost checks one actual batch of2k values and agreement with plan; transfer checks
    all four functions under other arguments. No source-text or literal-count rule.
    """
    return [0] * spec["parties"]
