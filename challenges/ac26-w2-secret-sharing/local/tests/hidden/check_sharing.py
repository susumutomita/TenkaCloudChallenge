"""Hidden tests. Run by /verify against a copy of the learner's sharing.py.

The interesting checks are not the round trip -- that is arithmetic. They are:

  * `complete_shares` works for EVERY secret in the field given the same n-1 shares.
    That is the executable form of "n-1 shares reveal nothing": if every secret is
    consistent with what you hold, what you hold is not evidence.
  * `rerandomize` preserves the secret while moving every share, checked as a
    metamorphic property rather than against a fixed expected list.
  * The all-shares-equal-secret degenerate split (the starter's) is rejected, because
    it satisfies the round trip while leaking the secret to party 0 outright.
  * `share_line` / `reconstruct_line` (two-of-three) are graded as a pair of
    properties, never against the reference line: any two of the three points walk
    back to the secret in either order, and each point alone can be produced -- by the
    learner's own `share_line` -- for every secret in the field. The moduli differ from
    the public one and two of them are ~10^4, where the statement's trial search for
    the multiplicative partner is fine and a try-every-secret search is not.

Failure messages name the property, never the expected value.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from fixtures.generate import (  # noqa: E402
    LINE_PARTIES,
    PRIMES,
    line_cases,
    randomness,
    rerandomization_randomness,
    setting,
    share_randomness,
)

LABELS = ("h0", "h1", "h2", "h3")


def check_roundtrip(module, seed: str) -> list[str]:
    failures: list[str] = []
    for label in LABELS:
        cfg = setting(seed, label)
        p, n, secret = cfg["p"], cfg["n"], cfg["secret"]
        try:
            shares = module.share(
                secret, n, p, share_randomness(seed, label, n - 1, p, secret)
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
                secret, n, p, share_randomness(seed, label, n - 1, p, secret)
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
                secret, n, p, share_randomness(seed, label, n - 1, p, secret)
            )
            fresh = module.rerandomize(
                list(shares),
                p,
                rerandomization_randomness(seed, f"{label}-rr", n - 1, p),
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


# --- two-of-three -------------------------------------------------------------------


def _is_int(value: object) -> bool:
    return isinstance(value, int) and not isinstance(value, bool)


def _line_points(
    module, secret: int, p: int, slope: int
) -> tuple[list[list[int]] | None, str | None]:
    """Call the learner's share_line once and validate the shape of what came back.

    Returns the three points normalized to `[x, y]` lists, or a property-level
    failure. The shape is part of the documented contract (three `[x, y]` pairs at
    x = 1, 2, 3, y in [0, modulus)), so naming it does not narrow any hidden value.
    """
    try:
        points = module.share_line(secret, p, [slope])
    except Exception as error:  # noqa: BLE001 - a raising solution is a failing solution
        return None, f"share_line raised {type(error).__name__}"
    if not isinstance(points, list) or len(points) != 3:
        return None, "share_line did not return three points"
    normalized: list[list[int]] = []
    for party, point in zip(LINE_PARTIES, points):
        if not isinstance(point, (list, tuple)) or len(point) != 2:
            return None, "a point from share_line is not an [x, y] pair"
        x, y = point
        if not _is_int(x) or not _is_int(y):
            return None, "a point from share_line has a non-integer coordinate"
        if x != party:
            return None, "the points from share_line are not at x = 1, 2, 3 in that order"
        if not 0 <= y < p:
            return None, "a y value from share_line is outside [0, modulus)"
        normalized.append([x, y])
    return normalized, None


def _line_functions_present(module) -> list[str]:
    failures: list[str] = []
    for name in ("share_line", "reconstruct_line"):
        if not callable(getattr(module, name, None)):
            failures.append(f"{name} is not defined in sharing.py")
    return failures


def check_line_pairs(module, seed: str) -> list[str]:
    """Any two of the three points must walk back to the secret, in either order.

    Runs on every case in `line_cases`, including the ~10^4 moduli: there, the
    statement's trial search for the partner that multiplies to 1 costs at most p
    steps per reconstruction, and a search over every (secret, slope) pair costs
    about p^2 and runs into the verifier's time limit instead.
    """
    failures = _line_functions_present(module)
    if failures:
        return failures
    for case in line_cases(seed):
        p, secret = case["p"], case["secret"]
        points, failure = _line_points(module, secret, p, case["slope"])
        if failure is not None or points is None:
            failures.append(failure or "share_line did not return three points")
            continue
        for i, j in ((0, 1), (0, 2), (1, 2)):
            for pair in ([points[i], points[j]], [points[j], points[i]]):
                try:
                    recovered = module.reconstruct_line([list(point) for point in pair], p)
                except Exception as error:  # noqa: BLE001
                    failures.append(f"reconstruct_line raised {type(error).__name__}")
                    return failures
                if not _is_int(recovered) or not 0 <= recovered < p:
                    failures.append("reconstruct_line returned a value outside [0, modulus)")
                elif recovered != secret:
                    failures.append("two of the three points did not walk back to the secret")
    return failures


def _point_matches(module, candidate: int, p: int, slope: int, position: int, y: int) -> bool:
    points, failure = _line_points(module, candidate, p, slope)
    return failure is None and points is not None and points[position][1] == y


def check_line_privacy(module, seed: str) -> list[str]:
    """One point alone must be consistent with every secret in the field.

    For each party's point, every candidate secret must be producible at that same
    position by *some* slope value -- checked with the learner's own `share_line`, so
    any construction with the property passes, not only the reference line. This is a
    p x p search per point, so it runs on the small-modulus cases only.
    """
    failures = _line_functions_present(module)
    if failures:
        return failures
    for case in line_cases(seed):
        p = case["p"]
        if p not in PRIMES:
            continue
        points, failure = _line_points(module, case["secret"], p, case["slope"])
        if failure is not None or points is None:
            failures.append(failure or "share_line did not return three points")
            continue
        for position, (x, y) in enumerate(points):
            for candidate in range(p):
                if not any(
                    _point_matches(module, candidate, p, slope, position, y)
                    for slope in range(p)
                ):
                    failures.append(
                        f"party {x}'s point alone already narrows the secret down, "
                        "so one point is not hiding it"
                    )
                    break
    return failures


def run(module, seed: str) -> list[str]:
    return [
        *check_roundtrip(module, seed),
        *check_no_trivial_split(module, seed),
        *check_completion(module, seed),
        *check_rerandomize(module, seed),
        *check_line_pairs(module, seed),
        *check_line_privacy(module, seed),
    ]
