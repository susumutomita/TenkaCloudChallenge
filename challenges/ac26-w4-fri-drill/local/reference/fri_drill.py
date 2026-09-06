"""任意の計算メモ / Optional scratchpad: eight answer rows.

紙で答える場合は編集不要。証拠を確認 / Inspect の自分の数を使い、回答欄へ提出。
Pythonを使う場合は対応する return None だけを埋め、公開テストを実行 / Run public tests。
出力は小さな見本の検算と、あなたのコードが自分の数で計算した結果です。
Fill a return None to compute a row. Public tests check the printed small example,
then print YOUR results for this deployment. A PASS is not an answer submission.

qs=(q0,q1,q2,q3): 1,X,X²,X³の係数 / coefficients. p: 割る数 / divisor (5 or 7).
% p: pで割った0..p-1の余り / remainder. **: 累乗 / power.
beta,beta2: 折るときに掛ける数 / fold multipliers.
x: 確認位置 / check position (nonzero). d0+d1*Y: すり替えで足す式 / alteration.
q, even, odd, folded, inverse are supplied formulas, not extra implementation tasks.
q(qs,X,p)=q0+q1*X+q2*X**2+q3*X**3; even=q0+q2*Y; odd=q1+q3*Y;
folded=even+beta*odd (all reduced by p). inverse(a,p) finds a*i % p == 1.
Each row's statement gives its formula, worked example, and output order.
"""
from participant.model import q, even, odd, folded, inverse


def poly(qs, p):
    """Q(0), Q(1), Q(2) (all arithmetic uses remainders by p)."""
    return tuple(q(qs,t,p) for t in (0,1,2))


def fold(qs, beta, p):
    """Q1(0), Q1(1), Q1(2) (all arithmetic uses remainders by p)."""
    return tuple(folded(qs,beta,t,p) for t in (0,1,2))


def fold2(qs, beta, beta2, p):
    """c + beta2*d; c=Q1(0), d=Q1(1)-c (all arithmetic uses remainders by p)."""
    c=folded(qs,beta,0,p)
    d=(folded(qs,beta,1,p)-c)%p
    return (c+beta2*d)%p


def query(qs, x, p):
    """Q(x), Q(-x) (all arithmetic uses remainders by p)."""
    return (q(qs,x,p),q(qs,-x,p))


def recover(qs, x, p):
    """re, ro, E(x*x), O(x*x) (all arithmetic uses remainders by p)."""
    a=q(qs,x,p);b=q(qs,-x,p)
    re=(a+b)*inverse(2,p)%p
    ro=(a-b)*inverse(2*x,p)%p
    return (re,ro,even(qs,x*x,p),odd(qs,x*x,p))


def consistency(qs, beta, x, p):
    """re + beta*ro, Q1(x*x) (all arithmetic uses remainders by p)."""
    re,ro,_,_=recover(qs,x,p)
    return ((re+beta*ro)%p,folded(qs,beta,x*x,p))


def cheat_caught(qs, beta, x, d0, d1, p):
    """honest check, altered Q1(x*x) (all arithmetic uses remainders by p)."""
    left,right=consistency(qs,beta,x,p)
    return (left,(right+d0+d1*x*x)%p)


def miss_points(x, p):
    """Return a0,a1,b0,b1,b2,b3 (six remainders).

    A(Y)=a0+a1*Y: a1 != 0, A(x*x) % p == 0.
    B(Y)=b0+b1*Y+b2*Y**2+b3*Y**3: b0 != 0;
    B(t*t) % p == 0 for EVERY t=1..p-1; b3 must be 0 if p=5.
    Construct your own pair. Multiple answers pass. Products (Y-r) give chosen zeros;
    the statement supplies expansion formulas. d0,d1 are not used in this row.
    検査を通る偽物を2種類作る。本文の条件を満たす6係数なら、どの答えも正解。
    """
    # Construct a product over DISTINCT squares, rather than copying a seeded tuple.
    squares=[]
    for t in range(1,p):
        r=t*t%p
        if r not in squares:squares.append(r)
    coefficients=[1]
    for r in squares:
        product=[0]*(len(coefficients)+1)
        for i,value in enumerate(coefficients):
            product[i]=(product[i]-r*value)%p
            product[i+1]=(product[i+1]+value)%p
        coefficients=product
    coefficients += [0]*(4-len(coefficients))
    return ((-x*x)%p,1,*coefficients)
