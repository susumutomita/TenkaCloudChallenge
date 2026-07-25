"""Mutation suite: prove the hidden cases actually catch the bugs they claim to.

Each mutation is a plausible wrong `advance`. Every one of them must FAIL the
hidden-case check. A mutation that survives means the hidden cases have a hole
and the challenge would hand out points for a broken implementation.

Run with `python3 mutations.py` (CI and the image build run it; it is not part of
the participant-facing `make test`).
"""

from __future__ import annotations

import fixtures

Advance = "Callable[[int, int, int, int], list[int]]"


def reference(start: int, step: int, rounds: int, modulus: int) -> list[int]:
    return [(start + step * (i + 1)) % modulus for i in range(rounds)]


def reduce_only_at_end(start: int, step: int, rounds: int, modulus: int) -> list[int]:
    """Accumulates unreduced and reduces once at the end of each round's own sum."""
    values, value = [], start
    for _ in range(rounds):
        value += step
        values.append(value)
    return [values[-1] % modulus] * rounds if rounds else []


def never_reduces(start: int, step: int, rounds: int, modulus: int) -> list[int]:
    return [start + step * (i + 1) for i in range(rounds)]


def truncates_toward_zero(start: int, step: int, rounds: int, modulus: int) -> list[int]:
    """C-style remainder: keeps the sign of the dividend, so negatives leave [0, modulus)."""
    out = []
    for i in range(rounds):
        raw = start + step * (i + 1)
        out.append(int(raw - modulus * int(raw / modulus)))
    return out


def off_by_one_round(start: int, step: int, rounds: int, modulus: int) -> list[int]:
    """Records the value BEFORE each round instead of after it."""
    return [(start + step * i) % modulus for i in range(rounds)]


def one_round_too_many(start: int, step: int, rounds: int, modulus: int) -> list[int]:
    return [(start + step * (i + 1)) % modulus for i in range(rounds + 1)]


def hard_codes_public_case(start: int, step: int, rounds: int, modulus: int) -> list[int]:
    """Returns the visible case's answer regardless of the arguments."""
    return fixtures.expected(fixtures.public_case())


def ignores_zero_step(start: int, step: int, rounds: int, modulus: int) -> list[int]:
    """Treats step == 0 as step == 1, a real bug from 'a counter must advance'."""
    effective = step or 1
    return [(start + effective * (i + 1)) % modulus for i in range(rounds)]


MUTATIONS = {
    "reduce_only_at_end": reduce_only_at_end,
    "never_reduces": never_reduces,
    "truncates_toward_zero": truncates_toward_zero,
    "off_by_one_round": off_by_one_round,
    "one_round_too_many": one_round_too_many,
    "hard_codes_public_case": hard_codes_public_case,
    "ignores_zero_step": ignores_zero_step,
}


def _matches_all_hidden(advance) -> bool:
    for case in fixtures.hidden_cases():
        try:
            actual = advance(case.start, case.step, case.rounds, case.modulus)
        except Exception:  # noqa: BLE001 - a crashing mutation counts as killed
            return False
        if list(actual) != fixtures.expected(case):
            return False
    return True


def _verifier_rejects_wrong_answers() -> list[str]:
    """A verifier that always says yes is the one mutation the hidden cases cannot catch.

    The other mutations here are wrong implementations of `advance`. This one is a
    wrong implementation of the *scorer*: if a checkpoint handler returned success
    regardless of the submission, every hidden case above would still pass and the
    challenge would hand out its points to anyone who posted anything.

    Only the value-based checkpoints are exercised. `general-counter` reads the
    mounted submission, which does not exist at image build time.
    """
    import verifier

    failures: list[str] = []
    wrong = (
        ("environment", "TC{AC26-ENV:000000000000}"),
        ("predict", "-1"),
        ("first-divergence", "0"),
        ("unknown-checkpoint", "anything"),
    )
    for checkpoint_id, submission in wrong:
        correct, _ = verifier.evaluate(checkpoint_id, submission)
        if correct:
            failures.append(f"verifier accepted a wrong submission for {checkpoint_id}")

    # And the mirror image: a verifier that always says no is equally broken, so
    # confirm the same handlers still accept the right answers.
    right = (
        ("environment", fixtures.environment_marker()),
        ("predict", str(fixtures.expected(fixtures.predict_case())[-1])),
        ("first-divergence", str(fixtures.broken_round())),
    )
    for checkpoint_id, submission in right:
        correct, message = verifier.evaluate(checkpoint_id, submission)
        if not correct:
            failures.append(f"verifier rejected the correct answer for {checkpoint_id}: {message}")
    return failures


def main() -> int:
    failures: list[str] = []

    if not _matches_all_hidden(reference):
        failures.append("reference implementation does not satisfy its own hidden cases")

    verifier_failures = _verifier_rejects_wrong_answers()
    failures.extend(verifier_failures)
    if not verifier_failures:
        print("killed  verifier_always_succeeds")

    for name, mutation in MUTATIONS.items():
        if _matches_all_hidden(mutation):
            failures.append(f"mutation survived the hidden cases: {name}")
        else:
            print(f"killed  {name}")

    # The public case alone must NOT be enough: if it were, the hidden cases
    # would be decoration and the challenge would be passable by over-fitting.
    public = fixtures.public_case()
    survivors = [
        name
        for name, mutation in MUTATIONS.items()
        if list(mutation(public.start, public.step, public.rounds, public.modulus))
        == fixtures.expected(public)
    ]
    if not survivors:
        failures.append(
            "no mutation passes the public case — the hidden cases are not "
            "actually carrying any weight, so the challenge does not test generality"
        )
    else:
        print(f"public-case-only survivors (expected, non-empty): {sorted(survivors)}")

    if failures:
        for failure in failures:
            print(f"FAIL    {failure}")
        return 1
    print(f"\nall {len(MUTATIONS)} wrong implementations killed by the hidden cases,")
    print("and the verifier rejects wrong answers while accepting right ones.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
