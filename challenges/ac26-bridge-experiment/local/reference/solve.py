"""Reference answers: derived from the seed rather than stored.

Author stage only -- the `participant` image does not carry this directory, and
nothing on the participant path imports it. See TEMPLATE.md "Assurance scope" for
what that does and does not buy.

There is no cleverness here, and that is the point: the four answers are the four
readings the problem asks for, computed the same way the participant computes them.
The rule is the only one with any freedom in it, and any expression that agrees with
the counter over the whole family is accepted -- the grading is structural, so this
particular spelling is one correct answer rather than the correct answer.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fixtures.generate import (
    broken_case,
    final_value,
    main_case,
    transfer_broken_case,
    transfer_case,
)


def predict_arguments(seed: str) -> list[str]:
    return [str(final_value(main_case(seed)))]


def locate_arguments(seed: str) -> list[str]:
    _case, _values, answer = broken_case(seed)
    return [str(answer)]


def rule_expression(_seed: str) -> str:
    """One closed form. Every round adds `step`, so `rounds` of them add `step*rounds`,
    and the window is applied last because applying it early changes nothing."""
    return "(start + step*rounds) % modulus"


def rule_arguments(seed: str) -> list[str]:
    return [rule_expression(seed)]


def transfer_arguments(seed: str) -> list[str]:
    _broken, _values, answer = transfer_broken_case(seed)
    return [f"predict={final_value(transfer_case(seed))}", f"locate={answer}"]
