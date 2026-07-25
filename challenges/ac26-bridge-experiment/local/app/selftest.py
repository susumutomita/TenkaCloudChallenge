"""Author-side self-test. Runs at image build time and in CI, never for participants.

Two things must hold for every possible deployment seed, not just the one on this
machine:

  1. the published broken trace has exactly one observable divergence, and it is
     never the first round (otherwise the checkpoint is found by accident);
  2. the reference result satisfies the contract the participant is given.

A seed-dependent challenge that is only well-formed for *most* seeds ships a
broken checkpoint to the unlucky remainder, and nobody finds out until a learner
is stuck on something that has no answer.
"""

from __future__ import annotations

import importlib
import os

SEEDS = 2000


def main() -> int:
    failures: list[str] = []
    original = os.environ.get("FLAG_SEED")

    for index in range(SEEDS):
        os.environ["FLAG_SEED"] = f"selftest-{index}"
        import fixtures

        importlib.reload(fixtures)
        try:
            case = fixtures.broken_trace_case()
            round_number = fixtures.broken_round()
            trace = fixtures.broken_trace()

            divergences = []
            previous = case.start % case.modulus
            for position, value in enumerate(trace, start=1):
                if value != (previous + case.step) % case.modulus:
                    divergences.append(position)
                previous = value % case.modulus

            if divergences != [round_number]:
                failures.append(
                    f"seed {index}: expected one divergence at {round_number}, got {divergences}"
                )
            if round_number < 2:
                failures.append(f"seed {index}: divergence on the first round is not traceable")
            if 0 <= trace[round_number - 1] < case.modulus:
                failures.append(f"seed {index}: the skipped reduction is not observable")

            for hidden in fixtures.hidden_cases():
                values = fixtures.expected(hidden)
                if len(values) != hidden.rounds:
                    failures.append(f"seed {index}: hidden case returned the wrong length")
                if not all(0 <= v < hidden.modulus for v in values):
                    failures.append(f"seed {index}: hidden expectation leaves [0, modulus)")
        except Exception as error:  # noqa: BLE001 - any fixture failure is a shipping blocker
            failures.append(f"seed {index}: {error}")

        if len(failures) > 5:
            break

    if original is None:
        os.environ.pop("FLAG_SEED", None)
    else:
        os.environ["FLAG_SEED"] = original

    if failures:
        for failure in failures:
            print(f"FAIL    {failure}")
        return 1
    print(f"fixtures are well-formed for all {SEEDS} sampled seeds.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
