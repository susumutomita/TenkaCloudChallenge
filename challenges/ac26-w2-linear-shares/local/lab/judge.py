"""What `row`, `total`, `silent` and `transfer` actually decide, and why.

Three questions, taken from three sides of the same fact -- that a linear operation
on additive shares finishes inside one party, and that a public constant is the one
place where "everyone does the same thing" stops being that.

`row` -- the participant is a party. They hold two numbers and the public values,
and they say what their own row of the desk's figure is. Nothing about the answer
requires another party, which is the point being made: if it can be answered at all
from what is on the screen, the operation was local.

`total` -- the desk published a reconstruction from a run that was faulty in a way
`shares show` states outright. Say what it should have published. The correction is
arithmetic on public values, so it is answerable; what it costs is knowing exactly
how many times the constant was folded in.

`silent` -- eight expressions, some of which every party can evaluate on its own
rows and some of which cannot be evaluated without talking. Name the ones that can.
A rejection reports **how many** are on the wrong side and never which ones: which
ones is the map of where the misreading is, and drawing that map is the stage. Be
exact about what that buys, because it is easy to overstate: a count still answers a
question about one entry at a time, so a scripted search remains possible at a few
hundred attempts rather than a few dozen. That is the honor-system scope this
problem ships under -- the flag is derivable from FLAG_SEED anyway, and the README
says so -- not something this message claims to prevent.

`transfer` -- the same three readings at a second desk, and the reason the stage
exists is that all three of the first ones can be cleared by someone who found one
shape and repeated it. The second desk moves the constant inside the scale, makes
the participant the designated party rather than an ordinary one, and is faulty in
the opposite direction (nobody folded the constant in, rather than everybody). So
`published - (n-1)*c` is wrong there, and so is a row with no constant in it.

No message here ever contains the value it is asking for, and no rejection names a
near miss whose distance from the answer is a known constant -- saying "you folded
the constant in" would hand over the answer minus c.
"""

from __future__ import annotations

import sys
from dataclasses import dataclass, field
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fixtures.generate import (
    TRANSFER,
    correct_row,
    correct_total,
    designated_party,
    expressions,
    field_modulus,
    local_ids,
    party_count,
    published_total,
    your_index,
)

#: The three readings `transfer` takes at once, in the order it prints them.
TRANSFER_NAMES = ("row", "total", "silent")


@dataclass
class Verdict:
    """A pass/fail plus the lines the CLI prints. Never carries the answer."""

    passed: bool
    lines: list[str] = field(default_factory=list)

    def say(self, line: str = "") -> "Verdict":
        self.lines.append(line)
        return self


# --------------------------------------------------------------------------- parsing


def split_pieces(arguments: list[str]) -> list[str]:
    """`"e1,e4 e7"` -> `['e1', 'e4', 'e7']`.

    Commas and spaces both separate. A shell splits on spaces and the participant
    should not have to know which one this command wanted.
    """
    pieces: list[str] = []
    for argument in arguments:
        for piece in argument.replace(",", " ").split():
            pieces.append(piece.strip())
    return pieces


def parse_integer(arguments: list[str], what: str, p: int) -> int:
    """A single field element from argv, or ValueError with the reason."""
    pieces = split_pieces(arguments)
    if not pieces:
        raise ValueError(f"{what} is missing")
    if len(pieces) > 1:
        raise ValueError(f"{len(pieces)} values given, and {what} is one number")
    try:
        value = int(pieces[0], 10)
    except ValueError:
        raise ValueError(f"{pieces[0]!r} is not a whole number") from None
    if not 0 <= value < p:
        raise ValueError(
            f"{value} is not an element of the field. Every share and every "
            f"reconstruction is reduced into [0, {p}): -1 and {p - 1} are the same "
            "element, and a negative intermediate value is not finished"
        )
    return value


def parse_named(arguments: list[str], names: tuple[str, ...]) -> dict[str, str]:
    """`row=12 total=345 silent=g1,g4` -> a dict of raw strings, or ValueError."""
    values: dict[str, str] = {}
    for piece in [p for argument in arguments for p in argument.split() if p]:
        if "=" not in piece:
            raise ValueError(f"{piece!r} is not name=value")
        name, _, raw = piece.partition("=")
        name = name.strip()
        if name not in names:
            raise ValueError(f"unknown name {name!r}; expected " + ", ".join(names))
        if name in values:
            raise ValueError(f"{name} is given twice")
        values[name] = raw.strip()
    missing = [name for name in names if name not in values]
    if missing:
        raise ValueError("no value for " + " or ".join(missing))
    return values


def parse_ids(arguments: list[str], known: list[str]) -> list[str]:
    """A list of expression ids, validated against the ones this case printed."""
    pieces = split_pieces(arguments)
    if not pieces:
        raise ValueError("no expressions named")
    seen: list[str] = []
    for piece in pieces:
        identifier = piece.lower()
        if identifier not in known:
            raise ValueError(
                f"{piece!r} is not one of the expressions on this list; they are "
                + ", ".join(known)
            )
        if identifier in seen:
            raise ValueError(f"{identifier} is named twice")
        seen.append(identifier)
    return seen


# --------------------------------------------------------------------------- row


def check_row(seed: str, case: str, arguments: list[str]) -> Verdict:
    """Grade the participant's own row of the desk's figure, computed correctly."""
    p = field_modulus(seed, case)
    verdict = Verdict(passed=False)

    try:
        claimed = parse_integer(arguments, "a row", p)
    except ValueError as error:
        return verdict.say(f"that is not a row: {error}").say().say(
            "  a row is one number, reduced into [0, {}), for example:".format(p)
        ).say("  shares row 0")

    if claimed != correct_row(seed, case):
        return verdict.say("NOT YET: that is not your row of the desk's figure.").say().say(
            "  your row of a sum of two sharings is your row of one plus your row of the"
        ).say(
            "  other. Your row of a sharing scaled by a public value is your row times"
        ).say(
            "  that value. A public constant is folded in by exactly ONE party, and"
        ).say(
            f"  `shares show` says which one that is (party {designated_party(seed, case)})"
            f" and which one you are (party {your_index(seed, case)})."
        ).say().say(
            "  work it out from the pipeline as written -- where the constant sits in it"
        ).say("  changes what happens to it.")

    verdict.passed = True
    return verdict.say("ACCEPTED: that is your row.").say().say(
        "  you produced it from your own two numbers and the values everyone already"
    ).say(
        "  knows. Nobody was asked for anything, and the rows still sum to the right"
    ).say("  figure. That is what makes a linear operation cheap.")


# --------------------------------------------------------------------------- total


def check_total(seed: str, case: str, arguments: list[str]) -> Verdict:
    """Grade the reconstruction the desk should have published."""
    p = field_modulus(seed, case)
    verdict = Verdict(passed=False)

    try:
        claimed = parse_integer(arguments, "a total", p)
    except ValueError as error:
        return verdict.say(f"that is not a total: {error}").say().say(
            "  a total is one number, reduced into [0, {}), for example:".format(p)
        ).say("  shares total 0")

    if claimed == published_total(seed, case):
        return verdict.say(
            "NOT YET: that is the number the desk published, and the run that produced "
            "it was faulty."
        ).say().say(
            "  `shares show` states what the implementation did with the public "
            "constant. Undo exactly that."
        )

    if claimed != correct_total(seed, case):
        return verdict.say("NOT YET: a correct run does not reconstruct to that.").say().say(
            f"  `shares show` states what this desk's implementation did with the public"
        ).say(
            f"  constant, and there are {party_count(seed, case)} parties. Work out what "
            "the rows summed to under"
        ).say(
            "  that fault, and what they should have summed to. The difference between"
        ).say(
            "  the two is made of public values only, and it does not have the same shape"
        ).say("  at both desks.")

    verdict.passed = True
    return verdict.say("ACCEPTED: that is what the desk should have published.").say().say(
        "  the fault was worth exactly one arithmetic step, and it survived review "
        "because"
    ).say(
        "  every part of the pipeline is linear and every part of it looked the same."
    )


# --------------------------------------------------------------------------- silent


def check_silent(seed: str, case: str, arguments: list[str]) -> Verdict:
    """Grade which of this case's expressions need no communication."""
    listed = expressions(seed, case)
    known = [str(row["id"]) for row in listed]
    answer = set(local_ids(seed, case))
    verdict = Verdict(passed=False)

    try:
        claimed = set(parse_ids(arguments, known))
    except ValueError as error:
        return verdict.say(f"that is not a list of expressions: {error}").say().say(
            "  name the ones that need no communication, separated by commas:"
        ).say(f"  shares silent {known[0]},{known[2]}")

    wrong = len(claimed ^ answer)
    if wrong:
        return verdict.say(
            f"REJECTED: {wrong} of the {len(known)} expressions is on the wrong side."
            if wrong == 1
            else f"REJECTED: {wrong} of the {len(known)} expressions are on the wrong side."
        ).say().say(
            "  which ones is not reported on purpose: that would be a map of where the"
        ).say(
            "  misreading is, and drawing it is the exercise."
        ).say().say(
            "  take them one at a time and ask the same question of each: can a party"
        ).say(
            "  produce its own row of this, from its own rows and the public values"
        ).say(
            "  alone? Adding two sharings and scaling by something public are the two"
        ).say("  things a row can do by itself.")

    verdict.passed = True
    return verdict.say(
        f"ACCEPTED: exactly the {len(answer)} that finish inside one party."
    ).say().say(
        "  every one of them is degree at most one in the shared values, with public"
    ).say(
        "  coefficients. The ones you left out multiply two shared values together, and"
    ).say(
        "  the sum of the products of the rows is not the product of the sums -- no"
    ).say("  party holds enough to make up the difference.")


# --------------------------------------------------------------------------- transfer


def check_transfer(seed: str, arguments: list[str]) -> Verdict:
    """Grade all three readings at the second desk. All three have to be right."""
    verdict = Verdict(passed=False)

    try:
        claimed = parse_named(arguments, TRANSFER_NAMES)
    except ValueError as error:
        return verdict.say(f"that is not a transfer answer: {error}").say().say(
            "  all three readings at once, on one line:"
        ).say("  shares transfer row=0 total=0 silent=g1,g2")

    parts = (
        ("row", check_row(seed, TRANSFER, [claimed["row"]])),
        ("total", check_total(seed, TRANSFER, [claimed["total"]])),
        ("silent", check_silent(seed, TRANSFER, [claimed["silent"]])),
    )
    for name, inner in parts:
        if inner.passed:
            continue
        verdict.say(f"-- {name} --")
        for line in inner.lines:
            verdict.say(line)
        verdict.say()
        cleared = [other for other, result in parts if result.passed]
        # Which of the three are already right is a property of the participant's own
        # submission, not of the answer, so saying it costs nothing and saves them from
        # re-deriving a reading that already held.
        verdict.say(
            f"  {', '.join(cleared)} already "
            + ("holds" if len(cleared) == 1 else "hold")
            + "; all three have to be right at once."
            if cleared
            else "  all three have to be right at once."
        )
        return verdict

    verdict.passed = True
    return verdict.say("ACCEPTED: all three readings hold at the second desk too.").say().say(
        "  different field, different party count, the constant inside the scale, you as"
    ).say(
        "  the designated party rather than an ordinary one, and a fault in the opposite"
    ).say(
        "  direction. None of the numbers from the first desk was worth anything here."
    ).say("  run `shares flag`.")
