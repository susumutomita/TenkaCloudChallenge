"""任意の計算メモ / Optional scratchpad for eight answer fields.

紙なら編集不要。「証拠を確認」の値で計算し回答欄へ提出します。
Pythonなら対応するreturn Noneだけ埋め、公開テストを実行。PASS自体は提出ではありません。
Use Inspect's values. First seven checks compare a small public example; the last accepts any valid construction.
p=7: every operation uses the SAME prime. %: remainder, **: power.
rows: two (L,R,O) rows: addition, then multiplication using the first output twice.
bad: multiplication's left input changed by g, with its output recalculated.
tags=(k0,k1,k2): column address labels. w=6: row address multiplier.
beta,gamma: fingerprint mixing numbers; fingerprint=(value+beta*address+gamma)%p.
The imported helpers implement formulas in the statement; they are not extra implementation tasks.
"""
from participant.model import addresses as address_table, sigma_addresses as wired_addresses, fingerprints, products, inverse

def outputs(a0,b0,p):
    """Return u=(a0+b0)%p and o=u*u%p, in that order."""
    u=(a0+b0)%p
    return u,u*u%p


def bad_row(u,g,p):
    """Return l=(u+g)%p, u, l*u%p: multiplication holds but its left input was not copied."""
    l=(u+g)%p
    return l,u,l*u%p


def addresses(tags,w,p):
    """Six addresses, row by row: tags, followed by w*each tag, reduced by p."""
    return tuple(w**r*tag%p for r in range(2) for tag in tags)


def sigma_addresses(tags,w,p):
    """Three copied cells cycle: O0→L1→R1→O0. Replace addresses in slots 2,3,4."""
    a=address_table(tags,w,p)
    return a[0],a[1],a[3],a[4],a[2],a[5]


def marks(rows,tags,w,p,beta,gamma):
    """Three fingerprints on the first row with original addresses."""
    return tuple((n+beta*a+gamma)%p for n,a in zip(rows[0],address_table(tags,w,p)[:3]))


def grand_product(rows,tags,w,p,beta,gamma):
    """Multiply six fingerprints under original and wired addresses; return two remainders."""
    a,b=fingerprints(rows,tags,w,p,beta,gamma)
    left=right=1
    for x,y in zip(a,b):left=left*x%p;right=right*y%p
    return left,right


def bad_product(bad,tags,w,p,beta,gamma):
    """Repeat both products on the displayed false table."""
    return grand_product(bad,tags,w,p,beta,gamma)


def miss_count(rows,tags,w,p,beta,gamma):
    """Construct (L,R,O): L and R BOTH differ from rows[0][2], O=L*R % p.
    Keep the first row. Whole-table fingerprint products must be equal and NONZERO.
    Values must lie in 0..p-1. Any valid row passes; return 3 values, not a count."""
    for l in range(p):
        if l==rows[0][2]:continue
        for r in range(p):
            if r==rows[0][2]:continue
            answer=(l,r,l*r%p)
            left,right=products((rows[0],answer),tags,w,p,beta,gamma)
            if left==right and left!=0:return answer
    raise ValueError("no construction for these parameters")
