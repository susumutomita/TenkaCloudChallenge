"""What `open`, `row`, `product` and `transfer` actually decide, and why.

Three questions, one per line of the protocol, asked of a participant who is one
party and can therefore only answer them the way a party would.

`open` -- `d = x - a` and `e = y - b` are sharings, so a party's row of each is one
row minus one row. Opening them means every party broadcasts its two rows and
everyone adds up. `beaver show` prints every other party's broadcast and not the
participant's own, so the stage costs exactly one local subtraction and one sum --
which is the whole of what "one round" buys.

`row` -- the linear combination. `c + d*b + e*a` is linear in the shares, so each
party computes its own row; `d*e` is a public scalar and exactly one party folds it
in. The participant is not that party in the live case and is in the transfer case,
so neither answer can be reached by doing what worked on the other.

`product` -- the desk published a reconstruction from a run that mishandled the
public scalar, in a way `beaver show` states outright. Say what the product actually
is. Everything in the correction is public: the two opened values and the party
count.

`transfer` -- the same three readings on a second multiplication, and the reason the
stage exists is that all three of the first ones can be cleared by someone who found
one shape and repeated it. The second one has a different field, a different party
count, makes the participant the designated party, and is faulty in the opposite
direction -- nobody folded the scalar in rather than everybody. So `published -
(n-1)*d*e` is wrong there, and wrong by a different shape rather than a different
number.

A rejection reports what is not satisfied and never the value that would satisfy it.
`open` reports **how many** of the two openings are wrong and not which, because
naming one hands the other over by subtraction. `row` and `product` do not name near
misses at all: "you folded the scalar in" is the answer minus `d*e`.
"""

from __future__ import annotations

import sys
from dataclasses import dataclass, field
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fixtures.generate import (
    TRANSFER,
    correct_row,
    designated_party,
    field_modulus,
    opened,
    party_count,
    product,
    published_total,
    your_index,
)

#: The three readings `transfer` takes at once, in the order it prints them.
TRANSFER_NAMES = ("open", "row", "product")


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
    """`"1234, 567"` -> `['1234', '567']`. Commas and spaces both separate."""
    pieces: list[str] = []
    for argument in arguments:
        for piece in argument.replace(",", " ").split():
            pieces.append(piece.strip())
    return pieces


def _element(token: str, p: int) -> int:
    try:
        value = int(token, 10)
    except ValueError:
        raise ValueError(f"{token!r} is not a whole number") from None
    if not 0 <= value < p:
        raise ValueError(
            f"{value} is not an element of the field. Every row, every opening and "
            f"every reconstruction is reduced into [0, {p}): -1 and {p - 1} are the "
            "same element, and a subtraction that went negative is not finished"
        )
    return value


def parse_integers(arguments: list[str], what: str, count: int, p: int) -> list[int]:
    """Exactly `count` field elements from argv, or ValueError with the reason."""
    pieces = split_pieces(arguments)
    if not pieces:
        raise ValueError(f"{what} is missing")
    if len(pieces) != count:
        raise ValueError(
            f"{len(pieces)} values given, and {what} is "
            + ("one number" if count == 1 else f"{count} numbers")
        )
    return [_element(token, p) for token in pieces]


def parse_named(arguments: list[str], names: tuple[str, ...]) -> dict[str, str]:
    """`open=12,34 row=56 product=78` -> a dict of raw strings, or ValueError."""
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


# --------------------------------------------------------------------------- open


def check_open(seed: str, case: str, arguments: list[str]) -> Verdict:
    """Grade the two values the round makes public."""
    p = field_modulus(seed, case)
    answer = opened(seed, case)
    verdict = Verdict(passed=False)

    try:
        claimed = parse_integers(arguments, "an opening", 2, p)
    except ValueError as error:
        return verdict.say(f"that is not an opening: {error}").say().say(
            "  two numbers, d then e, separated by a comma, each reduced into "
            f"[0, {p}):"
        ).say("  beaver open 0,0")

    wrong = sum(
        1 for got, want in zip(claimed, (answer["d"], answer["e"])) if got != want
    )
    if wrong:
        return verdict.say(
            f"NOT YET: {wrong} of the two openings is not what the round produced."
            if wrong == 1
            else "NOT YET: neither of those is what the round produced."
        ).say().say(
            "  d is the sharing X - a, opened. e is the sharing Y - b, opened. Both are"
        ).say(
            "  differences of two sharings, so a party's row of one is its row of X"
        ).say(
            "  minus its row of a -- and opening means adding up every party's row."
        ).say().say(
            "  `beaver show` prints every other party's broadcast. The one it does not"
        ).say("  print is yours, because computing it is the local step.")

    verdict.passed = True
    return verdict.say("ACCEPTED: those are the two values the round makes public.").say().say(
        "  publishing them gives nothing away. The a in d = x - a was made during"
    ).say(
        "  preprocessing and nobody holds it in the clear -- you have one row of it and"
    ).say(
        "  no more -- so d is x under a one-time mask. Reuse the triple and the same a"
    ).say("  masks two secrets, and that stops being true.")


# --------------------------------------------------------------------------- row


def check_row(seed: str, case: str, arguments: list[str]) -> Verdict:
    """Grade the participant's own row of the product."""
    p = field_modulus(seed, case)
    verdict = Verdict(passed=False)

    try:
        claimed = parse_integers(arguments, "a row", 1, p)[0]
    except ValueError as error:
        return verdict.say(f"that is not a row: {error}").say().say(
            f"  a row is one number, reduced into [0, {p}), for example:"
        ).say("  beaver row 0")

    if claimed != correct_row(seed, case):
        return verdict.say("NOT YET: that is not your row of the product.").say().say(
            "  three of the four terms of x*y = c + d*b + e*a + d*e are linear in the"
        ).say(
            "  shares, so your row of each is your own row. The fourth is not a sharing"
        ).say(
            "  at all -- d and e are public now, so d*e is a public scalar, and a public"
        ).say(
            "  scalar is folded in by exactly ONE party. `beaver show` says which one"
        ).say(
            f"  that is (party {designated_party(seed, case)}) and which one you are"
            f" (party {your_index(seed, case)})."
        )

    verdict.passed = True
    return verdict.say("ACCEPTED: that is your row of the product.").say().say(
        "  you produced it from your own five numbers and two public values. The"
    ).say(
        "  multiplication cost one round of talking, and everything on either side of"
    ).say("  that round happened inside one party.")


# --------------------------------------------------------------------------- product


def check_product(seed: str, case: str, arguments: list[str]) -> Verdict:
    """Grade the value a correct run would have reconstructed to."""
    p = field_modulus(seed, case)
    verdict = Verdict(passed=False)

    try:
        claimed = parse_integers(arguments, "a product", 1, p)[0]
    except ValueError as error:
        return verdict.say(f"that is not a product: {error}").say().say(
            f"  a product is one number, reduced into [0, {p}), for example:"
        ).say("  beaver product 0")

    if claimed == published_total(seed, case):
        return verdict.say(
            "NOT YET: that is the number the desk published, and the run that produced "
            "it mishandled the public scalar."
        ).say().say(
            "  `beaver show` states what the implementation did with it. Undo exactly "
            "that."
        )

    if claimed != product(seed, case):
        return verdict.say("NOT YET: a correct run does not reconstruct to that.").say().say(
            "  `beaver show` states what this implementation did with the public scalar,"
        ).say(
            f"  and there are {party_count(seed, case)} parties. Work out what the rows "
            "summed to"
        ).say(
            "  under that fault and what they should have summed to. The"
        ).say(
            "  difference is made of the two opened values and the party count, all of"
        ).say("  which are public -- and it does not have the same shape in both runs.")

    verdict.passed = True
    return verdict.say("ACCEPTED: that is what the desk should have published.").say().say(
        "  the triple was made before anyone knew x or y, so all of that work sat in"
    ).say(
        "  preprocessing. What was left online was one subtraction per party, one round"
    ).say("  of broadcasts, and a linear combination.")


# --------------------------------------------------------------------------- transfer


def check_transfer(seed: str, arguments: list[str]) -> Verdict:
    """Grade all three readings on the second multiplication. All three must hold."""
    verdict = Verdict(passed=False)

    try:
        claimed = parse_named(arguments, TRANSFER_NAMES)
    except ValueError as error:
        return verdict.say(f"that is not a transfer answer: {error}").say().say(
            "  all three readings at once, on one line:"
        ).say("  beaver transfer open=0,0 row=0 product=0")

    parts = (
        ("open", check_open(seed, TRANSFER, [claimed["open"]])),
        ("row", check_row(seed, TRANSFER, [claimed["row"]])),
        ("product", check_product(seed, TRANSFER, [claimed["product"]])),
    )
    for name, inner in parts:
        if inner.passed:
            continue
        verdict.say(f"-- {name} --")
        for line in inner.lines:
            verdict.say(line)
        verdict.say()
        cleared = [other for other, result in parts if result.passed]
        # Which of the three already hold is a property of the participant's own
        # submission rather than of the answer, so saying it costs nothing and saves
        # them re-deriving a reading that was already right.
        verdict.say(
            f"  {', '.join(cleared)} already "
            + ("holds" if len(cleared) == 1 else "hold")
            + "; all three have to be right at once."
            if cleared
            else "  all three have to be right at once."
        )
        return verdict

    verdict.passed = True
    return verdict.say("ACCEPTED: all three readings hold on the second one too.").say().say(
        "  different field, different party count, you as the designated party rather"
    ).say(
        "  than an ordinary one, and a fault in the opposite direction. None of the"
    ).say(
        "  numbers from the first multiplication was worth anything here, and neither"
    ).say("  was its correction.").say("  run `beaver flag`.")
