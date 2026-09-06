"""JA: 反例は、満たすはずの性質が破れる具体例。この3関数を編集してください。
EN: A counterexample is a concrete case breaking a claimed property. Edit these functions.

statement = 条件の辞書 / dictionary of conditions: a,b,c,p,lo,hi.
Valid w / 正しいw: (a*w+b)%p == c AND lo <= w <= hi.
% means remainder after division / 割った余り、* is multiplication / 掛け算。
Try w from lo through hi; range(lo, hi+1) includes the upper end. Return a match.
loからhiまで順番に試す。range(lo,hi+1)で上端も含み、余りがcならその整数を返す。
Each supplied statement has one valid in-range integer / 各条件には範囲内の解が1つある。

Small example / 小例: p=7,a=3,b=1,c=0,lo=2,hi=4.
w=2 → (3*2+1)%7=0, w=3 → 3, w=4 → 6. Thus w=2 is valid.
But lo<w rejects 2: this breaks completeness / 下端を除くと正しい2が落ちる。
Adding p preserves the remainder: w=9 → (3*9+1)%7=0, outside 2..4.
To leave any finite range, keep adding p until w>hi / hiを超えるまでpを足す。

A transcript is an exchange record / やりとりの記録。
For record={"box":{"number":3}}, record["box"]["number"] is 3.
Use the corresponding keys in Inspect's transcript; do not hard-code its number.
Inspectの記録のキーを順に読む。画面の数を固定して返さない。

Submit runs your functions. Incompleteness receives a DIFFERENT statement whose
valid value lies at the lower end. Transfer uses more unseen statements/records.
提出時のincompletenessは画面と別の、下端が正しい値になる条件を受け取る。
transferでも未見の数値を受け取るので、引数から計算する。同じ3関数を使う。
No file/network/process access is needed or available in the deployed evaluator.
配置された実行器でファイル・ネットワーク・別プロセスへのアクセスは使えません。
"""
from __future__ import annotations


def incompleteness_witness(statement: dict[str, int]) -> int:
    """Return a valid integer rejected by strict-lo / 正しいのに下端検査で拒否される整数。"""
    return 0


def unsoundness_witness(statement: dict[str, int]) -> int:
    """Return an out-of-range integer satisfying relation / 式は満たすが範囲外の整数。"""
    return statement["lo"]


def extract_witness(transcript: dict) -> int:
    """Read and return the witness in the record / 記録から証拠の値を読み整数で返す。"""
    return 0
