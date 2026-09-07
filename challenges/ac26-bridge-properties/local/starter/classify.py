"""
JA: 計算に使える標準ライブラリ（Python に付属する道具）は collections, decimal, fractions, functools, hashlib, hmac, itertools, json, math, operator, random, statistics, time, typing。提出ファイル内で import できます。追加パッケージ、ファイルの読み書き、ネットワーク通信は使えません。提出コード全体の実行は15秒までです。
EN: Available computational standard libraries (tools included with Python): collections, decimal, fractions, functools, hashlib, hmac, itertools, json, math, operator, random, statistics, time, typing. Import them in your submitted files. Installing packages, file access and network access are unavailable. Submitted code has a 15-second execution deadline.
JA: Inspect の検査と記録から3性質を分類する。コードはこのファイルで編集。
EN: Classify three properties from Inspect's checks and records. Edit this file.

verifier = 入力を受理/拒否するプログラム / a program accepting or rejecting inputs.
complete = 正しい入力をすべて通す / accept every valid input.
sound = 無効な入力を通さない / reject invalid inputs (this toy input check).
private = 記録だけからwを読めない / the record alone does not disclose w.
This last check is not a proof of real zero knowledge; public conditions let you
search for w. / 本物のゼロ知識の証明ではない。公開条件からwを探せる教材です。

Inspect → verifiers lists all checks required for acceptance:
relation: (a*w+b)%p == c. % means remainder / 割った余り。
range: lo <= w <= hi. range(strict-lo): lo < w <= hi.
For p=7,a=3,b=1,c=0,lo=2,hi=4, valid w=2 fails the strict lower bound.
The same remainder holds at w=9, outside the intended range.
A record containing w discloses it even if the acceptance check is correct.

classify(protocol_id) receives one of this deployment's Inspect names. Use if
branches for those names and return all three boolean keys. Transfer keeps these
names while changing the numeric inputs. / この起動の名前ごとにifで分け3キーを返す。
別数値の検査でも名前は同じ。新規配置後はInspectを読み直す。

Run public tests checks shapes only; this incorrect starter passes them too.
Submit property-matrix checks the classification. / 公開テストの合格だけでは正答でない。
"""
from __future__ import annotations

PROPERTIES = ("complete", "sound", "private")


def classify(protocol_id: str) -> dict[str, bool]:
    """Return three booleans / 3性質のTrue/Falseを返す。"""
    return {"complete": True, "sound": True, "private": True}
