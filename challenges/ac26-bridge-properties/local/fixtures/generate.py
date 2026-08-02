"""The statements, the verifiers under audit, and the flag -- all from FLAG_SEED.

The relation is deliberately small integer arithmetic and not a real proof system:

    the prover claims to know w with   a*w + b == c  (mod p)   and   lo <= w <= hi

Everything a participant reasons about is in these few dozen lines, so the difficulty
is telling the *properties* apart, not reading a cryptography library.

Three properties, and the whole problem is that they are independent:

    complete   every w the statement is TRUE of is accepted
    sound      no w the statement is FALSE of is accepted
    private    the record a run leaves says nothing about w

A panel is three verifiers over the same two statements, each breaking exactly one of
the three and holding the other two. Two panels ship: `p`, which this deployment is
audited on, and `q`, handed over for the transfer stage, whose defects wear different
flavours so that a shape memorised on `p` does not carry.

Two constructions here are not decoration.

**Which verifier holds which defect is drawn from the seed.** With a fixed assignment
the classification would be the same sentence on every deployment, which makes it a
remembered string rather than a reading -- and a remembered string travels between
participants. Every verifier is described to the participant by what it checks and by
what it wrote down, so the classification is derived on screen and never recalled.

**The incompleteness is only demonstrable on the edge statement.** A verifier whose
sole defect is a strict range bound behaves exactly like a correct one on any statement
whose honest witness sits strictly inside the range, so its incompleteness is real and
unobservable there. The edge statement puts the honest witness exactly on the bound the
incomplete verifier is strict about. A property being broken and a property being
demonstrable are different things, and making the second true is the author's job.
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass

#: The three properties, in the order everything prints them.
PROPERTIES = ("complete", "sound", "private")

#: What a verifier can be broken in. Exactly one per verifier, exactly one per panel.
ROLES = ("incomplete", "unsound", "leaky")

#: The panel this deployment is audited on, and the one handed over for `transfer`.
LIVE = "p"
TRANSFER = "q"

#: Small enough that any single step checks on a calculator, large enough that the
#: relation is not solvable by eye.
_PRIMES = (101, 103, 107, 109, 113, 127, 131, 137, 139, 149)


@dataclass(frozen=True)
class Statement:
    """One claim: a*w + b == c (mod p), with w claimed to be in [lo, hi]."""

    name: str
    p: int
    a: int
    b: int
    c: int
    lo: int
    hi: int
    #: The value the honest prover used. Never printed as itself.
    witness: int

    def rendered(self) -> str:
        return (
            f"p={self.p} a={self.a} b={self.b} c={self.c} lo={self.lo} hi={self.hi}"
        )


@dataclass(frozen=True)
class Verifier:
    """One toy verifier: what range it enforces, and what it writes down."""

    id: str
    role: str
    #: How the range half of the statement is enforced. `closed` is the correct one.
    range_rule: str
    #: The key it records that moves with w, or "" when its record is independent of w.
    audit_key: str

    def range_text(self) -> str:
        return _RANGE_TEXT[self.range_rule]


#: How each range rule reads, for `show`. `closed` is what the statement actually says.
_RANGE_TEXT = {
    "closed": "lo <= w <= hi",
    "strict-lo": "lo < w <= hi",
    "strict-hi": "lo <= w < hi",
    "none": "(no range check at all)",
    "upper-only": "w <= hi",
}

#: What each audit key means in words, so the record is readable rather than a riddle.
AUDIT_NOTE = {
    "position_in_range": "how far above the low end of the range the value sat",
    "room_left": "how far below the high end of the range the value sat",
}

#: The flavour each role wears on each panel. Different on `q` for every role, because
#: the transfer stage measures whether the reading survives a change of shape.
_FLAVOURS = {
    LIVE: {
        "incomplete": ("strict-lo", ""),
        "unsound": ("none", ""),
        "leaky": ("closed", "position_in_range"),
    },
    TRANSFER: {
        "incomplete": ("strict-hi", ""),
        "unsound": ("upper-only", ""),
        "leaky": ("closed", "room_left"),
    },
}

#: Which end of the range the edge statement's honest witness sits on, per panel. It is
#: the end the panel's incomplete verifier is strict about -- otherwise that verifier
#: accepts it and the stage has no answer.
_EDGE_END = {LIVE: "lo", TRANSFER: "hi"}


def _stream(seed: str, label: str) -> list[int]:
    """A deterministic byte stream for (seed, label). Not a CSPRNG; it does not need to be."""
    out: list[int] = []
    counter = 0
    while len(out) < 64:
        out.extend(hashlib.sha256(f"{seed}:{label}:{counter}".encode()).digest())
        counter += 1
    return out


def _pick(stream: list[int], index: int, low: int, high: int) -> int:
    """Uniform-enough choice in [low, high]. The ranges are tiny, so modulo bias is irrelevant."""
    return low + ((stream[index] * 256 + stream[index + 1]) % (high - low + 1))


# --------------------------------------------------------------------------- statements


def _statement(
    seed: str, panel_name: str, label: str, at_end: str, avoid: int | None = None
) -> Statement:
    """One statement, with an honest witness that is not `avoid`.

    `at_end` puts the honest witness on `lo`, on `hi`, or strictly inside.

    `lo <= p//3` and `hi - lo <= p//3` together keep `hi < p`, which is what makes the
    in-range witness unique: `a` is invertible modulo a prime, so the congruence has one
    solution per residue class, and a window narrower than `p` contains at most one of
    them. A stage with two answers would be a worse bug than a stage with none, because
    it grades as a pass for the wrong reading.

    `avoid` exists for a collision two of these stages would otherwise share. The main
    and edge statements are drawn independently, so on roughly one seed in forty their
    honest witnesses came out equal -- and `recover` and `reject` then have the same
    answer, which credits a participant who did one reading for having done two. Redrawn
    with a salted label until they differ, so it is arithmetic rather than luck. A sweep
    over seeds found this; no single playthrough would have.
    """
    for attempt in range(32):
        candidate = _draw_statement(seed, panel_name, label, at_end, attempt)
        if avoid is None or candidate.witness != avoid:
            return candidate
    raise AssertionError(f"no statement for {panel_name}:{label} avoids {avoid}")


def _draw_statement(
    seed: str, panel_name: str, label: str, at_end: str, attempt: int
) -> Statement:
    suffix = "" if attempt == 0 else f"#{attempt}"
    s = _stream(seed, f"statement:{panel_name}:{label}{suffix}")
    p = _PRIMES[s[0] % len(_PRIMES)]
    a = _pick(s, 2, 1, p - 1)
    lo = _pick(s, 4, 2, p // 3)
    hi = lo + _pick(s, 6, 5, p // 3)
    if at_end == "lo":
        witness = lo
    elif at_end == "hi":
        witness = hi
    else:
        witness = _pick(s, 8, lo + 1, hi - 1)
    b = _pick(s, 10, 0, p - 1)
    return Statement(
        name=label,
        p=p,
        a=a,
        b=b,
        c=(a * witness + b) % p,
        lo=lo,
        hi=hi,
        witness=witness,
    )


# --------------------------------------------------------------------------- panels


@dataclass(frozen=True)
class Panel:
    """Three verifiers over two statements: the unit an audit is done on."""

    name: str
    main: Statement
    edge: Statement
    verifiers: tuple[Verifier, ...]

    def statements(self) -> tuple[Statement, ...]:
        return (self.main, self.edge)

    def by_id(self, verifier_id: str) -> Verifier | None:
        for verifier in self.verifiers:
            if verifier.id == verifier_id:
                return verifier
        return None

    def by_role(self, role: str) -> Verifier:
        for verifier in self.verifiers:
            if verifier.role == role:
                return verifier
        raise KeyError(f"panel {self.name} has no {role} verifier")

    def ids(self) -> tuple[str, ...]:
        return tuple(verifier.id for verifier in self.verifiers)


def _permutation(seed: str, panel_name: str) -> tuple[str, ...]:
    """Which of the three ids carries which role, drawn from the seed."""
    s = _stream(seed, f"roles:{panel_name}")
    remaining = list(ROLES)
    chosen: list[str] = []
    for index in range(len(ROLES)):
        chosen.append(remaining.pop(_pick(s, 2 * index, 0, len(remaining) - 1)))
    return tuple(chosen)


def panel(seed: str, name: str = LIVE) -> Panel:
    """The panel of three verifiers, with this deployment's statements."""
    roles = _permutation(seed, name)
    verifiers = tuple(
        Verifier(
            id=f"{name}{index + 1}",
            role=role,
            range_rule=_FLAVOURS[name][role][0],
            audit_key=_FLAVOURS[name][role][1],
        )
        for index, role in enumerate(roles)
    )
    main = _statement(seed, name, "main", "inside")
    return Panel(
        name=name,
        main=main,
        edge=_statement(seed, name, "edge", _EDGE_END[name], avoid=main.witness),
        verifiers=verifiers,
    )


# --------------------------------------------------------------------------- the claim


def satisfies_congruence(statement: Statement, w: int) -> bool:
    """The algebraic half of the claim, with no range condition."""
    return (statement.a * w + statement.b) % statement.p == statement.c % statement.p


def in_range(statement: Statement, w: int) -> bool:
    return statement.lo <= w <= statement.hi


def is_true_of(statement: Statement, w: int) -> bool:
    """What the statement actually claims: the congruence AND the range."""
    return satisfies_congruence(statement, w) and in_range(statement, w)


def _range_ok(verifier: Verifier, statement: Statement, w: int) -> bool:
    if verifier.range_rule == "closed":
        return statement.lo <= w <= statement.hi
    if verifier.range_rule == "strict-lo":
        return statement.lo < w <= statement.hi
    if verifier.range_rule == "strict-hi":
        return statement.lo <= w < statement.hi
    if verifier.range_rule == "upper-only":
        return w <= statement.hi
    if verifier.range_rule == "none":
        return True
    raise ValueError(f"unknown range rule: {verifier.range_rule}")


def accepts(verifier: Verifier, statement: Statement, w: int) -> bool:
    return satisfies_congruence(statement, w) and _range_ok(verifier, statement, w)


def record(verifier: Verifier, statement: Statement, w: int) -> dict[str, object]:
    """What a run leaves behind for a later auditor to read.

    Every verifier writes one. Only the leaky one writes something that moves with `w`,
    and that is the whole of its defect: the verdict is right, the record is the leak.
    """
    entry: dict[str, object] = {
        "verifier": verifier.id,
        "statement": statement.name,
        "checked": ["congruence"] + ([] if verifier.range_rule == "none" else ["range"]),
    }
    if verifier.audit_key == "position_in_range":
        entry["audit"] = {"position_in_range": w - statement.lo}
    elif verifier.audit_key == "room_left":
        entry["audit"] = {"room_left": statement.hi - w}
    return entry


# --------------------------------------------------------------------------- properties


#: Values a privacy check compares records over. Any two distinct ones would do; a few
#: are used so that a coincidence cannot make a leaky verifier look private.
def _privacy_probes(statement: Statement) -> tuple[int, ...]:
    return (statement.lo, statement.hi, 0, statement.p - 1, statement.witness)


def holds(verifier: Verifier, panel_: Panel, prop: str) -> bool:
    """Whether one verifier holds one property, decided by running it rather than by a table.

    Each of the three is checked as the definition reads, over both of the panel's
    statements:

      complete  no w the statement is true of is refused
      sound     no w the statement is false of is accepted
      private   no two runs with different w leave different records

    Deciding it this way rather than from a stored matrix means a change to a verifier's
    definition changes the grading with it, instead of leaving a table that says what the
    verifier used to do.
    """
    if prop == "complete":
        for statement in panel_.statements():
            for w in range(statement.lo, statement.hi + 1):
                if is_true_of(statement, w) and not accepts(verifier, statement, w):
                    return False
        return True
    if prop == "sound":
        for statement in panel_.statements():
            # One full period below and above the window, so every residue class is
            # represented on both sides of the range.
            for w in range(-statement.p, 2 * statement.p):
                if accepts(verifier, statement, w) and not is_true_of(statement, w):
                    return False
        return True
    if prop == "private":
        for statement in panel_.statements():
            probes = _privacy_probes(statement)
            first = record(verifier, statement, probes[0])
            for w in probes[1:]:
                if record(verifier, statement, w) != first:
                    return False
        return True
    raise ValueError(f"unknown property: {prop}")


def matrix(panel_: Panel) -> dict[str, dict[str, bool]]:
    """The full classification of a panel, one row per verifier."""
    return {
        verifier.id: {prop: holds(verifier, panel_, prop) for prop in PROPERTIES}
        for verifier in panel_.verifiers
    }


def well_posed(panel_: Panel) -> list[str]:
    """Everything that has to be true for the panel's stages to have answers at all.

    Returned rather than asserted so callers can decide what to do; the judge treats a
    non-empty list as a reason to refuse to grade, because a panel that has collapsed
    grades every answer the same way and reports it as a pass.
    """
    problems: list[str] = []
    table = matrix(panel_)
    for verifier in panel_.verifiers:
        broken = [prop for prop in PROPERTIES if not table[verifier.id][prop]]
        if broken != [_PROPERTY_OF_ROLE[verifier.role]]:
            problems.append(
                f"{verifier.id} is meant to break only {_PROPERTY_OF_ROLE[verifier.role]}, "
                f"and breaks {broken or 'nothing'}"
            )
    for prop in PROPERTIES:
        breakers = [vid for vid in table if not table[vid][prop]]
        if len(breakers) != 1:
            problems.append(f"{prop} is broken by {len(breakers)} verifiers, not one")

    edge = panel_.edge
    main = panel_.main
    if not is_true_of(edge, edge.witness):
        problems.append("the edge statement is not true of its own witness")
    if accepts(panel_.by_role("incomplete"), edge, edge.witness):
        problems.append("the incomplete verifier accepts the edge witness, so `reject` has no answer")
    # `reject` grades over both statements, so the main statement's witness has to be a
    # near miss rather than a second answer: valid, and accepted by all three.
    if any(not accepts(verifier, main, main.witness) for verifier in panel_.verifiers):
        problems.append("the main statement's witness is refused, so `reject` has two answers")
    forged = forged_value(panel_)
    if forged is None:
        problems.append("no value outside the range is accepted, so `forge` has no answer")
    elif len({edge.witness, panel_.main.witness, forged}) != 3:
        # Two stages with the same answer is worse than a stage with none: it grades as
        # a pass for a participant who only did one of the readings.
        problems.append("two of the three answers coincide")
    return problems


#: Which property each role breaks. The single place the two vocabularies meet.
_PROPERTY_OF_ROLE = {"incomplete": "complete", "unsound": "sound", "leaky": "private"}


# --------------------------------------------------------------------------- answers


def forged_value(panel_: Panel) -> int | None:
    """A w outside the range that the panel's unsound verifier accepts, or None.

    The congruence is modulo p, so its solutions repeat every p. Which side of the range
    a usable one lies on depends on what the unsound verifier still checks -- a panel
    that dropped the range entirely takes either, one that kept only the upper bound
    takes the one below.
    """
    statement = panel_.main
    unsound = panel_.by_role("unsound")
    for offset in (1, -1, 2, -2):
        candidate = statement.witness + offset * statement.p
        if not in_range(statement, candidate) and accepts(unsound, statement, candidate):
            return candidate
    return None


def flag(seed: str) -> str:
    """Derived from the per-deploy seed, so it can be neither memorised nor guessed."""
    return f"TC{{bridge_properties_{hashlib.sha256(f'flag:{seed}'.encode()).hexdigest()[:20]}}}"
