"""Reference implementation. Lives inside the image only; never mounted to the host.

Used by two things: the mutation suite (which breaks copies of this file and asserts
the hidden tests catch each break), and the `reference-test` CI target.
"""

from __future__ import annotations


def advance(start: int, step: int, rounds: int, modulus: int) -> list[int]:
    trace: list[int] = []
    value = start % modulus
    for _ in range(rounds):
        value = (value + step) % modulus
        trace.append(value)
    return trace


def _prime_factors(n: int) -> list[int]:
    primes: list[int] = []
    divisor = 2
    while divisor * divisor <= n:
        if n % divisor == 0:
            primes.append(divisor)
            while n % divisor == 0:
                n //= divisor
        divisor += 1
    if n > 1:
        primes.append(n)
    return primes


def count_no_walkback(step: int, low: int, high: int) -> int:
    primes = _prime_factors(step)

    def up_to(n: int) -> int:
        if n < 1:
            return 0
        products = [(1, 0)]
        for prime in primes:
            products += [(product * prime, size + 1) for product, size in products]
        total = 0
        for product, size in products:
            if size:
                total += n // product if size % 2 else -(n // product)
        return total

    return up_to(high) - up_to(low - 1)
