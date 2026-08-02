"""What the four stages actually decide, and why.

The four are not four exercises. They are the same loop, taken apart:

`predict` -- say where the counter lands **before** you look. The only thing that
makes a prediction worth anything is that it was committed to first, so the honest
trace is printed on a correct prediction and withheld on a wrong one. A wrong
prediction gets the first round worked out instead: enough to find the slip, not
enough to skip the work.

`locate` -- read a trace that came out of a broken implementation and name the first
entry that leaves [0, modulus). Not "is it wrong" -- *where it first goes wrong*.
That is the difference between knowing an output is bad and being able to debug it,
and the rest of this track leans on it constantly.

`rule` -- write one line that gives the final value for parameters you have not been
shown. Graded by agreement with the counter over a **structured** family of
parameters rather than over the case in front of you, because the case in front of
you is satisfied by writing its answer down as a constant. The family crosses the
edges that separate a rule from a coincidence: a step that runs backwards, a step of
zero, a step larger than the modulus, a start already outside the window, and no
rounds at all.

`transfer` -- the same first two readings, on a counter that runs the other way. It
exists because the first three can all be cleared by a participant who found one
shape and repeated it, and running backwards is where that participant stops. It is
deliberately the same two questions rather than a new kind of question: this is the
first problem in the track, and the point is to show that the reading generalises,
not to add a fifth thing to learn.

No message here ever contains the value it is asking for. Every rejection names what
is not satisfied and hands back something the participant can act on.
"""

from __future__ import annotations

import sys
from dataclasses import dataclass, field
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fixtures.generate import (
    PARAMETERS,
    Case,
    broken_case,
    final_value,
    first_break,
    in_window,
    main_case,
    rule_family,
    trace,
    transfer_broken_case,
    transfer_case,
)
from lab.expr import ExpressionError, compile_rule, join_arguments

#: A rule that is wrong for the most ordinary reason -- it never brings the value back
#: into the window. If the family cannot fail this, the family has collapsed into
#: something that would accept anything, and `check_rule` refuses to grade against it.
def _unreduced(values: dict[str, int]) -> int:
    return values["start"] + values["step"] * values["rounds"]


@dataclass
class Verdict:
    """A pass/fail plus the lines the CLI prints. Never carries the answer."""

    passed: bool
    lines: list[str] = field(default_factory=list)

    def say(self, line: str = "") -> "Verdict":
        self.lines.append(line)
        return self


def parse_integer(arguments: list[str], what: str) -> int:
    """A single integer from argv, or ValueError with the reason."""
    pieces = [piece for argument in arguments for piece in argument.split() if piece]
    if not pieces:
        raise ValueError(f"no {what} given")
    if len(pieces) > 1:
        raise ValueError(f"{len(pieces)} values given, and {what} is one number")
    try:
        return int(pieces[0], 10)
    except ValueError:
        raise ValueError(f"{pieces[0]!r} is not a whole number") from None


def parse_named(arguments: list[str], names: tuple[str, ...]) -> dict[str, int]:
    """`predict=4 locate=3` -> a dict, or ValueError with the reason."""
    values: dict[str, int] = {}
    pieces = [piece for argument in arguments for piece in argument.split() if piece]
    for piece in pieces:
        if "=" not in piece:
            raise ValueError(f"{piece!r} is not name=value")
        name, _, raw = piece.partition("=")
        name = name.strip()
        if name not in names:
            raise ValueError(f"unknown name {name!r}; expected " + " and ".join(names))
        if name in values:
            raise ValueError(f"{name} is given twice")
        try:
            values[name] = int(raw.strip(), 10)
        except ValueError:
            raise ValueError(f"{raw.strip()!r} is not a whole number") from None
    missing = [name for name in names if name not in values]
    if missing:
        raise ValueError("no value for " + " or ".join(missing))
    return values


# --------------------------------------------------------------------------- predict


def _first_round(case: Case) -> str:
    """One round worked out, so a wrong prediction has somewhere to restart from."""
    before = case.start % case.modulus
    after = (before + case.step) % case.modulus
    remaining = case.rounds - 1
    return (
        f"  round 1: {before} + ({case.step}) brought back into [0, {case.modulus}) is {after}."
        + (f" {remaining} round(s) to go." if remaining > 0 else "")
    )


def check_predict(seed: str, arguments: list[str]) -> Verdict:
    """Grade a prediction of the final value of this deployment's main case."""
    case = main_case(seed)
    verdict = Verdict(passed=False)

    try:
        claimed = parse_integer(arguments, "a prediction")
    except ValueError as error:
        return verdict.say(f"that is not a prediction: {error}").say().say(
            "  a prediction is one whole number, for example:"
        ).say("  counter predict 0")

    verdict.say(f"case: {case.rendered()}")
    verdict.say(f"you predict the counter ends at {claimed}.")
    verdict.say()

    if not in_window(claimed, case.modulus):
        return verdict.say(
            f"NOT YET: {claimed} is outside [0, {case.modulus}), and every value this "
            "counter takes is inside it."
        ).say().say(
            "  whatever the arithmetic gives you, the last thing a round does is bring the "
            "value back into the window."
        )

    if claimed != final_value(case):
        return verdict.say("NOT YET: the counter ends somewhere else.").say().say(
            "  one round worked out, so you can check where your arithmetic and the "
            "counter's part company:"
        ).say(_first_round(case)).say().say(
            "  the trace stays hidden until the prediction is right. That is the whole "
            "point of predicting: a number copied out of the answer measures nothing."
        )

    verdict.passed = True
    verdict.say("ACCEPTED: that is where it ends.")
    verdict.say()
    verdict.say("  here is what actually happened, round by round:")
    verdict.say(f"  {trace(case)}")
    verdict.say()
    verdict.say("  every entry is inside [0, {}) -- that is the promise. Next: `counter show`".format(case.modulus))
    verdict.say("  prints a trace from an implementation that broke it.")
    return verdict


# --------------------------------------------------------------------------- locate


def _locate_verdict(
    case: Case, values: list[int], answer: int, claimed: int, label: str
) -> Verdict:
    """Shared by `locate` and the locate half of `transfer`."""
    verdict = Verdict(passed=False)
    if not 0 <= claimed < len(values):
        return verdict.say(
            f"NOT YET: {claimed} is not an index of the {label}, which has {len(values)} "
            f"entries numbered 0 to {len(values) - 1}."
        )
    entry = values[claimed]
    if in_window(entry, case.modulus):
        return verdict.say(
            f"NOT YET: entry {claimed} of the {label} is {entry}, and "
            f"0 <= {entry} < {case.modulus}. That entry keeps the promise."
        ).say().say(
            "  the question is where the promise is first broken, so read from entry 0 and "
            "stop at the first value that is not inside the window."
        )
    if claimed != answer:
        return verdict.say(
            f"NOT YET: entry {claimed} is {entry}, which is outside [0, {case.modulus}) -- "
            "but it is not the first entry that is."
        ).say().say("  an earlier entry has already left the window. Start again from entry 0.")
    verdict.passed = True
    return verdict.say(f"ACCEPTED: entry {claimed} is {entry}, the first one outside the window.")


def check_locate(seed: str, arguments: list[str]) -> Verdict:
    """Grade the index where this deployment's broken trace first leaves the window."""
    case, values, answer = broken_case(seed)
    verdict = Verdict(passed=False)

    try:
        claimed = parse_integer(arguments, "an index")
    except ValueError as error:
        return verdict.say(f"that is not an index: {error}").say().say(
            "  an index is one whole number, counting entries from 0, for example:"
        ).say("  counter locate 0")

    inner = _locate_verdict(case, values, answer, claimed, "trace")
    for line in inner.lines:
        verdict.say(line)
    if not inner.passed:
        return verdict
    verdict.passed = True
    return verdict.say().say(
        "  that implementation added the step and then forgot to bring the value back "
        "into the window, on more than one round -- so the trace leaves the window more "
        "than once, and only the first one tells you where the fault is."
    ).say(
        "  reading a trace for the FIRST broken invariant, rather than for a wrong answer "
        "at the end, is the habit the rest of this track is built on."
    )


# --------------------------------------------------------------------------- rule


def check_rule(seed: str, arguments: list[str]) -> Verdict:
    """Grade a one-line rule for the final value, over the whole parameter family."""
    verdict = Verdict(passed=False)
    source = join_arguments(arguments)
    if not source:
        return verdict.say(
            "no rule given. A rule is one expression in start, step, rounds and modulus. "
            "Quote it -- `*` is a shell glob:"
        ).say('  counter rule "start % modulus"')

    try:
        rule = compile_rule(source, PARAMETERS)
    except ExpressionError as error:
        return verdict.say(f"that is not an expression: {error}").say().say(
            "  names: " + ", ".join(PARAMETERS)
        ).say("  operators: + - * % ( ) and whole numbers")

    verdict.say(f"rule: {source}")
    verdict.say()

    family = rule_family(seed)
    # A family that cannot fail even the most ordinary wrong rule would make the
    # comparison below vacuously true and accept everything. Fail closed and loudly:
    # a checkpoint nobody can fail is worse than no checkpoint.
    if not any(_unreduced(case.as_dict()) != final_value(case) for case in family):
        raise AssertionError("the parameter family cannot fail an unreduced rule")

    for case in family:
        try:
            claimed = rule(case.as_dict())
        except ExpressionError as error:
            return verdict.say(f"REJECTED: the rule has no value for some parameters: {error}").say(
                f"  it broke on {case.rendered()}"
            )
        if claimed == final_value(case):
            continue
        verdict.say("REJECTED: the rule and the counter disagree.")
        verdict.say(f"  parameters: {case.rendered()}")
        verdict.say(f"  your rule gives {claimed}.")
        verdict.say()
        if not in_window(claimed, case.modulus):
            return verdict.say(
                f"  {claimed} is outside [0, {case.modulus}), so it cannot be where this "
                "counter stands whatever the rounds did."
            )
        return verdict.say(
            "  work that case through by hand -- it is only "
            f"{case.rounds} round(s) -- and compare."
        )

    verdict.passed = True
    return verdict.say(
        f"ACCEPTED: the rule agrees with the counter on all {len(family)} parameter sets."
    ).say().say(
        "  including a step that runs backwards, a step of zero, a step larger than the "
        "modulus, a start already outside the window, and no rounds at all."
    ).say("  run `counter show` again: there is one more case.")


# --------------------------------------------------------------------------- transfer


TRANSFER_NAMES = ("predict", "locate")


def check_transfer(seed: str, arguments: list[str]) -> Verdict:
    """Grade both readings on the backwards counter. Both have to be right at once."""
    case = transfer_case(seed)
    broken, values, answer = transfer_broken_case(seed)
    verdict = Verdict(passed=False)

    try:
        claimed = parse_named(arguments, TRANSFER_NAMES)
    except ValueError as error:
        return verdict.say(f"that is not a transfer answer: {error}").say().say(
            "  both readings at once, on one line:"
        ).say("  counter transfer predict=0 locate=0")

    verdict.say(f"predict case: {case.rendered()}")
    verdict.say(f"broken case:  {broken.rendered()}")
    verdict.say()

    if not in_window(claimed["predict"], case.modulus):
        return verdict.say(
            f"NOT YET: predict={claimed['predict']} is outside [0, {case.modulus}). Running "
            "backwards does not change the window; it changes which side a value falls off."
        )
    if claimed["predict"] != final_value(case):
        return verdict.say("NOT YET: the backwards counter ends somewhere else.").say().say(
            _first_round(case)
        ).say().say(
            "  a step below zero is brought back into the window by adding the modulus, not "
            "by subtracting it."
        )

    inner = _locate_verdict(broken, values, answer, claimed["locate"], "broken trace")
    if not inner.passed:
        for line in inner.lines:
            verdict.say(line)
        return verdict.say().say(
            "  the prediction is right. Only the index is not, so read that trace again."
        )

    verdict.passed = True
    return verdict.say(
        f"ACCEPTED: the counter ends where you said, and entry {claimed['locate']} "
        f"({values[claimed['locate']]}) is the first one outside the window."
    ).say().say(
        "  that implementation kept a negative value instead of bringing it back up by a "
        "modulus, so the trace left the window downwards and stayed out for a while. The "
        "promise it broke is the same one."
    ).say("  run `counter flag`.")
