"""Repair six functions, then submit five checkpoints in the Portal.

Start -> Inspect evidence -> edit sharing.py -> Run public tests -> Submit.
A share is one holder's piece of a secret. p is a prime divisor; every returned
number must be its remainder, 0 <= value < p. Python writes remainder as % p:
11 % 7 == 4 and (-3) % 7 == 4. sum(values) adds a list.

Use the supplied randomness, not your own generator. The secrecy argument
assumes independent uniform draws from all of 0..p-1, including zero, fresh for
each sharing. An observer sees only collected shares, not missing holders'
information or the random-number list. Testing inputs are not that observer's
view. Compatibility with every secret alone does not prove equal likelihood.

The formulas below are free. Apply them to arbitrary function inputs rather
than hard-coding Inspect's values. The bodies are deliberately unfinished.
"""

from __future__ import annotations


def share(secret: int, n: int, p: int, randomness: list[int]) -> list[int]:
    """Return n shares. n >= 2; randomness has at least n-1 entries.

    Take the first n-1 random values, each % p, as head. Append
    (secret - sum(head)) % p. For p=7, secret=4, n=3, randomness=[5,6],
    this gives [5,6,0]. The same rule can legitimately draw [4,0] and
    give [4,0,0]; ignoring randomness and ALWAYS copying secret is wrong.
    """
    return [secret] + [0] * (n - 1)


def reconstruct(shares: list[int], p: int) -> int:
    """Return one integer: sum(shares) % p, using only the supplied shares.

    p=7, shares=[5,6,0]: sum is 11, remainder is 4. Do not keep the secret
    from an earlier share() call; holders reconstruct from their pieces.
    """
    return 0


def complete_shares(partial: list[int], secret: int, p: int) -> int:
    """Return ONE integer, the missing last share for this candidate secret.

    Formula: (secret - sum(partial)) % p.
    p=7, partial=[5,6]: candidate 4 needs 0; candidate 1 needs 4.
    Check (sum(partial) + last) % p == secret. The same partial fitting
    each candidate proves compatibility. Unchanged probabilities additionally
    require the independent uniform randomness assumption, not just this test.
    """
    return 0


def rerandomize(shares: list[int], p: int, randomness: list[int]) -> list[int]:
    """Return a NEW list with the same length and total remainder.

    Let k=len(shares). Take the first k-1 randomness entries % p as head;
    append (-sum(head)) % p. Add these adjustments position by position
    to shares, taking % p each time. Do not modify the input list.
    p=7, shares=[5,6,0], randomness=[1,2]: adjustments=[1,2,4],
    new shares=[6,1,4], same secret 4. This checkpoint checks visible change
    on inputs with a nonzero adjustment. A general uniform all-zero draw is
    valid and leaves the original values unchanged; independent != different.
    """
    return list(shares)


def share_line(secret: int, p: int, randomness: list[int]) -> list[list[int]]:
    """Return [[1,y1],[2,y2],[3,y3]]: any two points recover the secret.

    Shamir two-of-three sharing uses prime p > 3 so positions 1,2,3 are
    distinct nonzero remainders. Slope r (increase in y per step of x) is
    randomness[0] % p. Formula: y = (secret + r*x) % p.
    p=7, secret=1, r=4 gives [[1,5],[2,2],[3,6]]. The secret is at x=0.
    For a single fixed point, each secret has exactly one possible r. A
    uniform independent r therefore gives the same likelihood for every
    secret. A draw r=0 is valid; always fixing r=0 reveals the secret.
    """
    return [[x, secret % p] for x in (1, 2, 3)]


def reconstruct_line(two_points: list[list[int]], p: int) -> int:
    """Return the secret from any two distinct supplied points, in either order.

    Unpack [[x1,y1],[x2,y2]]. Let d=(x2-x1) % p. Find k in 1..p-1 such
    that (d*k) % p == 1. This k is the multiplicative inverse: the partner
    that replaces division in remainder arithmetic. Prime p and d != 0
    guarantee it exists. Stop searching once found. Then
      r = ((y2-y1)*k) % p
      secret = (y1-r*x1) % p
    Return the latter integer. Do not use ordinary / or floor division //.
    p=7, reversed [[3,6],[2,2]]: d=6, k=6, r=4, secret=1.
    One search through k works even for p around 10000 within the 12-second
    code limit; do not search through every (secret, slope) pair.
    """
    return two_points[0][1] % p
