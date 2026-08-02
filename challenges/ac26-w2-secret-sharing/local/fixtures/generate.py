"""Ledgers, settings and the flag, all derived from the per-deploy FLAG_SEED.

Additive secret sharing over F_p: a secret is split into n values that sum to it.
The arithmetic is three lines. What makes it cryptography is that **any n-1 of those
values are independent of the secret** -- and that is something to demonstrate, not to
assert.

Two ledgers per setting, because the two readings need different views:

  ledger A   every share is on screen. Adding them up is the round trip, and it is
             the one stage that is just arithmetic.
  ledger B   one share is missing and its total is never printed. This is the view a
             coalition of n-1 parties actually has, and the whole question is what it
             does and does not tell them.

`known` -- the sum of ledger B's visible shares -- is deliberately handed over
**unreduced**. A rule that forgets to bring it back into [0, modulus) is then wrong on
the deployment's own numbers rather than only on an edge case nobody meets, and the
family below crosses that edge in both directions.

The second setting exists for the transfer stage. It changes the modulus, the number of
parties, which party is missing -- and it does not pre-sum the visible shares. That last
one is the point of a transfer: the same question with one layer of scaffolding removed.

Nothing here ships a committed constant. Same seed, same numbers (so a session is
reproducible); different seed, different numbers (so an answer copied from someone
else's run does not carry).
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass

#: The names a completion rule may use, and the order a case is printed in.
PARAMETERS = ("target", "known", "modulus")

#: This deployment's setting, and the one handed over for the transfer stage.
LIVE = "main"
TRANSFER = "second"

#: Small enough to add up on paper, large enough that a sum of two shares usually
#: leaves the window -- which is what makes the reduction in a completion rule matter.
_PRIMES = (97, 101, 103, 107, 109, 113, 127, 131, 137, 139)


@dataclass(frozen=True)
class Setting:
    """One deployment of the sharing: a field and a number of parties."""

    name: str
    p: int
    n: int

    def rendered(self) -> str:
        return f"modulus p = {self.p}, parties n = {self.n}"


@dataclass(frozen=True)
class Ledger:
    """One sharing. `missing` is the party whose share is not on screen, or -1."""

    name: str
    p: int
    shares: tuple[int, ...]
    missing: int

    @property
    def secret(self) -> int:
        return sum(self.shares) % self.p

    def visible(self) -> tuple[int, ...]:
        if self.missing < 0:
            return self.shares
        return tuple(s for index, s in enumerate(self.shares) if index != self.missing)

    def known(self) -> int:
        """The raw, unreduced sum of the visible shares. Unreduced on purpose."""
        return sum(self.visible())


@dataclass(frozen=True)
class Case:
    """One (target, known, modulus) a completion rule is graded on."""

    target: int
    known: int
    modulus: int

    def as_dict(self) -> dict[str, int]:
        return {name: getattr(self, name) for name in PARAMETERS}

    def rendered(self) -> str:
        return " ".join(f"{name}={getattr(self, name)}" for name in PARAMETERS)


def _stream(seed: str, label: str) -> list[int]:
    """A deterministic byte stream for (seed, label). Not a CSPRNG; it does not need to be."""
    out: list[int] = []
    counter = 0
    while len(out) < 96:
        out.extend(hashlib.sha256(f"{seed}:{label}:{counter}".encode()).digest())
        counter += 1
    return out


def _pick(stream: list[int], index: int, low: int, high: int) -> int:
    return low + ((stream[index] * 256 + stream[index + 1]) % (high - low + 1))


# --------------------------------------------------------------------------- settings


def setting(seed: str, name: str = LIVE) -> Setting:
    """The field and party count.

    `n >= 3` on purpose. With two parties "all of them" and "all but one" differ by a
    single share, the refresh stage degenerates to one offset and its negation, and the
    sentence "any n-1 of them tell you nothing" stops being interesting.

    The second setting differs from the first in **both** the modulus and the party
    count, redrawn until it does. A transfer whose only change is which index is missing
    measures nothing: the arithmetic is the same either way.
    """
    s = _stream(seed, f"setting:{name}")
    if name == LIVE:
        return Setting(name=name, p=_PRIMES[s[0] % len(_PRIMES)], n=_pick(s, 2, 3, 6))
    live = setting(seed, LIVE)
    for attempt in range(64):
        t = _stream(seed, f"setting:{name}#{attempt}")
        p = _PRIMES[t[0] % len(_PRIMES)]
        n = _pick(t, 2, 3, 5)
        if p != live.p and n != live.n:
            return Setting(name=name, p=p, n=n)
    raise AssertionError(f"no second setting for {seed!r} differs from the first")


def _draw_shares(seed: str, label: str, count: int, p: int, attempt: int) -> tuple[int, ...]:
    s = _stream(seed, f"shares:{label}#{attempt}")
    return tuple(_pick(s, (index * 2) % 90, 0, p - 1) for index in range(count))


def ledger_a(seed: str, name: str = LIVE) -> Ledger:
    """The sharing whose every share is on screen. `recover` adds it up."""
    cfg = setting(seed, name)
    return Ledger(
        name="A",
        p=cfg.p,
        shares=_draw_shares(seed, f"{name}:a", cfg.n, cfg.p, 0),
        missing=-1,
    )


def ledger_b(seed: str, name: str = LIVE) -> Ledger:
    """The sharing a coalition of n-1 parties sees. Its total is never printed.

    Two constraints on the draw, both of which change what the stage teaches:

    * `known` (the raw sum of the visible shares) has to **exceed the modulus**, so a
      completion rule that never reduces is wrong on this deployment's own numbers and
      not merely on some case in the family.
    * ledger B's total has to differ from ledger A's, or `recover` and the transfer's
      completion collapse into the same number for the wrong reason.
    """
    cfg = setting(seed, name)
    missing = cfg.n - 1 if name == LIVE else _missing_party(seed, cfg)
    other = ledger_a(seed, name).secret
    for attempt in range(64):
        shares = _draw_shares(seed, f"{name}:b", cfg.n, cfg.p, attempt)
        ledger = Ledger(name="B", p=cfg.p, shares=shares, missing=missing)
        if ledger.known() > cfg.p and ledger.secret != other:
            return ledger
    raise AssertionError(f"no ledger B for {seed!r}/{name} with an unreduced known sum")


def _missing_party(seed: str, cfg: Setting) -> int:
    """Which party is absent in the second setting: never the last one.

    On the live setting the missing party is the last, which is where the arithmetic
    puts it if you write the sharing out left to right. Somewhere else on the second
    setting, so the participant reads the ledger rather than assuming its shape.
    """
    return _pick(_stream(seed, f"missing:{cfg.name}"), 0, 0, cfg.n - 2)


def target_value(seed: str, name: str = TRANSFER) -> int:
    """The total the transfer stage asks a completion to land on."""
    cfg = setting(seed, name)
    return _pick(_stream(seed, f"target:{name}"), 0, 0, cfg.p - 1)


# --------------------------------------------------------------------------- the arithmetic


def completion(case: Case) -> int:
    """The missing share: whatever makes the visible ones add up to the target."""
    return (case.target - case.known) % case.modulus


def completes_to(ledger: Ledger, share: int) -> int:
    """The total ledger B reaches when the missing party holds `share`."""
    return (ledger.known() + share) % ledger.p


# What makes a set of offsets a refresh lives in `lab/judge.py`, not here: it is a
# judgement rather than a fixture, and the mutation suite breaks the judge one
# requirement at a time. A requirement that sits in this file is one the suite cannot
# reach, and an unreachable requirement is one nothing tests.


# --------------------------------------------------------------------------- the family


def completion_family(seed: str) -> list[Case]:
    """The (target, known, modulus) sets a submitted completion rule is graded on.

    Built by hand rather than sampled. What separates a rule from a coincidence here is
    the edges: a target below `known`, a `known` far above the modulus (which is what a
    raw sum of several shares looks like), a `known` of zero -- which is exactly the view
    the whiteboard split gives everybody except party 0 -- and a target of zero.
    Uniform draws would mostly produce ordinary cases that nearly every wrong rule
    survives.

    This deployment's own ledger B is in the family, against several targets, so a rule
    has to agree with the numbers on screen as well as with the edges.
    """
    live = setting(seed, LIVE)
    ledger = ledger_b(seed, LIVE)
    family: list[Case] = [
        Case(target=target, known=ledger.known(), modulus=live.p)
        for target in (0, 1, live.p - 1, ledger.known() % live.p)
    ]
    second = setting(seed, TRANSFER)
    for modulus in sorted({7, 97, live.p, second.p}):
        for known in (0, 1, modulus - 1, modulus, modulus + 1, 5 * modulus + 3):
            for target in (0, 1, modulus // 2, modulus - 1):
                family.append(Case(target=target, known=known, modulus=modulus))
    return family


def family_is_vacuous(family: list[Case]) -> bool:
    """True when the family cannot fail a completion that never reduces.

    A family in that state accepts every rule, and a stage nobody can fail reports as a
    pass. Callers check this before grading and refuse rather than proceed.
    """
    return not any(case.target - case.known != completion(case) for case in family)


def flag(seed: str) -> str:
    """Derived from the per-deploy seed, so it can be neither memorised nor guessed."""
    return f"TC{{w2_secret_sharing_{hashlib.sha256(f'flag:{seed}'.encode()).hexdigest()[:20]}}}"
