"""Exact finite checks for a paper-based game design; not a game grader."""

from fractions import Fraction as F
from itertools import combinations


def atan_interval(x, n):
    partial = sum((-1) ** k * x ** (2 * k + 1) / (2 * k + 1) for k in range(n))
    next_partial = partial + (-1) ** n * x ** (2 * n + 1) / (2 * n + 1)
    return min(partial, next_partial), max(partial, next_partial)


def main():
    pairs = [(a, d) for a in (0, 1) for d in range(6)]
    for rows, expected in ((2, 1), (3, 2), (4, 4), (5, 6)):
        actual = min(sum(a + d for a, d in choice) for choice in combinations(pairs, rows))
        assert actual == expected
        print(f"toy candidate bound: {rows} rows -> minimum exponent {actual}")

    mixed = ((0, 0), (0, 1), (1, 0), (1, 1))
    assert len(set(mixed)) == 4
    assert sum(a + d for a, d in mixed) == 4
    assert sum(a + d for a, d in ((0, d) for d in range(4))) == 6

    nu, b = 3, F(3, 5)
    assert 2 * b - 1 == nu * (1 - b) - 1 == F(1, 5)
    assert 2 * F(1, 2) - 1 == 0
    assert nu * (1 - F(2, 3)) - 1 == 0
    assert 1 - F(1, 2) == F(1, 2)
    assert not any(2 * F(n, 100) - 1 > 0 and 2 * (1 - F(n, 100)) - 1 > 0 for n in range(101))
    assert not any(2 * F(n, 10) - 1 > 0 and F(9, 4) * (1 - F(n, 10)) - 1 > 0 for n in range(11))
    assert 2 * F(27, 50) - 1 > 0
    assert F(9, 4) * (1 - F(27, 50)) - 1 > 0

    theta, a, b2, c = F(4, 9), F(13, 20), F(33, 50), F(3, 2)
    assert 0 < theta < a < b2 < 1
    assert nu * (a - theta) > 1 - theta
    assert a * a < theta
    assert c > 1 and b2 < 1 / c and b2 < c * theta < 1
    delta, allocation = 1 - theta, (1 - a) / (1 - theta)
    assert theta - a * a == (2 * allocation - 1) * delta - allocation**2 * delta**2
    print("Lemma 4.1 finite parameter conditions: passed")

    determinant = 1 * F(3, 4) - 1 * F(1, 2)
    assert determinant == F(1, 4)
    assert 16 * determinant == 4 and determinant >= F(1, 16)

    # Machin's identity pi = 16 atan(1/5) - 4 atan(1/239).
    lo5, hi5 = atan_interval(F(1, 5), 35)
    lo239, hi239 = atan_interval(F(1, 239), 10)
    pi_lo, pi_hi = 16 * lo5 - 4 * hi239, 16 * hi5 - 4 * lo239
    error_lo, error_hi = F(355, 113) - pi_hi, F(355, 113) - pi_lo
    assert 0 < error_lo < error_hi < F(1, 113**3)
    print("355/113 error interval is positive and below 1/113^3: passed")
    print("Finite design checks passed. No infinite theorem or game runtime was tested.")


if __name__ == "__main__":
    main()
