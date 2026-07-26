"""Parameters, the supplied prover, the audited runtime, the disclosure sink, and the specimens.

Nothing here is copied from the course's `co-snark-prove` exercise: no function names, no
coefficients, no fixtures, no skeleton. Parameters come from the seed and every convention is
written out below.

Two problems are **supplied**. `ac26-w6-cosnark-linear` built the prover's linear layer, and
`ac26-w6-cosnark-beaver` built the one multiplication that has to communicate. `beaver_product`
below is that answer, handed over. This problem is not about computing `C` again.

## What this problem is about

Every specimen in `SPECIMENS` computes the same `A`, `B` and `C`. Run them side by side and
their public relation results are identical -- that is the premise, not a spoiler. What differs
is what each one *lets out*, and through which channel.

    the proof artifact          what a next stage consumes
    the log                     lines a prover emits while working
    the metrics                 named numbers an operator scrapes
    the error path              what a malformed input produces

A correctness test looks at the first field of the first channel. The other three are outside
its field of view, and three of the specimens use only those.

## The five capabilities, and why the runtime hands them out

`ac26-w6-cosnark-beaver` withheld `reconstruct` from the participant facade, which made one
class of shortcut unwritable. That is the right default and it is not what a real prover is
built on: a real MPC library exposes reconstruction, cross-party debugging hooks and
structured logging, because real operators need them. So `AuditRuntime` **does** expose them,
and records every one that is reached:

    reconstruct        a sharing was put back together
    peek               a share was read from outside its own party's scope
    open               a value was published
    emit               a line was written to the log
    metric             a named number was published

Reaching a capability is not a violation. Publishing `d` and `e` is the protocol. What makes
an audit an audit is the second question -- what was reached, *with what argument* -- and the
runtime records the capability and the operand ids, never the values. Deciding is the
participant's job.

## Authorized and unauthorized openings

One Beaver multiplication authorizes exactly two openings: the masked `d` and `e`, batched
under the multiplication's own round id. An opening is authorized iff **both** hold:

  * a reserved triple mask is in its ancestry (`maskedBy` is not empty), and
  * its `roundId` is the multiplication's declared round.

An opening that fails the first published something nothing was hiding. One that fails the
second published a masked value in a round the relation never declared, which is how a mask
gets spent on a value it was not drawn for.

## What the participant can see, and what only the verifier can

`Disclosure` is the participant-visible view of one run: artifact, log, metrics, error. The
witness, the shares, the reconstructed `A` / `B` / `C` and the triple's `x` / `y` / `z` are
not in it, and the hidden checker holds them so it can tell whether a submitted counterexample
really recovered one.

That asymmetry is the whole exercise. A leak is not "a number the participant recognizes"; it
is a number the participant can **derive** something secret from, using only what is in front
of them. Two of the specimens leak nothing that looks secret and everything needed to
reconstruct one.

None of this is a security boundary. `Share._value` is one attribute access away, the
participant owns the machine and the image, and the runtime is an *instrument*: it records
what a computation reached and what it published. What the record can prove is exactly what
`reached`, `opened` and the `Disclosure` say, and no more.
"""

from __future__ import annotations

import hashlib
from contextlib import contextmanager

#: Small primes, big enough that a product wraps and small enough to enumerate.
PRIMES = (97, 101, 103, 107, 109, 113, 127, 131, 137, 139)

#: Coefficient shapes the hidden tests draw from, inherited from the two problems before this
#: one so the rows a learner already met still appear here.
SHAPES = ("dense", "sparse", "signed", "unit")

#: The six classes every value in a co-SNARK prover run falls into. `classify` is graded
#: against these exact names.
CLASSES = (
    "public-input",
    "secret-share",
    "allowed-open",
    "secret-intermediate",
    "participant-artifact",
    "verifier-only",
)


def _stream(seed: str, label: str) -> list[int]:
    out: list[int] = []
    counter = 0
    while len(out) < 512:
        out.extend(hashlib.sha256(f"{seed}:{label}:{counter}".encode()).digest())
        counter += 1
    return out


def _pick(s: list[int], i: int, low: int, high: int) -> int:
    return low + ((s[i % 500] * 256 + s[(i + 1) % 500]) % (high - low + 1))


def setting(seed: str, label: str = "public") -> dict:
    """Field, party count and witness length. All three change between checkpoints."""
    s = _stream(seed, f"setting:{label}")
    prime = PRIMES[s[0] % len(PRIMES)]
    parties = _pick(s, 2, 2, 5)
    width = _pick(s, 4, 3, 8)
    return {
        "p": prime,
        "parties": parties,
        "width": width,
        "fieldId": field_id(prime),
        "settingId": f"F{prime}-P{parties}-W{width}",
    }


def field_id(prime: int) -> str:
    """A stable name for the field, so a share can say which one it belongs to."""
    return f"F{prime}"


class Share:
    """One party's additive share of one field element."""

    __slots__ = ("party", "field", "id", "_value")

    def __init__(self, party: int, field: str, identifier: str, value: int) -> None:
        self.party = party
        self.field = field
        self.id = identifier
        self._value = value

    def __repr__(self) -> str:  # pragma: no cover - a debugging aid, never asserted on
        return f"Share(party={self.party}, field={self.field!r}, id={self.id!r})"


class Triple:
    """A preprocessed multiplication triple: sharings of `x`, `y` and `z = x * y`."""

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
    """Raised when code holding party p reads a share owned by another party via `value_of`."""


class TripleMisuse(Exception):
    """Raised when a triple is reserved twice, or is not a triple for this setting."""


class Runtime:
    """The sanctioned way to touch a share's value, and the record of what happened."""

    def __init__(self, setting: dict) -> None:
        self.setting = setting
        self.events: list[dict] = []
        self.violations: list[dict] = []
        self.reads = 0
        #: Triple ids already spent. A mask is uniform exactly once.
        self.consumed: list[str] = []
        #: Every opening, in order: `{"roundId", "shareIds", "maskedBy"}`.
        self.opened: list[dict] = []
        #: Every capability reached, in order: `{"capability", "party", "operands"}`. No
        #: values -- what was reached and on what, never with what result.
        self.reached: list[dict] = []
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

    def reconstruct(self, shares) -> int:
        """Sum the shares. On `Runtime`; `AuditRuntime` forwards it and records that it did."""
        return sum(share._value for share in shares) % self.setting["p"]  # noqa: SLF001

    # -- triples -----------------------------------------------------------

    def reserve_triple(self, triple: Triple) -> Triple:
        """Check a triple and spend it. The same one is never handed out twice."""
        if not isinstance(triple, Triple):
            self._violate("triple-not-a-triple", None)
            raise TripleMisuse("a triple is required")
        if triple.id in self.consumed:
            self._violate("triple-reused", None)
            raise TripleMisuse(f"triple {triple.id!r} was already spent")
        if triple.fieldId != self.setting["fieldId"] or triple.parties != self.setting["parties"]:
            self._violate("triple-wrong-setting", None)
            raise TripleMisuse(f"triple {triple.id!r} was drawn for another setting")
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

    def peek(self, share: Share) -> int:
        """Read any share, from anywhere. A real library's debugging hook.

        Not refused and not a violation on its own -- an operator debugging a stuck party
        needs it. It is recorded, and what a prover does next with what it read is the
        question the audit is actually asking.
        """
        self._reach("peek", (share,), party=share.party)
        return share._value  # noqa: SLF001 - that is what a peek is

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
        """`[u] + k` for a public `k`, folded into **this** party's share."""
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
        """Reveal one shared value to everybody. The only thing here that communicates."""
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
        self._reach("open", sharing, round_id=round_id)
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

    def _reach(self, capability: str, operands=(), party: int | None = None, **extra) -> None:
        record = {
            "capability": capability,
            "party": self._party if party is None else party,
            "operands": tuple(getattr(o, "id", str(o)) for o in operands),
        }
        record.update(extra)
        self.reached.append(record)

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

    # -- what the record says ----------------------------------------------

    def rounds(self) -> int:
        """Distinct `roundId`s among the communicating events. Not the number of openings."""
        return len({event["roundId"] for event in self.events if event["communication"]})

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


class AuditRuntime:
    """What a specimen is handed, and what the audit reads afterwards.

    Unlike the previous problem's facade this one **does** forward `reconstruct` and `peek`.
    That is the point: a real MPC library exposes reconstruction and debugging hooks, and
    withholding them here would make the whole class of defect unwritable and therefore
    unauditable. Every capability reached is recorded with its operand ids and never with a
    value.
    """

    __slots__ = ("_runtime", "_sink")

    def __init__(self, runtime: Runtime, sink: "Sink | None" = None) -> None:
        self._runtime = runtime
        self._sink = sink

    @property
    def setting(self) -> dict:
        return self._runtime.setting

    def party_scope(self, party: int):
        return self._runtime.party_scope(party)

    def value_of(self, share: Share) -> int:
        return self._runtime.value_of(share)

    def peek(self, share: Share) -> int:
        return self._runtime.peek(share)

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

    def reconstruct(self, sharing) -> int:
        """Put a sharing back together. Available, and recorded every time it is used."""
        self._runtime._reach("reconstruct", sharing)  # noqa: SLF001 - the runtime is the recorder
        return self._runtime.reconstruct(sharing)

    # -- what the audit reads ----------------------------------------------

    def events(self) -> tuple[dict, ...]:
        return tuple(dict(event) for event in self._runtime.events)

    def openings(self) -> tuple[dict, ...]:
        """Every opening, in order: round id, the share ids opened, and the masks behind them."""
        return tuple(dict(record) for record in self._runtime.opened)

    def reached(self) -> tuple[dict, ...]:
        """Every capability reached, in order. Names and operand ids; never a value."""
        return tuple(dict(record) for record in self._runtime.reached)

    def violations(self) -> tuple[dict, ...]:
        return tuple(dict(violation) for violation in self._runtime.violations)

    def consumed_triples(self) -> tuple[str, ...]:
        return tuple(self._runtime.consumed)

    def ancestry(self, share: Share) -> set[str]:
        return self._runtime.ancestry(share)

    def issued(self, share: Share) -> bool:
        return self._runtime.issued(share)


# ---------------------------------------------------------------------------
# The disclosure sink
# ---------------------------------------------------------------------------


class Sink:
    """The four participant-visible channels a prover can write to.

    A correctness test reads `artifact` and nothing else. Three of the specimens use only the
    other three, which is why an audit that reads the artifact is not an audit.
    """

    __slots__ = ("artifact", "log", "metrics", "error")

    def __init__(self) -> None:
        self.artifact: dict = {}
        self.log: list[str] = []
        self.metrics: dict = {}
        self.error: str | None = None

    def publish(self, artifact: dict) -> None:
        self.artifact = dict(artifact)

    def emit(self, event: str, **values) -> None:
        """One structured log record: an event name and named fields.

        Structured rather than a formatted string on purpose. A log line's *field names* are
        the policy surface -- that is what an allowlist can be written against, and reducing
        it to text first would make this problem an exercise in regular expressions.
        """
        self.log.append({"event": str(event), "values": dict(values)})

    def metric(self, name: str, value) -> None:
        self.metrics[str(name)] = value

    def fail(self, message: str, **values) -> None:
        self.error = {"message": str(message), "values": dict(values)}

    def disclosure(self) -> "Disclosure":
        return Disclosure(
            dict(self.artifact),
            tuple(dict(record) for record in self.log),
            dict(self.metrics),
            None if self.error is None else dict(self.error),
        )


class Disclosure:
    """One run's participant-visible view, frozen. This is all an auditor gets."""

    __slots__ = ("artifact", "log", "metrics", "error")

    def __init__(self, artifact: dict, log: tuple, metrics: dict, error) -> None:
        self.artifact = artifact
        self.log = log
        self.metrics = metrics
        self.error = error

    def __repr__(self) -> str:  # pragma: no cover - a debugging aid, never asserted on
        return (
            f"Disclosure(artifact={sorted(self.artifact)}, log={len(self.log)} line(s), "
            f"metrics={sorted(self.metrics)}, error={self.error!r})"
        )


#: Every field name a prover may put in front of the participant, whichever channel it comes
#: out of. `A`, `B` and `C` are on it **as sharings**; the same names carrying an integer are
#: not the same disclosure, which is the distinction `leakage_audit` has to make.
ALLOWED_NAMES = (
    "relationId",
    "fieldId",
    "parties",
    "A",
    "B",
    "C",
    "tripleId",
    "roundId",
    "d",
    "e",
    "operations",
    "rounds",
    "openings",
)

#: Names on the allowlist that may only ever carry a sharing. An integer under one of these is
#: a reconstructed value wearing an approved label.
SHARING_ONLY_NAMES = ("A", "B", "C")


def is_sharing(value, parties: int) -> bool:
    """Whether a disclosed value is a sharing rather than a field element."""
    return (
        isinstance(value, (list, tuple))
        and len(value) == parties
        and all(isinstance(item, Share) for item in value)
    )


# ---------------------------------------------------------------------------
# The relation, and ground truth
# ---------------------------------------------------------------------------


def coefficients(seed: str, label: str, setting: dict, shape: str = "dense") -> tuple[int, ...]:
    """A public coefficient vector of the requested shape."""
    s = _stream(seed, f"coeff:{label}:{shape}")
    prime, width = setting["p"], setting["width"]
    if shape == "unit":
        hot = _pick(s, 0, 0, width - 1)
        return tuple(1 if j == hot else 0 for j in range(width))
    if shape == "sparse":
        drawn = [
            _pick(s, 2 * j, 0, prime - 1) if _pick(s, 2 * j + 40, 0, 3) == 0 else 0
            for j in range(width)
        ]
        if not any(drawn):
            drawn[_pick(s, 90, 0, width - 1)] = _pick(s, 92, 1, prime - 1)
        return tuple(drawn)
    if shape == "signed":
        return tuple(_pick(s, 2 * j, -(prime // 2), prime // 2) for j in range(width))
    return tuple(_pick(s, 2 * j, 0, prime - 1) for j in range(width))


def witness(seed: str, label: str, setting: dict) -> tuple[int, ...]:
    """The secret. Exists here only to be split; never reaches a specimen in the clear."""
    s = _stream(seed, f"witness:{label}")
    return tuple(_pick(s, 2 * j, 0, setting["p"] - 1) for j in range(setting["width"]))


def relation(seed: str, label: str, setting: dict, shape: str = "dense") -> dict:
    """The public half of one R1CS-shaped row: two coefficient vectors and the field."""
    return {
        "a": tuple(c % setting["p"] for c in coefficients(seed, f"{label}:a", setting, shape)),
        "b": tuple(c % setting["p"] for c in coefficients(seed, f"{label}:b", setting, shape)),
        "relationId": f"R-{label}-{shape}",
        "fieldId": setting["fieldId"],
        "p": setting["p"],
        "width": setting["width"],
        "parties": setting["parties"],
    }


def dot(coefficient_vector, values, prime: int) -> int:
    """`sum_j c_j * v_j mod p`. The plain-reference answer, computed where the secret is."""
    return sum(c * v for c, v in zip(coefficient_vector, values)) % prime


def linear_halves(runtime, row: dict, shares) -> dict:
    """`[A]` and `[B]`, supplied. `ac26-w6-cosnark-linear`'s answer, handed over."""
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


def round_id_for(row: dict) -> str:
    """The one round a single multiplication is allowed to open in."""
    return f"{row['relationId']}:mul"


def beaver_product(runtime, row: dict, halves: dict, triple) -> dict:
    """`[C] = [A] * [B]`, supplied. `ac26-w6-cosnark-beaver`'s answer, handed over.

    Reserves the triple, masks both halves, opens `d` and `e` under `round_id_for(row)`, and
    builds `[C] = [z] + d[y] + e[x] + de` with the public term folded in by one party. This
    problem does not ask you to write it again; it asks what a prover built on top of it is
    allowed to say out loud.
    """
    prime, parties = runtime.setting["p"], runtime.setting["parties"]
    runtime.reserve_triple(triple)
    d_shares, e_shares = [], []
    for party in range(parties):
        with runtime.party_scope(party):
            d_shares.append(runtime.sub(halves["A"][party], triple.x[party]))
            e_shares.append(runtime.sub(halves["B"][party], triple.y[party]))
    round_id = round_id_for(row)
    d = runtime.open(round_id, tuple(d_shares))
    e = runtime.open(round_id, tuple(e_shares))
    product = []
    for party in range(parties):
        with runtime.party_scope(party):
            total = runtime.add(triple.z[party], runtime.mul_public(triple.y[party], d))
            total = runtime.add(total, runtime.mul_public(triple.x[party], e))
            if party == 0:
                total = runtime.add_public(total, (d * e) % prime)
            product.append(total)
    return {
        "A": tuple(halves["A"]),
        "B": tuple(halves["B"]),
        "C": tuple(product),
        "d": d,
        "e": e,
        "tripleId": triple.id,
        "roundId": round_id,
    }


def clean_artifact(row: dict, proof: dict) -> dict:
    """The artifact shape `ac26-w6-cosnark-beaver` settled on. Sharings and metadata only."""
    return {
        "relationId": row["relationId"],
        "fieldId": row["fieldId"],
        "parties": row["parties"],
        "A": proof["A"],
        "B": proof["B"],
        "C": proof["C"],
        "tripleId": proof["tripleId"],
        "roundId": proof["roundId"],
    }


def health_token(seed: str) -> str:
    cfg = setting(seed)
    return hashlib.sha256(f"health:{seed}:{cfg['settingId']}".encode()).hexdigest()[:16]
