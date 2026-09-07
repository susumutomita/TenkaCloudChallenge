"""
JA: 計算に使える標準ライブラリ（Python に付属する道具）は collections, decimal, fractions, functools, hashlib, hmac, itertools, json, math, operator, random, statistics, time, typing。提出ファイル内で import できます。追加パッケージ、ファイルの読み書き、ネットワーク通信は使えません。提出コードの実行は20秒までです。
EN: Available computational standard libraries (tools included with Python): collections, decimal, fractions, functools, hashlib, hmac, itertools, json, math, operator, random, statistics, time, typing. Import them in your submitted files. Installing packages, file access and network access are unavailable. Submitted code has a 20-second execution deadline.
監査器 / Privacy auditor — 編集するファイルはこれ一つ。

MPC（秘密計算）は、複数人が入力を隠して共同で結果を計算する方法。
秘密分散で各人に渡す数が share（シェア）。open は復元した値の公開。
この教材では通信を実装せず、仕様と記録から余計な公開を調べる。

party は参加者、id は参加者の識別名、label は値の名前。
名前の文字そのものには秘密・公開の意味はない。

spec（仕様）の全キー:
  p             素数。a % p は p で割った余り。-2 % 7 = 5。
  parties       参加者 id の list
  publicInputs  公開重みの label の list。1 <= 重み < p。
  masked        適切な使い捨てマスクで覆った値の label の list
  result        最終結果の label（文字列 1 個）

マスク r は秘密と独立に 0..p-1 から同じ確率で選び、観測者は知らない。
p=7, d=(x-r)%7=1 なら x=0,1,2,3,4,5,6 に r=6,0,1,2,3,4,5 が対応し、
どの秘密も同じ確率であり得る。再使用すると d1-d2=x1-x2 が漏れる。
masked の仮定は仕様が与える。監査器自身は乱数の質を証明しない。
result は意図的に公開する情報。情報がゼロという意味ではない。

trace（記録）は event（出来事）の dict の list。
全 event に kind,label,party,owner,text,value があり、未使用欄は "" / 0。
value は外に見えた数、text はログ（動作記録）や失敗を知らせる文。
  kind       違反になる条件              返す違反名
  open       label が allowed にない      opened-a-secret
  peek       party != owner              cross-party-read
  emit       label が allowed にない      leaked-in-log
  fail       label が allowed にない      leaked-in-error
  output     この教材では違反なし          —
peek は party が owner の保管場所を読むこと。自分の場所なら違反ではない。
これは供給された仕様と記録の監査で、MPC 全体の安全性証明ではない。

All seven checkpoints submit this file. None requires a typed JSON answer.
"""

from __future__ import annotations

VIOLATIONS = (
    "opened-a-secret",
    "cross-party-read",
    "leaked-in-log",
    "leaked-in-error",
)


def allowed_opens(spec: dict) -> list[str]:
    """許可する名前を重複なく、sorted(...) で並べた list として返す。

    publicInputs の全部 + masked の全部 + result 1 個。
    重複しない集まりが集合（Python の set）。返す型は list。
    例: publicInputs=["w"], masked=["d"], result="T" → ["T","d","w"]。
    Inspect evidence の spec と比較し、allowed-opens 欄へ提出。
    Return the sorted unique labels allowed by the supplied spec.
    """
    return []


def first_violation(trace: list[dict], spec: dict) -> dict | None:
    """先頭から最初の違反を {"kind":違反名,"index":位置} で返す。

    位置は 0 始まり。最後まで違反がなければ None。
    冒頭の表を使い、各 event の kind と許可一覧／読み手と持ち主を比較。
    allowed={"T","d","w"} で [open d,emit w,open S] なら
    {"kind":"opened-a-secret","index":2}。最初の 2 行だけなら None。
    名前が変わっても spec から許可一覧を作り直す。順序が変われば index も
    数え直す。opened-secret / cross-party / log-leak / mutation が使う。
    Return the first violation's kind and zero-based index, or None.
    """
    return None


def derive_secret(transcript: list[dict], spec: dict) -> dict:
    """余計な部分和から最後の参加者の入力を復元し、party/value を返す。

    transcript は {"label":名前,"value":数} の list。trace と形が違う。
    T は spec["result"] の値。S は許可一覧にない名前の部分和で、最後の人
    以外の全員分。w は spec["publicInputs"][-1] の値。[-1] は末尾。
    重みは入力を何倍するか。3 人なら（式の値は p で割った余り）:
      T = w0*x0 + w1*x1 + w2*x2, S = w0*x0 + w1*x1 → T-S = w2*x2
    逆元 u は w*u % p = 1 になる数。素数 p と 1<=w<p に対し存在し、
    Python では pow(w,-1,p)。入力は ((T-S)*pow(w,-1,p)) % p。
    例 p=7, 重み(1,2,3), 入力(2,1,4): T=16%7=2, S=4,
    (T-S)%7=5, 3*5%7=1, 入力=5*5%7=4。
    {"party":spec["parties"][-1],"value":復元した整数} を返す。
    人数や名前は固定しない。transcript 欄へ提出。
    Recover the last party's input using the extra partial sum and public weight.
    """
    return {}


def repair(program: list, spec: dict) -> list:
    """違反操作だけ除き、残りを元の順序のまま list で返す。

    program は Python source ではなく操作の list。各操作は順序を持つ組
    （タプル）。op[0] が操作名、残りの位置は以下のとおり。
      ("share",label,owner)       owner の入力を秘密の値として用意
      ("const",label,value)       手元の定数（公開は別の open）
      ("mask",out,val,msk)        手元で out=val-msk
      ("scale",out,val,k)         手元で out=val*k（k は公開）
      ("addsh",out,x,y)           手元で out=x+y
      ("open",label)              公開
      ("peek",party,owner)        保管場所を読む
      ("emit",label,text)         値をログへ
      ("fail",label,text)         値を失敗の文へ
      ("output",label)            結果出力
    違反の条件は冒頭の表と同じ。計算と許可された操作を残す。
    例 allowed={"d","T"}: [open d,emit S,output T] → [open d,output T]。
    repair 欄は同じ合計、漏れの除去、許可された観測の保持を調べる。
    Return the operations in order, removing only prohibited observations.
    """
    return list(program)
