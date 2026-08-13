# Does that omega really take n powers to reach 1?

> This track is an independent, unofficial companion to the Advanced Cryptography Program 2026.
> It is not affiliated with or endorsed by the course or its operators. All problem statements,
> code, fixtures, and figures here are written independently. Questions about this track go to
> the TenkaCloud repository, not to the course operators.

**Track:** `advanced-cryptography-2026` · **Order:** 315 · **Chapter:** Week 3 / Roots of Unity
· **Time:** 45–75 minutes · **Points:** 200

## The story

Underneath a zkSNARK is a transform that moves a polynomial between its coefficients and its
evaluations. For it to be a transform at all, the evaluation points must be distinct — and the
only thing making them distinct is that omega has order exactly `n`.

## The gap this problem is built on

The starter builds omega as `3 ** ((p-1)/n)`. That formula is not wrong. What is missing is the
check that the omega it produced has order `n`.

| p | n | starter's omega | its actual order |
|---|---|---|---|
| 17 | 4 | 13 | 4 |
| 113 | 16 | 40 | 16 |
| 97 | 8 | 75 | **4** |
| 73 | 8 | 46 | **4** |
| 13 | 4 | **1** | **1** |

At `p=13, n=4` every evaluation point collapses onto 1. The return value is still `n` integers
inside the field, and every public test still passes, because the public tests use the pairs in
the top half of that table.

`pow(w, n, p) == 1` cannot tell these apart: it is satisfied by every element of every smaller
subgroup, 1 included. Only `pow(w, n // q, p) != 1` for each prime factor `q` of `n` pins the
order to `n` itself.

## What you implement

```python
transform(coefficients, prime, order)
  -> {"ok": True, "omega": w, "values": [...]} | {"ok": False, "error": str}

inverse_transform(values, prime, order, omega)
  -> {"ok": True, "coefficients": [...]} | {"ok": False, "error": str}
```

Any omega will do as long as its order is exactly `order`; return the one you used. The inverse
needs `1/n`, and it must refuse an omega whose powers repeat rather than return plausible numbers.

## How the hidden properties decide

Every `(p, n)` comes from the verifier seed, and **at least half of every set is a pair the
textbook rule gets wrong**, so a submission that kept the rule fails for certain rather than by
luck. The checker builds its expectations from the definition of multiplicative order, not from
the reference.

## Author commands
