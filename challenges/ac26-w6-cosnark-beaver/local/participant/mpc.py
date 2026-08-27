"""The supplied sharing layer: shares, triples, the instrumented runtime, and `[A]`/`[B]`.

Two problems are **supplied** here. `ac26-w2-beaver-mul` built the multiplication protocol
itself, and `ac26-w6-cosnark-linear` built the prover's linear layer and the runtime that
proves it stayed local. This problem is what happens when those meet: the one place in a
co-SNARK's prover row where the parties have to talk. None of this module is graded --
`starter/prover.py` is.

## The row, and the half that is not free

    A = sum_j a_j w_j        B = sum_j b_j w_j        C = A * B        (mod p)

`A` and `B` are the linear halves and cost nothing -- that was the previous problem, and both
sharings are handed to you already built by `linear_halves`. `C` is a product of two
**shared** values, and the product of the sums is not the sum of the products, so no
arrangement of local operations produces it. One round of communication is the price.

## What the runtime records

Every operation appends an event carrying the operation type, the party, the operand ids and
the result id -- never a value. `open` is the exception and is meant to be: an opened value is
public by definition, so the log records it. Openings carry a `roundId`, and a round is a
distinct `roundId`, not an opened value: two openings batched under one id are one round, which
is the claim this problem exists to make checkable.

Two things the runtime refuses to let pass quietly:

  * **an unmasked open.** `open` walks the sharing's ancestry, and if no reserved triple mask
    is in it, records a `raw-open` violation. Opening `[A]` directly is the shortcut this
    problem is about, and it produces a correct `C` -- so it has to be visible somewhere that
    is not the answer.
  * **a triple used twice.** `reserve_triple` consumes; a second reservation of the same id
    raises and is recorded.

## What the dealer checks, and what a real protocol cannot

`reserve_triple` verifies `z == x * y` before handing the triple over. **A real protocol cannot
do that.** The parties hold only shares, and checking the product would mean reconstructing all
three -- which would destroy the mask they exist to provide. Real preprocessing spends a second
triple to check the first (sacrificing), or produces triples with a protocol that is
maliciously secure end to end. Here a trusted dealer checks its own work, and the honest
statement about it is in the writeup rather than implied by the code.

None of this is a security boundary. `Share._value` is one attribute access away, the
participant owns the machine and the image, and the runtime is an *instrument*: it makes the
difference between a masked opening and a raw one visible in a log. What the log can prove is
exactly what `ancestry`, `issued` and the `opened` records say, and no more.

## Why this file is separate from `fixtures/generate.py`

Issue 537/538 (Issue 543 option B2). Until that split this module and the seed derivation were
one file, and it shipped in the same single Docker stage as `tests/hidden/check_prover.py`.
That checker states, phase by phase, what every one of this problem's eight checkpoints is
graded on, and this module's own docstring wrote the Beaver identity and the fold-it-once rule
out in prose beside it: a submission transcribed from the two, with no reasoning past copying,
scored all eight checkpoints. The seed derivation and the hidden suite are in the verifier
image now (see ../Dockerfile). This half stays with the participant, because it is the part
the problem deliberately hands over.
"""

from __future__ import annotations

import hashlib
from contextlib import contextmanager

def _stream(seed: str, label: str) -> list[int]:
    out: list[int] = []
    counter = 0
    while len(out) < 512:
        out.extend(hashlib.sha256(f"{seed}:{label}:{counter}".encode()).digest())
        counter += 1
    return out


def _pick(s: list[int], i: int, low: int, high: int) -> int:
    return low + ((s[i % 500] * 256 + s[(i + 1) % 500]) % (high - low + 1))


def field_id(prime: int) -> str:
    """A stable name for the field, so a share can say which one it belongs to."""
    return f"F{prime}"


class Share:
    """One party's additive share of one field element.

    `party`, `field` and `id` are public metadata: a trace may name them, and the participant
    is expected to read them. The value is not, and the sanctioned way to it is
    `Runtime.value_of`, which knows which party is currently computing.
    """

    __slots__ = ("party", "field", "id", "_value")

    def __init__(self, party: int, field: str, identifier: str, value: int) -> None:
        self.party = party
        self.field = field
        self.id = identifier
        self._value = value

    def __repr__(self) -> str:  # pragma: no cover - a debugging aid, never asserted on
        return f"Share(party={self.party}, field={self.field!r}, id={self.id!r})"


class Triple:
    """A preprocessed multiplication triple: sharings of `x`, `y` and `z = x * y`.

    `id` names it so a log can say which one was spent without saying what was in it, and
    `fieldId` / `parties` say which setting it was drawn for -- a triple from another setting
    is not a triple, it is three unrelated sharings.
    """

    __slots__ = ("id", "fieldId", "parties", "x", "y", "z")

    def __init__(self, identifier: str, field: str, parties: int, x, y, z) -> None:
        self.id = identifier
        self.fieldId = field
        self.parties = parties
        self.x = x
        self.y = y
        self.z = z

    def __repr__(self) -> str:  # pragma: no cover - a debugging aid, never asserted on
        return f"Triple(id={self.id!r}, field={self.fieldId!r}, parties={self.parties})"


class CrossPartyRead(Exception):
    """Raised when code holding party p reads a share owned by another party."""


class TripleMisuse(Exception):
    """Raised when a triple is reserved twice, or is not a triple for this setting."""


class Runtime:
    """The only sanctioned way to touch a share's value, and the log of what happened."""

    def __init__(self, setting: dict) -> None:
        self.setting = setting
        self.events: list[dict] = []
        self.violations: list[dict] = []
        #: How many times `value_of` handed a value out. Not an event -- reading is not an
        #: operation -- but a stage that is supposed to look only at labels must leave it
        #: alone, and that is checkable.
        self.reads = 0
        #: Triple ids already spent. A mask is uniform exactly once.
        self.consumed: list[str] = []
        #: Every opening, in order: `{"roundId", "shareIds", "maskedBy"}`. No values: an
        #: opened value is public, and it is in the event log instead.
        self.opened: list[dict] = []
        self._reserved_masks: set[str] = set()
        self._party: int | None = None
        self._counter = 0

    # -- dealing -----------------------------------------------------------

    def deal(self, seed: str, label: str, secret: int) -> tuple[Share, ...]:
        """Split `secret` into one `Share` per party, summing to it mod p."""
        s = _stream(seed, f"shares:{label}")
        prime, parties = self.setting["p"], self.setting["parties"]
        head = [_pick(s, 2 * i, 0, prime - 1) for i in range(parties - 1)]
        values = [*head, (secret - sum(head)) % prime]
        return tuple(
            Share(party, self.setting["fieldId"], f"{label}#{party}", value)
            for party, value in enumerate(values)
        )

    def deal_witness(self, seed: str, witness_values, label: str = "w") -> tuple:
        """One sharing per witness element, indexed `[j][party]`."""
        return tuple(
            self.deal(seed, f"{label}{index}", value)
            for index, value in enumerate(witness_values)
        )

    def deal_triple(self, seed: str, label: str) -> Triple:
        """A fresh triple from the trusted dealer: `[x]`, `[y]`, `[z]` with `z = x * y`."""
        s = _stream(seed, f"triple:{label}")
        prime = self.setting["p"]
        x = _pick(s, 0, 0, prime - 1)
        y = _pick(s, 2, 0, prime - 1)
        return Triple(
            f"T-{label}",
            self.setting["fieldId"],
            self.setting["parties"],
            self.deal(seed, f"{label}x", x),
            self.deal(seed, f"{label}y", y),
            self.deal(seed, f"{label}z", (x * y) % prime),
        )

    def forge_triple(self, seed: str, label: str, skew: int = 1) -> Triple:
        """A triple whose `z` is not `x * y`. For tests; the dealer never produces one."""
        triple = self.deal_triple(seed, label)
        prime = self.setting["p"]
        broken = (self.reconstruct(triple.z) + skew) % prime
        return Triple(
            triple.id, triple.fieldId, triple.parties, triple.x, triple.y,
            self.deal(seed, f"{label}z-forged", broken),
        )

    def reconstruct(self, shares) -> int:
        """Sum the shares. On `Runtime`, and **never** forwarded by `ParticipantRuntime`."""
        return sum(share._value for share in shares) % self.setting["p"]  # noqa: SLF001

    # -- triples -----------------------------------------------------------

    def reserve_triple(self, triple: Triple) -> Triple:
        """Check a triple and spend it. The same one is never handed out twice.

        The product check is the dealer checking its own work. A real protocol cannot do it --
        see this module's docstring and the writeup.
        """
        if not isinstance(triple, Triple):
            self._violate("triple-not-a-triple", None)
            raise TripleMisuse("a triple is required")
        if triple.id in self.consumed:
            self._violate("triple-reused", None)
            raise TripleMisuse(f"triple {triple.id!r} was already spent")
        if triple.fieldId != self.setting["fieldId"] or triple.parties != self.setting["parties"]:
            self._violate("triple-wrong-setting", None)
            raise TripleMisuse(f"triple {triple.id!r} was drawn for another setting")
        for sharing in (triple.x, triple.y, triple.z):
            if len(sharing) != self.setting["parties"]:
                self._violate("triple-wrong-shape", None)
                raise TripleMisuse(f"triple {triple.id!r} is not shared across every party")
        if self.reconstruct(triple.z) != (
            self.reconstruct(triple.x) * self.reconstruct(triple.y)
        ) % self.setting["p"]:
            self._violate("triple-not-multiplicative", None)
            raise TripleMisuse(f"triple {triple.id!r} does not satisfy z = x * y")
        self.consumed.append(triple.id)
        self._reserved_masks.update(
            share.id for sharing in (triple.x, triple.y) for share in sharing
        )
        self.events.append(
            {
                "op": "reserve-triple",
                "party": None,
                "operands": (),
                "result": triple.id,
                "communication": False,
                "messages": 0,
            }
        )
        return triple

    # -- scope -------------------------------------------------------------

    @contextmanager
    def party_scope(self, party: int):
        """Everything inside this block computes as `party` and may read only its shares."""
        previous = self._party
        self._party = party
        try:
            yield party
        finally:
            self._party = previous

    # -- reads -------------------------------------------------------------

    def value_of(self, share: Share) -> int:
        """The share's value, if the current scope is allowed to see it."""
        if self._party is None:
            self._violate("read-outside-party-scope", share)
            raise CrossPartyRead("a share was read outside any party scope")
        if share.party != self._party:
            self._violate("cross-party-read", share)
            raise CrossPartyRead(
                f"party {self._party} read a share owned by party {share.party}"
            )
        if share.field != self.setting["fieldId"]:
            self._violate("field-mismatch", share)
            raise CrossPartyRead(
                f"share is in {share.field}, the setting is in {self.setting['fieldId']}"
            )
        self.reads += 1
        return share._value  # noqa: SLF001 - the runtime is the accessor

    # -- local operations --------------------------------------------------

    def add(self, left: Share, right: Share) -> Share:
        """`[u] + [v]`, both held by the current party. Local."""
        value = (self.value_of(left) + self.value_of(right)) % self.setting["p"]
        return self._emit("add", (left, right), value)

    def sub(self, left: Share, right: Share) -> Share:
        """`[u] - [v]`, both held by the current party. Local, and how a mask is applied."""
        value = (self.value_of(left) - self.value_of(right)) % self.setting["p"]
        return self._emit("sub", (left, right), value)

    def mul_public(self, share: Share, constant: int) -> Share:
        """`k * [u]` for a public `k`. Local."""
        if isinstance(constant, bool) or not isinstance(constant, int):
            raise TypeError("a public coefficient must be an integer")
        value = (self.value_of(share) * constant) % self.setting["p"]
        return self._emit("mul-public", (share,), value, public=constant)

    def add_public(self, share: Share, constant: int) -> Share:
        """`[u] + k` for a public `k`, folded into **this** party's share.

        Local, and does exactly what it is told. Calling it for every party gives a sharing of
        `u + parties * k`, which at two parties is wrong by `k` and at one party would not be
        wrong at all -- the reason Week 2 spent a whole checkpoint on it.
        """
        if isinstance(constant, bool) or not isinstance(constant, int):
            raise TypeError("a public constant must be an integer")
        value = (self.value_of(share) + constant) % self.setting["p"]
        return self._emit("add-public", (share,), value, public=constant)

    def zero(self) -> Share:
        """A share of zero for the current party, so a sum has somewhere to start."""
        if self._party is None:
            self._violate("read-outside-party-scope", None)
            raise CrossPartyRead("a zero share was requested outside any party scope")
        return self._emit("zero", (), 0)

    # -- the one operation that talks ---------------------------------------

    def open(self, round_id: str, sharing) -> int:
        """Reveal one shared value to everybody. The only thing here that communicates.

        Every party sends its share, so one opening is `parties` messages. Openings that
        carry the same `round_id` happen together and are **one** round -- batching is a
        property of the schedule, not of the number of values.

        An opening whose ancestry holds no reserved triple mask is recorded as a `raw-open`
        violation. It is not refused: refusing would make the shortcut impossible instead of
        visible, and the point is that opening `[A]` directly produces a perfectly correct
        `C`.
        """
        if not isinstance(round_id, str) or not round_id:
            raise ValueError("an opening needs a round id")
        if len(sharing) != self.setting["parties"]:
            raise ValueError("an opening needs one share per party")
        masked_by = sorted(
            {
                identifier
                for share in sharing
                for identifier in (self.ancestry(share) | {share.id})
                if identifier in self._reserved_masks
            }
        )
        if not masked_by:
            self._violate("raw-open", sharing[0])
        value = sum(share._value for share in sharing) % self.setting["p"]  # noqa: SLF001
        self.opened.append(
            {
                "roundId": round_id,
                "shareIds": tuple(share.id for share in sharing),
                "maskedBy": tuple(masked_by),
            }
        )
        self._counter += 1
        self.events.append(
            {
                "op": "open",
                "party": None,
                "operands": tuple(share.id for share in sharing),
                "result": f"o{self._counter}",
                "communication": True,
                "messages": self.setting["parties"],
                "roundId": round_id,
                "public": value,
            }
        )
        return value

    # -- bookkeeping -------------------------------------------------------

    def _emit(
        self, operation: str, operands: tuple, value: int, public: int | None = None
    ) -> Share:
        self._counter += 1
        identifier = f"t{self._counter}"
        event = {
            "op": operation,
            "party": self._party,
            "operands": tuple(operand.id for operand in operands),
            "result": identifier,
            "communication": False,
            "messages": 0,
        }
        if public is not None:
            event["public"] = public
        self.events.append(event)
        return Share(self._party, self.setting["fieldId"], identifier, value)

    def _violate(self, kind: str, share: Share | None) -> None:
        self.violations.append(
            {
                "kind": kind,
                "party": self._party,
                "share": None if share is None else share.id,
                "owner": None if share is None else share.party,
            }
        )

    # -- what the trace says -----------------------------------------------

    def rounds(self) -> int:
        """Distinct `roundId`s among the communicating events. Not the number of openings."""
        return len({event["roundId"] for event in self.events if event["communication"]})

    def messages(self) -> int:
        return sum(int(event.get("messages", 0)) for event in self.events)

    def summary(self) -> dict:
        return {
            "operations": len(self.events),
            "rounds": self.rounds(),
            "messages": self.messages(),
            "opened": len(self.opened),
            "triples": len(self.consumed),
            "violations": len(self.violations),
        }

    def ancestry(self, share: Share) -> set[str]:
        """Every operand id the result was built from, transitively."""
        produced = {event["result"]: event for event in self.events}
        if share.id not in produced:
            return set()
        seen: set[str] = set()
        frontier = [share.id]
        while frontier:
            current = frontier.pop()
            if current in seen:
                continue
            seen.add(current)
            event = produced.get(current)
            if event is not None:
                frontier.extend(event["operands"])
        return seen - {share.id}

    def issued(self, share: Share) -> bool:
        """Whether this runtime produced the share, rather than the participant inventing it."""
        return any(event["result"] == share.id for event in self.events)


class ParticipantRuntime:
    """What the participant module is handed: the runtime, minus `reconstruct`.

    A deliberately narrow facade rather than the `Runtime` itself. `open` is here because a
    multiplication cannot happen without it; `reconstruct` is not, because nothing this
    problem asks for needs a sharing put back together off the record.

    It is not a sandbox: `_runtime` is right there and so is `Share._value`. See the writeup
    for what the audit can and cannot prove about that.
    """

    __slots__ = ("_runtime",)

    def __init__(self, runtime: Runtime) -> None:
        self._runtime = runtime

    @property
    def setting(self) -> dict:
        return self._runtime.setting

    def party_scope(self, party: int):
        return self._runtime.party_scope(party)

    def value_of(self, share: Share) -> int:
        return self._runtime.value_of(share)

    def add(self, left: Share, right: Share) -> Share:
        return self._runtime.add(left, right)

    def sub(self, left: Share, right: Share) -> Share:
        return self._runtime.sub(left, right)

    def mul_public(self, share: Share, constant: int) -> Share:
        return self._runtime.mul_public(share, constant)

    def add_public(self, share: Share, constant: int) -> Share:
        return self._runtime.add_public(share, constant)

    def zero(self) -> Share:
        return self._runtime.zero()

    def open(self, round_id: str, sharing) -> int:
        return self._runtime.open(round_id, sharing)

    def reserve_triple(self, triple: Triple) -> Triple:
        return self._runtime.reserve_triple(triple)

    def events(self) -> tuple[dict, ...]:
        """The log so far, as read-only copies."""
        return tuple(dict(event) for event in self._runtime.events)

    def openings(self) -> tuple[dict, ...]:
        """Every opening, in order: round id, the share ids opened, and the masks behind them."""
        return tuple(dict(record) for record in self._runtime.opened)

    def violations(self) -> tuple[dict, ...]:
        return tuple(dict(violation) for violation in self._runtime.violations)

    def consumed_triples(self) -> tuple[str, ...]:
        return tuple(self._runtime.consumed)

    def ancestry(self, share: Share) -> set[str]:
        return self._runtime.ancestry(share)

    def issued(self, share: Share) -> bool:
        return self._runtime.issued(share)


def linear_halves(runtime: Runtime, row: dict, shares) -> dict:
    """`[A]` and `[B]`, supplied. This is `ac26-w6-cosnark-linear`'s answer, handed over.

    Built on the runtime so the sharings it returns have a real ancestry -- the audit in this
    problem walks back through them, and a fabricated `[A]` would make that meaningless.
    """
    out = {}
    for name in ("A", "B"):
        vector = row["a"] if name == "A" else row["b"]
        results = []
        for party in range(runtime.setting["parties"]):
            with runtime.party_scope(party):
                total = runtime.zero()
                for coefficient, sharing in zip(vector, shares):
                    total = runtime.add(total, runtime.mul_public(sharing[party], coefficient))
                results.append(total)
        out[name] = tuple(results)
    return out
