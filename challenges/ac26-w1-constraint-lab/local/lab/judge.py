"""What `trace`, `admit` and `transfer` actually decide, and why.

Two judgements, three stages -- `transfer` is `trace` again on a circuit the
learner has not seen, which is the point of it.

`trace` -- the participant is the evaluator. They are given a circuit, a field and
a witness the monitor refused, and they submit the residual of every constraint,
in order. Grading is a comparison against what the evaluator computes, so it holds
for any seed without a stored answer.

What a rejection is allowed to say is the interesting decision here. A rejection
reports **how many** entries are not the residual of their constraint, and not which
ones, then points at `audit explain <id>` -- one constraint's residual with its
operand names substituted and no values.

Be exact about what that buys, because it is easy to overstate. Naming the entries
would hand over a map of where the mistakes are, and finding that is most of the work
the stage exists for; a count says how far off an attempt is without drawing the map.
It is not a barrier. A count still answers a question about one position at a time --
change one entry, watch the count go up, down, or nowhere -- so a scripted search
remains possible, at a few hundred requests rather than a few dozen. That is the
honor-system scope this problem ships under (the flag is derivable from FLAG_SEED
anyway; see the README), not something this message pretends to prevent.

`audit explain` is the help a stuck learner actually needs: the shape of the
arithmetic, rather than the location of their mistake.

Out-of-range entries are refused before any comparison, with the reason. A residual
is a field element, so -1 is not an answer even when p-1 is; saying so costs
nothing, because a learner who wrote -1 already knows which entry it was.

`admit` -- the membership gadget. The submitted expression has to be zero on
exactly the licensed values and non-zero on every other element of the field,
checked by sweeping the whole field rather than by trying a couple of values.
Sweeping is what separates the gadget from a lookup: an expression that pins only
the first licensed value passes every honest example and fails here.

A rejection here *may* name a value, because the value is a root of the
participant's own expression -- it tells them what they wrote, not what the answer
is.
"""

from __future__ import annotations

import sys
from dataclasses import dataclass, field
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fixtures.evaluator import trace as evaluate_trace
from fixtures.generate import (
    LIVE,
    allowed_set,
    circuit,
    failing_witness,
    field_modulus,
)
from lab.expr import ExpressionError, compile_expression, split_expressions

#: The signal the membership gadget constrains. Stated in `audit show`, and the
#: only name the expression compiler will accept for that stage.
MEMBERSHIP_SIGNAL = "tier"


@dataclass
class Verdict:
    """A pass/fail plus the lines the CLI prints. Never carries the answer."""

    passed: bool
    lines: list[str] = field(default_factory=list)

    def say(self, line: str = "") -> "Verdict":
        self.lines.append(line)
        return self


def parse_trace(arguments: list[str], length: int, p: int) -> list[int]:
    """`0,3,125,0,0` -> the residuals, or ValueError with a readable reason.

    Commas and spaces both separate, because a shell splits on spaces and the
    participant should not have to know which one this command wanted.
    """
    pieces = split_expressions(arguments)
    values: list[int] = []
    for piece in pieces:
        for token in piece.split():
            try:
                value = int(token)
            except ValueError:
                raise ValueError(f"{token!r} is not an integer") from None
            values.append(value)
    if not values:
        raise ValueError("no residuals given")
    if len(values) != length:
        raise ValueError(
            f"{len(values)} residuals given, and the circuit has {length} constraints"
        )
    out_of_range = [value for value in values if not 0 <= value < p]
    if out_of_range:
        raise ValueError(
            f"{out_of_range[0]} is not an element of the field. A residual is reduced "
            f"into [0, {p}): -1 and {p - 1} are the same element, and neither is 0"
        )
    return values


def check_trace(seed: str, case: str, arguments: list[str]) -> Verdict:
    """Grade a submitted trace against the residuals the evaluator computes."""
    p = field_modulus(seed, case)
    circ = circuit(seed, case)
    expected = evaluate_trace(circ, failing_witness(seed, case), p)
    verdict = Verdict(passed=False)

    try:
        submitted = parse_trace(arguments, len(circ), p)
    except ValueError as error:
        return verdict.say(f"that is not a trace: {error}").say().say(
            f"  a trace is one residual per constraint, in circuit order, separated by"
            f" commas -- {len(circ)} of them here, each reduced into [0, {p})."
        )

    wrong = sum(1 for got, want in zip(submitted, expected) if got != want)
    if wrong:
        return verdict.say(
            f"REJECTED: {wrong} of the {len(expected)} entries is not the residual of "
            f"its constraint."
            if wrong == 1
            else f"REJECTED: {wrong} of the {len(expected)} entries are not the residual "
            f"of their constraint."
        ).say().say(
            "  which ones is not reported on purpose: that would be a map of where your "
            "mistakes are, and drawing it is the exercise."
        ).say(
            f"  `audit explain <id>` prints one constraint's residual with its operands "
            f"named. Every residual is reduced into [0, {p})."
        )

    verdict.passed = True
    return verdict.say("ACCEPTED: that is the trace.").say().say(
        "  every entry is the residual its constraint claims is zero, and the ones that "
        "are not zero are where this witness stops satisfying the circuit."
    )


def check_admit(seed: str, arguments: list[str]) -> Verdict:
    """Grade a membership gadget by sweeping the whole field."""
    p = field_modulus(seed, LIVE)
    allowed = allowed_set(seed, LIVE)
    verdict = Verdict(passed=False)

    sources = split_expressions(arguments)
    if not sources:
        return verdict.say(
            "no expression given. The gadget is the residual that must come out zero. "
            'The syntax, using the boolean constraint the circuit already has: '
            f'audit admit "{MEMBERSHIP_SIGNAL}*({MEMBERSHIP_SIGNAL} - 1)"'
        )
    if len(sources) > 1:
        return verdict.say(
            f"REJECTED: {len(sources)} expressions given, and the gadget is one residual."
        ).say().say(
            "  one expression, zero on exactly the licensed values. Splitting it across "
            "several constraints is a different gadget with a different failure mode."
        )

    try:
        evaluate = compile_expression(sources[0], (MEMBERSHIP_SIGNAL,))
    except ExpressionError as error:
        return verdict.say(f"that is not an expression: {error}").say().say(
            f"  the only signal is {MEMBERSHIP_SIGNAL}"
        ).say("  operators: + - * ( ) and an optional = ; integers are literals")

    admitted = sorted(
        value for value in range(p) if evaluate({MEMBERSHIP_SIGNAL: value}, p) % p == 0
    )
    verdict.say(f"gadget: {sources[0]}  = 0")
    verdict.say(f"swept every element of F_{p}: it is zero on {len(admitted)} of them.")
    verdict.say()

    missing = [value for value in allowed if value not in admitted]
    if missing:
        return verdict.say(
            f"REJECTED: it is not zero at {MEMBERSHIP_SIGNAL} = {missing[0]}, which is licensed."
        ).say().say(
            "  a licensed tier that the gadget refuses is a legitimate request denied."
        )

    extra = [value for value in admitted if value not in allowed]
    if extra:
        return verdict.say(
            f"REJECTED: it is also zero at {MEMBERSHIP_SIGNAL} = {extra[0]}, which is not licensed."
        ).say().say(
            "  the gadget admits more than the licensed set. Every value it is zero at is "
            "a value the circuit would accept."
        ).say(
            "  (that value is a root of the expression you wrote, so it says what you "
            "wrote rather than what the answer is.)"
        )

    verdict.passed = True
    return verdict.say("ACCEPTED: zero on exactly the licensed tiers, non-zero everywhere else.")
