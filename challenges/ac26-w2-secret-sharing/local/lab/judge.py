"""What the four stages decide, and why.

The four are not four exercises. They are one claim -- *n-1 shares are independent of
the secret* -- taken apart:

`recover`  -- add up a ledger whose every share is on screen. The round trip, and the
              only stage that is just arithmetic. It is here because the contrast with
              the next stage is the entire problem: this view determines the total, and
              the next one, which is one share shorter, determines nothing.

`complete` -- write one line that produces the missing share for ANY target. If, holding
              the same n-1 shares, you can land on every element of the field, then those
              n-1 shares are not evidence about the total. That is an executable
              definition of "it does not leak", and it beats any amount of prose. Graded
              against a family of (target, known, modulus) rather than against the case
              on screen, because the case on screen is satisfied by writing its answer
              down as a constant.

`refresh`  -- construct a set of offsets that leaves the total where it is and moves
              every single share. Both halves matter: offsets summing to zero that
              include a zero have not refreshed that party, and offsets that all move but
              do not sum to zero have changed the secret.

`transfer` -- the same three, on a different modulus, a different number of parties, a
              different missing party -- and with the visible shares no longer pre-summed
              for you. That last change is what a transfer is: the same question with one
              layer of scaffolding taken away.

No message here ever contains the value it is asking for. Every rejection names what is
not satisfied and hands back something the participant can act on.
"""

from __future__ import annotations

import sys
from dataclasses import dataclass, field
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fixtures.generate import (
    LIVE,
    PARAMETERS,
    TRANSFER,
    Ledger,
    completes_to,
    completion,
    completion_family,
    family_is_vacuous,
    ledger_a,
    ledger_b,
    setting,
    target_value,
)
from lab.expr import ExpressionError, compile_rule, join_arguments


@dataclass
class Verdict:
    """A pass/fail plus the lines the CLI prints. Never carries the answer."""

    passed: bool
    lines: list[str] = field(default_factory=list)

    def say(self, line: str = "") -> "Verdict":
        self.lines.append(line)
        return self

    def absorb(self, other: "Verdict") -> "Verdict":
        for line in other.lines:
            self.say(line)
        return self


# --------------------------------------------------------------------------- parsing


def parse_integer(arguments: list[str], what: str) -> int:
    """A single integer from argv, or ValueError with the reason."""
    pieces = [piece for argument in arguments for piece in argument.split() if piece]
    if not pieces:
        raise ValueError(f"no {what} given")
    if len(pieces) > 1:
        raise ValueError(f"{len(pieces)} values given, and the {what} is one number")
    try:
        return int(pieces[0], 10)
    except ValueError:
        raise ValueError(f"{pieces[0]!r} is not a whole number") from None


def parse_offsets(argument: str) -> list[int]:
    """`3,5,9,84` -> a list, or ValueError with the reason.

    Commas rather than spaces, so the whole vector survives as one argv entry and the
    transfer stage can carry it inside a `refresh=` field.
    """
    text = argument.strip()
    if not text:
        raise ValueError("no offsets given")
    if " " in text:
        raise ValueError("separate the offsets with commas and no spaces, like 3,5,9,84")
    values: list[int] = []
    for piece in text.split(","):
        piece = piece.strip()
        if not piece:
            raise ValueError("there is an empty slot between two commas")
        try:
            values.append(int(piece, 10))
        except ValueError:
            raise ValueError(f"{piece!r} is not a whole number") from None
    return values


def parse_named(arguments: list[str], names: tuple[str, ...]) -> dict[str, str]:
    """`recover=57 complete=12 refresh=3,5,9,84` -> a dict of raw strings.

    Values are left as text because one of them is a comma-separated vector; each stage
    parses its own.
    """
    values: dict[str, str] = {}
    for piece in [p for argument in arguments for p in argument.split() if p]:
        if "=" not in piece:
            raise ValueError(f"{piece!r} is not name=value")
        name, _, raw = piece.partition("=")
        name = name.strip()
        if name not in names:
            raise ValueError(f"unknown name {name!r}; expected " + " and ".join(names))
        if name in values:
            raise ValueError(f"{name} is given twice")
        values[name] = raw.strip()
    missing = [name for name in names if name not in values]
    if missing:
        raise ValueError("no value for " + " or ".join(missing))
    return values


# --------------------------------------------------------------------------- recover


def judge_recover(ledger: Ledger, claimed: int) -> Verdict:
    """The total of a ledger whose every share is on screen."""
    verdict = Verdict(passed=False)
    raw = sum(ledger.shares)
    if claimed == ledger.secret:
        verdict.passed = True
        return verdict.say(f"ACCEPTED: ledger {ledger.name} adds up to {claimed}.")
    if claimed == raw and raw != ledger.secret:
        return verdict.say(
            f"NOT YET: {claimed} is the sum before it is brought back into "
            f"[0, {ledger.p}). Every element of this field is in that window, and a "
            "total is an element of the field."
        )
    if not 0 <= claimed < ledger.p:
        return verdict.say(
            f"NOT YET: {claimed} is outside [0, {ledger.p}), so it is not an element of "
            "this field at all."
        )
    return verdict.say(
        f"NOT YET: ledger {ledger.name} does not add up to {claimed}."
    ).say().say(
        f"  add its {len(ledger.shares)} shares and bring the total back into "
        f"[0, {ledger.p}). Every share is on screen; this stage is the round trip and "
        "nothing more."
    )


def check_recover(seed: str, arguments: list[str]) -> Verdict:
    ledger = ledger_a(seed, LIVE)
    verdict = Verdict(passed=False)
    try:
        claimed = parse_integer(arguments, "total")
    except ValueError as error:
        return verdict.say(f"that is not a total: {error}").say().say(
            "  a total is one whole number, for example:"
        ).say("  shares recover 0")
    return _finish(verdict, judge_recover(ledger, claimed))


# --------------------------------------------------------------------------- complete


def check_complete(seed: str, arguments: list[str]) -> Verdict:
    """Grade a one-line completion rule over the whole parameter family."""
    verdict = Verdict(passed=False)
    source = join_arguments(arguments)
    if not source:
        return verdict.say(
            "no rule given. A rule is one expression in target, known and modulus. "
            "Quote it -- `*` is a shell glob:"
        ).say('  shares complete "target % modulus"')

    try:
        rule = compile_rule(source, PARAMETERS)
    except ExpressionError as error:
        return verdict.say(f"that is not an expression: {error}").say().say(
            "  names: " + ", ".join(PARAMETERS)
        ).say("  operators: + - * % ( ) and whole numbers")

    verdict.say(f"rule: {source}")
    verdict.say()

    family = completion_family(seed)
    # A family that cannot fail even a completion that never reduces would make the
    # comparison below vacuously true and accept everything. Fail closed and loudly: a
    # stage nobody can fail is worse than no stage, because it reports as a pass.
    if family_is_vacuous(family):
        raise AssertionError("the parameter family cannot fail an unreduced completion")

    for case in family:
        try:
            claimed = rule(case.as_dict())
        except ExpressionError as error:
            return verdict.say(
                f"REJECTED: the rule has no value for some parameters: {error}"
            ).say(f"  it broke on {case.rendered()}")
        if claimed == completion(case):
            continue
        verdict.say("REJECTED: that rule does not land on the target.")
        verdict.say(f"  parameters: {case.rendered()}")
        verdict.say(f"  your rule gives {claimed}, and the visible shares already add to "
                    f"{case.known}.")
        verdict.say()
        if not 0 <= claimed < case.modulus:
            return verdict.say(
                f"  {claimed} is outside [0, {case.modulus}), so it is not an element of "
                "that field and no party could hold it."
            )
        return verdict.say(
            f"  with that share the ledger adds up to "
            f"{(case.known + claimed) % case.modulus}, and the target was {case.target}."
        )

    verdict.passed = True
    return verdict.say(
        f"ACCEPTED: the rule lands on the target for all {len(family)} parameter sets."
    ).say().say(
        "  read what that means. Holding the same n-1 shares, you can produce a final "
        "share for EVERY total in the field -- so those n-1 shares rule out nothing and "
        "are not evidence about the secret. That is the executable version of 'it does "
        "not leak', and it is the whole of why this is cryptography and not addition."
    ).say(
        "  the family included known = 0, which is what everyone except party 0 sees "
        "under the whiteboard split. The completion works there too -- which is the "
        "point: what is wrong with that split is the procedure, not the arithmetic."
    ).say("  run `shares show` again: there is one more stage.")


# --------------------------------------------------------------------------- refresh


def zero_sharing_problems(offsets: list[int], p: int, n: int) -> list[str]:
    """Why a proposed refresh is not one. An empty list means it is.

    Three requirements, and they are what a refresh is for: one offset per party, the
    total must not move (the offsets sum to zero), and every share must (no offset is
    zero modulo p). An all-zero vector satisfies the second and is not a refresh at all,
    which is the case worth being explicit about.
    """
    problems: list[str] = []
    if len(offsets) != n:
        problems.append(f"there are {n} parties and you gave {len(offsets)} offsets")
        return problems
    residue = sum(offsets) % p
    if residue != 0:
        problems.append(f"the offsets add up to {residue} modulo {p}, not 0")
    for index, offset in enumerate(offsets):
        if offset % p == 0:
            problems.append(
                f"offset {index} is 0 modulo {p}, so party {index}'s share does not move"
            )
    return problems


def judge_refresh(p: int, n: int, offsets: list[int]) -> Verdict:
    """Offsets that leave the total alone and move every share."""
    verdict = Verdict(passed=False)
    problems = zero_sharing_problems(offsets, p, n)
    if problems:
        verdict.say("NOT YET: that is not a refresh.")
        for problem in problems:
            verdict.say(f"  - {problem}")
        verdict.say()
        return verdict.say(
            "  a refresh has to do two things at once: leave the total where it is, and "
            "move every party's share. One without the other is not one."
        )
    verdict.passed = True
    return verdict.say(
        f"ACCEPTED: the {n} offsets add to 0 modulo {p}, and not one of them is 0."
    ).say().say(
        "  adding them share by share leaves the total untouched and moves every share, "
        "so the same secret is now carried by a completely different set of values. Real "
        "protocols do this between rounds so that a set of shares seen twice cannot be "
        "tied together."
    )


def check_refresh(seed: str, arguments: list[str]) -> Verdict:
    cfg = setting(seed, LIVE)
    verdict = Verdict(passed=False)
    joined = "".join(argument.strip() for argument in arguments)
    try:
        offsets = parse_offsets(joined)
    except ValueError as error:
        return verdict.say(f"that is not a set of offsets: {error}").say().say(
            f"  {cfg.n} whole numbers separated by commas, for example:"
        ).say("  shares refresh " + ",".join(["1"] * cfg.n))
    return _finish(verdict, judge_refresh(cfg.p, cfg.n, offsets))


def _finish(outer: Verdict, inner: Verdict) -> Verdict:
    outer.absorb(inner)
    outer.passed = inner.passed
    return outer


# --------------------------------------------------------------------------- transfer


TRANSFER_NAMES = ("recover", "complete", "refresh")


def judge_transfer_completion(ledger: Ledger, target: int, claimed: int) -> Verdict:
    """The missing share of the second setting's ledger B, for the printed target."""
    verdict = Verdict(passed=False)
    landed = completes_to(ledger, claimed)
    if landed != target:
        return verdict.say(
            f"NOT YET: with {claimed} as party {ledger.missing}'s share the ledger adds "
            f"up to {landed} modulo {ledger.p}, and the target was {target}."
        ).say().say(
            "  the visible shares are on screen and they are not pre-summed here. Add "
            "them yourself first."
        )
    if not 0 <= claimed < ledger.p:
        return verdict.say(
            f"NOT YET: {claimed} does land on the target, but a share is an element of "
            f"the field, and {claimed} is outside [0, {ledger.p}). Bring it into the "
            "window."
        )
    verdict.passed = True
    return verdict.say(
        f"ACCEPTED: party {ledger.missing}'s share is {claimed} for that target."
    )


def check_transfer(seed: str, arguments: list[str]) -> Verdict:
    """All three readings on the second setting, at once."""
    cfg = setting(seed, TRANSFER)
    ledger = ledger_b(seed, TRANSFER)
    target = target_value(seed, TRANSFER)
    verdict = Verdict(passed=False)

    try:
        raw = parse_named(arguments, TRANSFER_NAMES)
    except ValueError as error:
        return verdict.say(f"that is not a transfer answer: {error}").say().say(
            "  all three at once, on one line:"
        ).say("  shares transfer recover=0 complete=0 refresh=" + ",".join(["1"] * cfg.n))

    verdict.say(f"second setting: {cfg.rendered()}")
    verdict.say()

    cleared: list[str] = []

    try:
        total = int(raw["recover"], 10)
    except ValueError:
        return verdict.say(f"recover={raw['recover']!r} is not a whole number.")
    inner = judge_recover(ledger_a(seed, TRANSFER), total)
    if not inner.passed:
        return _partial(verdict, "recover", inner, cleared)
    cleared.append("recover")

    try:
        share = int(raw["complete"], 10)
    except ValueError:
        return verdict.say(f"complete={raw['complete']!r} is not a whole number.")
    inner = judge_transfer_completion(ledger, target, share)
    if not inner.passed:
        return _partial(verdict, "complete", inner, cleared)
    cleared.append("complete")

    try:
        offsets = parse_offsets(raw["refresh"])
    except ValueError as error:
        return _partial(
            verdict, "refresh", Verdict(passed=False).say(f"NOT YET: {error}"), cleared
        )
    inner = judge_refresh(cfg.p, cfg.n, offsets)
    if not inner.passed:
        return _partial(verdict, "refresh", inner, cleared)

    verdict.passed = True
    return verdict.say(
        "ACCEPTED: all three hold on the second setting too."
    ).say().say(
        "  a different modulus, a different number of parties, a different party "
        "missing, and no pre-computed sum to lean on. None of that is a different "
        "subject -- it is the same three questions asked of numbers you had not seen."
    ).say("  run `shares flag`.")


def _partial(outer: Verdict, name: str, inner: Verdict, cleared: list[str]) -> Verdict:
    outer.say(f"-- {name} --")
    outer.absorb(inner)
    if cleared:
        outer.say()
        outer.say(
            f"  {' and '.join(cleared)} came out right on this setting. Only {name} "
            "has not."
        )
    return outer
