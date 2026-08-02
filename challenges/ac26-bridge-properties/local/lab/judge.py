"""What the five stages decide, and why.

The five are not five exercises. They are one question -- *what does this verifier still
guarantee* -- taken apart:

`reject`   -- produce a witness the statement is TRUE of that one of the panel refuses.
              That is what a completeness break IS, and it cannot be produced at all on a
              statement whose honest witness sits strictly inside the range, which is why
              the edge statement exists.

`recover`  -- say the value the honest run used, from what a verifier wrote down. A
              privacy break is not "the record looks suspicious"; it is that the record
              determines the secret, and the only way to show that is to determine it.

`forge`    -- produce a witness the statement is FALSE of that one of the panel accepts.
              The congruence repeats every p, so the range check is the only thing
              pinning the claim down, and a verifier that dropped it proves nothing.

`classify` -- and only now, name what each of the three still holds. Locked until the
              three breaks are on the table, because a label nobody can demonstrate is
              the failure mode this problem is about. What it actually measures is the
              six entries that are NOT breaks: a verifier with one defect still holds the
              other two properties, and "it is buggy, so it is broken" is the thing being
              taken away.

`transfer` -- the same three demonstrations on a second panel whose defects wear
              different flavours and sit on different verifiers. It is deliberately the
              same three questions rather than new ones: what is being measured is
              whether the reading generalises.

No message here ever contains the value it is asking for. Every rejection names what is
not satisfied and hands back something the participant can act on -- and `review run`
answers all of it for free, so a refusal is never a dead end.
"""

from __future__ import annotations

import sys
from dataclasses import dataclass, field
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fixtures.generate import (
    LIVE,
    PROPERTIES,
    TRANSFER,
    Panel,
    accepts,
    forged_value,
    in_range,
    is_true_of,
    matrix,
    panel as build_panel,
    satisfies_congruence,
    well_posed,
)


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


class PanelCollapsed(AssertionError):
    """The panel cannot pose the question it is being graded on.

    Raised rather than swallowed. A panel whose verifiers no longer break exactly one
    property each grades every answer the same way, and a stage nobody can fail reports
    as a pass -- which is worse than a stage that is plainly broken.
    """


def checked_panel(seed: str, name: str) -> Panel:
    panel_ = build_panel(seed, name)
    problems = well_posed(panel_)
    if problems:
        raise PanelCollapsed("; ".join(problems))
    return panel_


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


def parse_named_integers(arguments: list[str], names: tuple[str, ...]) -> dict[str, int]:
    """`reject=9 forge=-118 recover=41` -> a dict, or ValueError with the reason."""
    values: dict[str, int] = {}
    for piece in [p for argument in arguments for p in argument.split() if p]:
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


def parse_classification(
    arguments: list[str], ids: tuple[str, ...]
) -> dict[str, frozenset[str]]:
    """`p1=sound,private p2=none ...` -> {id: {properties it is claimed to hold}}."""
    claimed: dict[str, frozenset[str]] = {}
    for piece in [p for argument in arguments for p in argument.split() if p]:
        if "=" not in piece:
            raise ValueError(f"{piece!r} is not <verifier>=<properties>")
        name, _, raw = piece.partition("=")
        name = name.strip()
        if name not in ids:
            raise ValueError(f"unknown verifier {name!r}; this panel is " + ", ".join(ids))
        if name in claimed:
            raise ValueError(f"{name} is given twice")
        listed = [item.strip() for item in raw.split(",") if item.strip()]
        if not listed:
            raise ValueError(
                f"{name} has no properties after the '='; write `none` if it holds none"
            )
        if listed == ["none"]:
            claimed[name] = frozenset()
            continue
        for item in listed:
            if item == "none":
                raise ValueError("`none` cannot be listed alongside a property")
            if item not in PROPERTIES:
                raise ValueError(
                    f"unknown property {item!r}; they are " + ", ".join(PROPERTIES)
                )
        if len(set(listed)) != len(listed):
            raise ValueError(f"{name} lists the same property twice")
        claimed[name] = frozenset(listed)
    missing = [name for name in ids if name not in claimed]
    if missing:
        raise ValueError("nothing said about " + " or ".join(missing))
    return claimed


# --------------------------------------------------------------------------- the three demonstrations


def judge_reject(panel_: Panel, claimed: int) -> Verdict:
    """A witness one of the panel's statements is TRUE of that one of them refuses.

    Graded over both statements rather than over the edge one alone, and that is not a
    convenience. The main statement's honest witness is a genuinely valid witness, so a
    participant who has just recovered it will try it here -- and the answer they need is
    "yes, that one is valid, and all three accept it", which is the sentence that says
    where a strict bound can and cannot be seen. Pinning the stage to the edge statement
    made that branch unreachable, and an unreachable branch is a message nobody reads and
    a requirement no test can break.
    """
    verdict = Verdict(passed=False)
    true_of = [st for st in panel_.statements() if is_true_of(st, claimed)]

    if not true_of:
        solving = [st for st in panel_.statements() if satisfies_congruence(st, claimed)]
        if not solving:
            return verdict.say(
                f"NOT YET: {claimed} satisfies neither statement's congruence, so neither "
                "of them is true of it and refusing it is correct."
            ).say().say(
                "  a completeness break needs a witness a statement really is true of."
            ).say(f"  `review run <verifier> {claimed}` shows you which half fails.")
        statement = solving[0]
        return verdict.say(
            f"NOT YET: {claimed} satisfies the {statement.name} statement's congruence, "
            f"but that statement also claims lo <= w <= hi, and "
            f"{statement.lo} <= {claimed} <= {statement.hi} is false."
        ).say().say(
            "  a verifier that refuses a witness the statement is false of is doing its "
            "job. Completeness is about the ones a statement is TRUE of."
        )

    for statement in true_of:
        refusing = [v.id for v in panel_.verifiers if not accepts(v, statement, claimed)]
        if not refusing:
            continue
        verdict.passed = True
        return verdict.say(
            f"ACCEPTED: the {statement.name} statement is true of {claimed}, and "
            f"{', '.join(refusing)} refuses it."
        ).say().say(
            "  that is a completeness break, and it is only visible where the honest "
            "witness sits on the bound that verifier is strict about. On a statement "
            "whose witness sits strictly inside the range it agrees with a correct "
            "verifier on every input. A property being broken and a property being "
            "demonstrable are different things."
        )

    names = " and ".join(statement.name for statement in true_of)
    return verdict.say(
        f"NOT YET: the {names} statement is true of {claimed}, and all three verifiers "
        "accept it. Nothing here refused anything it should not have."
    ).say().say(
        "  a strict bound is invisible on a witness that sits strictly inside the range. "
        "One of these statements has its honest witness on an END of its range -- that is "
        "the only place the difference shows."
    )


def judge_recover(panel_: Panel, claimed: int) -> Verdict:
    """The value the honest run of the main statement used."""
    statement = panel_.main
    verdict = Verdict(passed=False)
    if claimed == statement.witness:
        verdict.passed = True
        return verdict.say(
            f"ACCEPTED: {claimed} is the value the honest run used."
        ).say().say(
            "  the verdicts were right and the range check was right. What leaked is the "
            "record kept alongside them -- it moves with w, so reading it back is "
            "arithmetic rather than cryptanalysis. That is a privacy break with "
            "completeness and soundness untouched."
        )
    if satisfies_congruence(statement, claimed):
        return verdict.say(
            f"NOT YET: {claimed} does satisfy the congruence, so it is the same element "
            f"modulo {statement.p} as the value that was used."
        ).say().say(
            "  the record does not pin down a residue class, it pins down the number the "
            f"prover actually held -- and the statement says that one is in "
            f"[{statement.lo}, {statement.hi}]."
        )
    return verdict.say(
        f"NOT YET: {claimed} is not the value the honest run used."
    ).say().say(
        "  one of the three verifiers wrote down something that moves when w moves. Run "
        "it yourself on a value you choose, compare its record with the honest one in "
        "`review show`, and the direction it counts in stops being a guess:"
    ).say("      review run <verifier> <w>")


def judge_forge(panel_: Panel, claimed: int) -> Verdict:
    """A witness the main statement is FALSE of that one of the panel accepts."""
    statement = panel_.main
    verdict = Verdict(passed=False)
    if in_range(statement, claimed):
        return verdict.say(
            f"NOT YET: {statement.lo} <= {claimed} <= {statement.hi}, so the range half "
            "of the claim is satisfied and nothing here is outside the claim."
        ).say().say(
            "  a soundness break needs a w the statement is FALSE of. Being accepted is "
            "only half of it; the other half is that it should not have been."
        )
    if not satisfies_congruence(statement, claimed):
        return verdict.say(
            f"NOT YET: {claimed} is outside the range, but it does not satisfy "
            f"a*w + b == c (mod {statement.p}) either, so every verifier here refuses it."
        ).say().say(
            "  a value nothing accepts demonstrates nothing. The congruence is modulo "
            f"{statement.p}: its solutions repeat, and the range is what used to pin one "
            "of them down."
        )
    accepting = [v.id for v in panel_.verifiers if accepts(v, statement, claimed)]
    if not accepting:
        return verdict.say(
            f"NOT YET: {claimed} satisfies the congruence and is outside "
            f"[{statement.lo}, {statement.hi}], but none of the three accepted it."
        ).say().say(
            "  the solutions of the congruence run off in both directions. Which side is "
            "usable depends on what the verifier that dropped a check still checks -- "
            f"`review run <verifier> {claimed}` says so directly, and runs are free."
        )
    verdict.passed = True
    return verdict.say(
        f"ACCEPTED: the main statement is false of {claimed} -- it is outside "
        f"[{statement.lo}, {statement.hi}] -- and {', '.join(accepting)} accepts it."
    ).say().say(
        "  that verifier proves the congruence and nothing else, so the in-range half of "
        "the claim was never established at all. Its verdicts on honest witnesses are "
        "still correct, and its record still says nothing: one property, not three."
    )


# --------------------------------------------------------------------------- stage entry points


def check_reject(seed: str, arguments: list[str]) -> Verdict:
    panel_ = checked_panel(seed, LIVE)
    verdict = Verdict(passed=False)
    try:
        claimed = parse_integer(arguments, "witness")
    except ValueError as error:
        return verdict.say(f"that is not a witness: {error}").say().say(
            "  a witness is one whole number, for example:"
        ).say(f"  review reject {panel_.edge.lo}")
    verdict.say(f"main statement: {panel_.main.rendered()}")
    verdict.say(f"edge statement: {panel_.edge.rendered()}")
    verdict.say()
    return _finish(verdict, judge_reject(panel_, claimed))


def check_recover(seed: str, arguments: list[str]) -> Verdict:
    panel_ = checked_panel(seed, LIVE)
    verdict = Verdict(passed=False)
    try:
        claimed = parse_integer(arguments, "value")
    except ValueError as error:
        return verdict.say(f"that is not a value: {error}").say().say(
            "  the value is one whole number, for example:"
        ).say(f"  review recover {panel_.main.lo}")
    verdict.say(f"main statement: {panel_.main.rendered()}")
    verdict.say()
    return _finish(verdict, judge_recover(panel_, claimed))


def check_forge(seed: str, arguments: list[str]) -> Verdict:
    panel_ = checked_panel(seed, LIVE)
    verdict = Verdict(passed=False)
    try:
        claimed = parse_integer(arguments, "witness")
    except ValueError as error:
        return verdict.say(f"that is not a witness: {error}").say().say(
            "  a witness is one whole number, and it may be negative, for example:"
        ).say(f"  review forge {panel_.main.hi + 1}")
    verdict.say(f"main statement: {panel_.main.rendered()}")
    verdict.say()
    return _finish(verdict, judge_forge(panel_, claimed))


def _finish(outer: Verdict, inner: Verdict) -> Verdict:
    outer.absorb(inner)
    outer.passed = inner.passed
    return outer


# --------------------------------------------------------------------------- classify


#: The question each property answers, phrased so it can be settled with `review run`
#: rather than recalled. Printed on a wrong classification instead of the answer.
_HOW_TO_SETTLE = (
    ("complete", "is there a w the statement is TRUE of that it refuses?"),
    ("sound", "is there a w the statement is FALSE of that it accepts?"),
    ("private", "do two runs with different w leave different records?"),
)


def check_classify(seed: str, arguments: list[str]) -> Verdict:
    """Grade the full classification of the live panel."""
    panel_ = checked_panel(seed, LIVE)
    ids = panel_.ids()
    verdict = Verdict(passed=False)
    try:
        claimed = parse_classification(arguments, ids)
    except ValueError as error:
        return verdict.say(f"that is not a classification: {error}").say().say(
            "  one entry per verifier, each a comma-separated list of the properties it "
            "STILL HOLDS, or `none`:"
        ).say(f"  review classify {' '.join(f'{i}=complete,sound' for i in ids)}")

    table = matrix(panel_)
    for verifier_id in ids:
        truth = frozenset(prop for prop in PROPERTIES if table[verifier_id][prop])
        if claimed[verifier_id] == truth:
            continue
        verdict.say(f"NOT YET: the line for {verifier_id} is not what {verifier_id} does.")
        verdict.say()
        verdict.say("  settle the three one at a time, with what you have already built:")
        for prop, question in _HOW_TO_SETTLE:
            verdict.say(f"    {prop:<9} {question}")
        verdict.say()
        verdict.say(
            f"  `review run {verifier_id} <w>` answers all three and costs nothing. Note "
            "that the answers are independent: one of them being 'yes' says nothing "
            "about the other two."
        )
        return verdict

    verdict.passed = True
    return verdict.say(
        "ACCEPTED: that is what each of the three still holds."
    ).say().say(
        "  the breaks were the easy half -- you had already produced all three. The rest "
        "of the table is the point: every one of these verifiers is broken, and every one "
        "of them still guarantees two of the three things. 'It has a bug' and 'it "
        "guarantees nothing' are different sentences."
    ).say("  run `review show` again: a second panel has arrived.")


# --------------------------------------------------------------------------- transfer


TRANSFER_NAMES = ("reject", "recover", "forge")


def check_transfer(seed: str, arguments: list[str]) -> Verdict:
    """The same three demonstrations on the second panel. All three at once."""
    panel_ = checked_panel(seed, TRANSFER)
    verdict = Verdict(passed=False)
    try:
        claimed = parse_named_integers(arguments, TRANSFER_NAMES)
    except ValueError as error:
        return verdict.say(f"that is not a transfer answer: {error}").say().say(
            "  all three at once, on one line:"
        ).say("  review transfer reject=0 recover=0 forge=0")

    verdict.say(f"main statement: {panel_.main.rendered()}")
    verdict.say(f"edge statement: {panel_.edge.rendered()}")
    verdict.say()

    cleared: list[str] = []
    for name, judge in (
        ("reject", judge_reject),
        ("recover", judge_recover),
        ("forge", judge_forge),
    ):
        inner = judge(panel_, claimed[name])
        if inner.passed:
            cleared.append(name)
            continue
        verdict.say(f"-- {name} --")
        verdict.absorb(inner)
        if cleared:
            verdict.say()
            verdict.say(
                f"  {' and '.join(cleared)} came out right on this panel. Only {name} "
                "has not."
            )
        return verdict

    verdict.passed = True
    return verdict.say(
        "ACCEPTED: all three demonstrations hold on the second panel too."
    ).say().say(
        "  the defects sat on different verifiers, the strict bound was on the other end "
        "of the range, the usable side of the congruence was the other one, and the "
        "record counted the other way. None of that is a different subject -- it is the "
        "same three questions asked of parameters you had not seen."
    ).say("  run `review flag`.")
