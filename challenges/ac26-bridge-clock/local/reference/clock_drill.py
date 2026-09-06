"""任意の計算メモ / Optional scratchpad for the eight answer fields.

Start → Inspect evidence. 紙で計算して回答欄へ直接入力できます。
You may calculate on paper and enter answers directly; Python is optional.
If using this file, fill a function, run public tests, and copy its printed value.
Lists/tuples are printed as JSON arrays, such as [2, 2, 0].

n is the clock size. x % n means the remainder in 0..n-1 (n is positive).
For example 8 % 5 = 3; -2 % 5 = 3 because -2 = (-1)*5 + 3.
secret/cover are a practice original and the number added to cover it.
The later record has observations seen1, seen2 and a comparison first
original known_first, displayed from the start. Its actual second original and common cover are not shown.
This fixed practice record is separate from the uniform-random experiment.
"""


def add(u: int, v: int, n: int) -> tuple:
    """add: (sum then remainder, remainders then sum/remainder, first minus second).
    Example u=8,v=9,n=5: 17%5=2; (3+4)%5=2; return [2,2,0].
    """
    a = (u + v) % n
    b = ((u % n) + (v % n)) % n
    return (a, b, a - b)


def mul(u: int, v: int, n: int) -> tuple:
    """mul: replace both sums in add with products; return three integers.
    Example u=8,v=9,n=5: 72%5=2; (3*4)%5=2; return [2,2,0].
    """
    a = (u * v) % n
    b = ((u % n) * (v % n)) % n
    return (a, b, a - b)


def covered(secret: int, cover: int, n: int) -> int:
    """cover: (secret+cover)%n. Example 4+3=7, remainder 2 on a 5-clock."""
    return (secret + cover) % n


def uncovered(secret: int, cover: int, n: int) -> int:
    """uncover: compute observed=(secret+cover)%n, then (observed-cover)%n.
    Example observed=2,cover=3,n=5: -1%5=4.
    """
    observed = (secret + cover) % n
    return (observed - cover) % n


def every(secret: int, cover: int, n: int) -> tuple:
    """every: construct a cover for each of three candidate originals.
    observed=(secret+cover)%n; candidates are secret, (secret+1)%n,
    (observed+3)%n. For each candidate, the cover is (observed-candidate)%n.
    Example secret=4,cover=3,n=5: observed=2; candidates [4,0,0]; covers [3,2,2].
    Repeated candidates are separate entries; return the three covers in order.
    """
    observed = (secret + cover) % n
    candidates = [secret, (secret + 1) % n, (observed + 3) % n]
    result = []
    for candidate in candidates:
        result.append((observed - candidate) % n)
    return result


def count(secret: int, cover: int, n: int) -> int:
    """count: count (candidate,cover) pairs yielding observed=(secret+cover)%n.
    Each candidate 0..n-1 has exactly one cover (observed-candidate)%n.
    Example n=5,observed=2: covers for candidates 0..4 are [2,1,0,4,3]; five pairs.
    Ordinary nested for loops over range(n), an if and a total counter also work.
    """
    observed = (secret + cover) % n
    total = 0
    for candidate in range(n):
        for c in range(n):
            if (candidate + c) % n == observed:
                total += 1
    return total


def reuse(known_first: int, seen1: int, seen2: int, n: int) -> tuple:
    """reuse: construct ANOTHER explanation [a,b,r] for the two observations.
    All three are integers in 0..n-1; a must differ from known_first.
    Require (a+r)%n=seen1 and (b+r)%n=seen2. The same r serves BOTH.
    Choose a different a, then r=(seen1-a)%n and b=(seen2-r)%n.
    Example known_first=4,seen1=2,seen2=4,n=5: [0,2,2] works; [1,3,1] also works.
    Consider an observer who knows only seen1,seen2, not known_first. Do not return the actual originals or observations.
    """
    a = (known_first + 1) % n
    r = (seen1 - a) % n
    b = (seen2 - r) % n
    return (a, b, r)


def leak(known_first: int, seen1: int, seen2: int, n: int) -> int:
    """leak: when known_first is also known, recover the actual second original.
    gap=(seen1-seen2)%n; second=(known_first-gap)%n.
    Example 4,2,4,5: gap=-2%5=3; second=(4-3)%5=1.
    The leaked difference is a remainder, not necessarily an ordinary signed gap.
    """
    gap = (seen1 - seen2) % n
    return (known_first - gap) % n
