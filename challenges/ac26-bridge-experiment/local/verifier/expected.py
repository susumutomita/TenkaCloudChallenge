"""Hidden derivation of the `first-broken` checkpoint's answer.

Issue 543/537: `fixtures/generate.py`'s `corrupted_trace` used to return this index as a
third tuple element, and `fixtures/` ships in the participant image (`show.py` and the
public tests both need the case and the trace it returns). So the checkpoint's answer
was one `from fixtures.generate import corrupted_trace` away from inside a learner's own
container -- no need to even read the trace `show.py` prints, just call the function
with the seed already sitting in `FLAG_SEED`.

This module holds the one line that turns that trace into an answer, and it never
leaves the verifier-only Docker stage (see ../Dockerfile): the `participant` stage does
not copy `verifier/` at all. `corrupted_trace` itself stays public -- it is the evidence
the problem is about -- and only the derivation of *which position* is broken moves
here.

The derivation adds no information a learner does not already have. `first-broken` asks
for the first position where the printed trace leaves `[0, modulus)`, and the trace and
the modulus are both printed. What must not exist is a ready-made function that hands
back the position for a seed the learner never even has to look up -- that is what
skips the checkpoint's actual exercise (reading the trace), not what makes the position
"secret": it never was.
"""

from __future__ import annotations

from fixtures.generate import corrupted_trace


def first_broken_index(seed: str) -> int:
    """The 0-based index of the first trace entry outside `[0, modulus)`.

    `tests/public/test_counter.py`'s `test_the_broken_list_really_has_a_number_...`
    pins, over 200 seeds, that `corrupted_trace` always produces exactly one such
    entry -- so raising here rather than returning -1 on a fixture that broke that
    invariant is a loud failure instead of a checkpoint nobody can ever pass.
    """
    case, trace = corrupted_trace(seed)
    for index, value in enumerate(trace):
        if not 0 <= value < case.modulus:
            return index
    raise AssertionError("corrupted_trace produced no entry outside [0, modulus)")
