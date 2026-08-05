"""Hidden tests. Run by /verify against a copy of the learner's sharing.py.

The interesting checks are not the round trip -- that is arithmetic. They are:

  * `complete_shares` works for EVERY secret in the field given the same n-1 shares.
    That is the executable form of "n-1 shares reveal nothing": if every secret is
    consistent with what you hold, what you hold is not evidence.
  * `rerandomize` preserves the secret while moving every share, checked as a
    metamorphic property rather than against a fixed expected list.
  * The all-shares-equal-secret degenerate split (the starter's) is rejected, because
    it satisfies the round trip while leaking the secret to party 0 outright.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from fixtures.generate import randomness, setting  # noqa: E402

LABELS = ("h0", "h1", "h2", "h3")


def _splitting_randomness(seed: str, label: str, n: int, p: int, secret: int) -> list[int]:
    """Randomness whose split is not itself the thing the checks reject.

    `randomness` is uniform over [0, p)^(n-1), so on these small primes a draw
    that makes the honest split degenerate is not rare. Two of them are
    questions with no answer:

      * all but one value zero, so the correct split hands the secret to one
        party outright -- which `check_no_trivial_split` reports as the
        implementation's fault;
      * every value zero, so the correct `rerandomize` is a no-op and returns
        the shares it was given -- which `check_rerandomize` reports as a
        refresh that did not happen.

    In both cases a correct implementation is required to produce exactly what
    the check calls a failure. Redraw under a fresh label until the case has an
    answer, the same way `_reuse_pair` does in ac26-w3-nonce-reuse (#361).
    """
    for attempt in range(64):
        tag = label if attempt == 0 else f"{label}-fair{attempt}"
        head = randomness(seed, tag, n - 1, p)
        split = [*head, (secret - sum(head)) % p]
        if any(value % p for value in head) and sum(1 for v in split if v % p == 0) < n - 1:
            return head
    raise AssertionError(f"no non-degenerate split for {seed}/{label} after 64 draws")


def check_roundtrip(module, seed: str) -> list[str]:
    failures: list[str] = []
    for label in LABELS:
        cfg = setting(seed, label)
        p, n, secret = cfg["p"], cfg["n"], cfg["secret"]
        try:
            shares = module.share(
                secret, n, p, _splitting_randomness(seed, label, n, p, secret)
            )
        except Exception as error:  # noqa: BLE001
            return [f"share raised {type(error).__name__}"]
        if not isinstance(shares, list) or len(shares) != n:
            failures.append("share did not return one value per party")
            continue
        if any(not isinstance(s, int) or not 0 <= s < p for s in shares):
            failures.append("a share is outside [0, modulus)")
        try:
            recovered = module.reconstruct(list(shares), p)
        except Exception as error:  # noqa: BLE001
            failures.append(f"reconstruct raised {type(error).__name__}")
            continue
        # Compared without normalizing first: reconstruct must return the canonical
        # element, not merely something congruent to it. Applying `% p` here would
        # let an implementation that never reduces pass, which the mutation suite
        # caught when this check did exactly that.
        if not isinstance(recovered, int) or not 0 <= recovered < p:
            failures.append("reconstruct returned a value outside [0, modulus)")
        elif recovered != secret % p:
            failures.append("reconstructing the full set does not return the secret")
    return failures


def check_no_trivial_split(module, seed: str) -> list[str]:
    """A split that hands the secret to one party is not a secret sharing."""
    failures: list[str] = []
    for label in LABELS:
        cfg = setting(seed, label)
        p, n, secret = cfg["p"], cfg["n"], cfg["secret"]
        if n < 2 or secret == 0:
            continue
        try:
            shares = module.share(
                secret, n, p, _splitting_randomness(seed, label, n, p, secret)
            )
        except Exception:  # noqa: BLE001 - covered by check_roundtrip
            return []
        if not isinstance(shares, list) or len(shares) != n:
            continue
        if sum(1 for s in shares if s % p == 0) >= n - 1:
            failures.append("all but one share is zero, so one party holds the secret outright")
    return failures


def check_completion(module, seed: str) -> list[str]:
    """Every secret must be reachable from the same n-1 shares."""
    failures: list[str] = []
    for label in LABELS:
        cfg = setting(seed, label)
        p, n = cfg["p"], cfg["n"]
        partial = [r % p for r in randomness(seed, f"{label}-partial", n - 1, p)]
        for candidate in range(p):
            try:
                last = module.complete_shares(list(partial), candidate, p)
            except Exception as error:  # noqa: BLE001
                return [f"complete_shares raised {type(error).__name__}"]
            if not isinstance(last, int) or not 0 <= last < p:
                failures.append("complete_shares returned a value outside [0, modulus)")
                break
            if (sum(partial) + last) % p != candidate % p:
                failures.append("the completed set does not reconstruct to the requested secret")
                break
    return failures


def check_rerandomize(module, seed: str) -> list[str]:
    failures: list[str] = []
    for label in LABELS:
        cfg = setting(seed, label)
        p, n, secret = cfg["p"], cfg["n"], cfg["secret"]
        try:
            shares = module.share(
                secret, n, p, _splitting_randomness(seed, label, n, p, secret)
            )
            fresh = module.rerandomize(
                list(shares), p, _splitting_randomness(seed, f"{label}-rr", n, p, secret)
            )
        except Exception as error:  # noqa: BLE001
            return [f"rerandomize raised {type(error).__name__}"]
        if not isinstance(fresh, list) or len(fresh) != n:
            failures.append("rerandomize did not return one value per party")
            continue
        if any(not isinstance(s, int) or not 0 <= s < p for s in fresh):
            failures.append("a rerandomized share is outside [0, modulus)")
        if sum(fresh) % p != secret % p:
            failures.append("rerandomizing changed the secret")
        if fresh == list(shares):
            failures.append("rerandomize returned the same shares, so nothing was refreshed")
    return failures


def run(module, seed: str) -> list[str]:
    return [
        *check_roundtrip(module, seed),
        *check_no_trivial_split(module, seed),
        *check_completion(module, seed),
        *check_rerandomize(module, seed),
    ]
