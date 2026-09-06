"""Optional scratchpad / 任意の計算メモ。

紙で計算して回答欄へ直接提出しても構いません。コードで確かめる場合は、
問題文に示した式を使って return None を埋め、「公開テストを実行」。
前半は公開例の PASS/FAIL、後半の your values on THIS deployment は自分の値です。
後半を表示しただけでは正解ではないので、同じ ID の欄へ提出してください。
各関数は独立です。Python の別の画面で作った c1 や held はここにはありません。

You may calculate on paper and submit directly. For a code check, use the
statement formulas to replace return None, then Run public tests. The first part
checks a published example; the second prints YOUR outputs. Submit those outputs
to the matching answer fields for grading. Functions are independent: c1 or held
created in another Python prompt do not exist here.

Example inputs / 小さい例: a=3, b=2, x=1. The covered pair is (4,3), its sum 7,
and the original sum 7-2=5. / 覆った組(4,3)、合計7、覆いを外すと7-2=5。
"""
from __future__ import annotations


def covered(a: int, b: int, x: int) -> tuple:
    """covered: 元の各数に覆いを足す / Return (a+x,b+x), in that order."""
    return None


def sum_covered(a: int, b: int, x: int) -> int:
    """sum-covered: 覆ったまま足す / Return (a+x)+(b+x)."""
    return None


def sum_plain(a: int, b: int, x: int) -> int:
    """確認用、採点欄なし / Optional comparison: return (a+b)+2*x."""
    return None


def same(a: int, b: int, x: int) -> bool:
    """確認用 / Is (a+x)+(b+x) == (a+b)+2*x? No answer field."""
    return None


def huge_gap(a: int, b: int, huge: int) -> int:
    """huge: ((a+huge)+(b+huge))-((a+b)+2*huge) の差 / Return the difference."""
    return None


def held(a: int, b: int, x: int) -> tuple:
    """held: 返事、覆いの総量 / Return ((a+x)+(b+x),2*x)."""
    return None


def recover(a: int, b: int, x: int) -> int:
    """recover: 返事から覆いを2個外す / Return (a+x)+(b+x)-2*x."""
    return None


def guesses(a: int, x: int, n: int) -> int:
    """guesses: ここだけ0..n-1の全候補を許す余りの実験 / Separate remainder model.

    observed=(a+x)%n. For each ca in range(n), construct cx=(observed-ca)%n
    and count the ca for which (ca+cx)%n == observed. % means division remainder.
    caごとに対応するcxを作り、足し戻せる候補の個数を返します。
    n=5,observed=2: ca=0,1,2,3,4 match cx=2,1,0,4,3; all five survive.
    元の生成範囲による絞り込みとは別モデルです / Ignore the generator's narrower ranges.
    """
    return None


def gap(a: int, b: int, x: int) -> int:
    """gap: 普通の整数へ戻る / Return (a+x)-(b+x), keeping the sign."""
    return None


def product(a: int, b: int, x: int) -> tuple:
    """product: 全値を知る人の分析 / Analysis with all values known.

    p=(a+x)*(b+x), without_square=a*b+(a+b)*x.
    Return (p,without_square,p-without_square). / 積、x²以外、差の順。
    Removing only x*x still leaves (a+b)*x. / x²を引くだけでは元の積になりません。
    """
    return None


def wall(a: int, b: int, x: int) -> bool:
    """確認用 / Is (a+x)*(b+x)-(a*b+(a+b)*x) == x*x? No answer field."""
    return None
