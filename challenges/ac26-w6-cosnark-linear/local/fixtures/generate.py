"""Parameters, the supplied sharing layer, the instrumented runtime, and ground truth.

Nothing here is copied from the course's `co-snark-prove` exercise: no function names, no
coefficients, no fixtures, no skeleton. Parameters come from the seed and every convention is
written out below.

Week 2's two problems are **supplied**: additive secret sharing (`ac26-w2-secret-sharing`)
and the local linear operations on shares (`ac26-w2-linear-shares`). This problem is the
prover's linear layer built on top of them, and the instrumentation that proves it stayed
local.

## What a share is here, and why it is not an int

Week 2 modelled a sharing as `list[int]` and let the learner index it. That is fine when the
lesson is the arithmetic, and useless when the lesson is *who may read what*. A `Share` here
carries three things besides its value:

    party      which party holds it
    field      which prime field it lives in
    id         a name, so a trace can say which operand was used without saying what it was

and its value is meant to be read through the runtime, which knows which party is currently
computing. Reading another party's share through that accessor is not an error the learner
has to remember to avoid -- it is recorded, and the checkpoint fails.

## The relation

A toy R1CS-shaped row, and only the linear half of it:

    A = sum_j a_j * w_j        B = sum_j b_j * w_j        (mod p)

`a` and `b` are **public** coefficient vectors. `w` is the secret witness, and it exists in
this file only long enough to be split into shares -- the participant module is never handed
it, and never handed a way to put it back together.

## Why the answer is a sum of local operations

An additive sharing of `w_j` is a list of party-held values summing to `w_j` mod p. So

    sum_j a_j * [w_j]_party  =  [sum_j a_j * w_j]_party

for each party independently: scaling by a public constant and adding two shares held by the
same party are both local. The whole linear layer of a co-SNARK prover is that identity,
which is why it costs **zero** rounds of communication. Multiplication is where that stops
being true, and that is the next problem.

## The runtime

Every operation goes through `Runtime`, which appends an event carrying the operation type,
the party, the operand ids and the result id -- never a value. Three things are deliberately
absent from what a participant is given:

  * no `reconstruct`. It is a method on `Runtime` and `ParticipantRuntime` does not forward
    it, so "reconstruct, do the arithmetic in the clear, re-share" is not an implementation
    that can be written through the API rather than one that is asked for politely.
  * no cross-party read. `Runtime.value_of` refuses a share owned by a party other than the
    one the current `party_scope` names, and records the attempt.
  * no communication primitive. There is nothing to call that would produce a round, which
    is what makes "zero rounds" checkable rather than asserted.

None of this is a security boundary. `Share._value` is one attribute access away and the
participant owns the machine and the image. The runtime is an *instrument*: it makes the
difference between a local computation and a communicating one visible in a log, which is
the thing the problem is teaching. What the log can prove about a result is exactly what
`ancestry` and `issued` say about it, and no more -- see the writeup.
"""

from __future__ import annotations

import hashlib
from contextlib import contextmanager

#: Small primes, big enough that a dense combination wraps and small enough to enumerate.
PRIMES = (97, 101, 103, 107, 109, 113, 127, 131, 137, 139)

#: Coefficient shapes the hidden tests draw from. `sparse` is the one that catches a
#: participant who indexes the witness by position in a filtered list rather than by `j`.
SHAPES = ("dense", "sparse", "signed", "unit")


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


# ---------------------------------------------------------------------------
# Supplied: additive secret sharing, with an owner and a field
# ---------------------------------------------------------------------------


class Share:
    """One party's additive share of one field element.

    `party`, `field` and `id` are public metadata: a trace may name them, and the participant
    is expected to read them. The value is not, and the sanctioned way to it is
    `Runtime.value_of`, which knows which party is currently computing -- so a cross-party
    read is an event rather than an ordinary attribute access nobody can see.
    """

    __slots__ = ("party", "field", "id", "_value")

    def __init__(self, party: int, field: str, identifier: str, value: int) -> None:
        self.party = party
        self.field = field
        self.id = identifier
        self._value = value

    def __repr__(self) -> str:  # pragma: no cover - a debugging aid, never asserted on
        return f"Share(party={self.party}, field={self.field!r}, id={self.id!r})"


class CrossPartyRead(Exception):
    """Raised when code holding party p reads a share owned by another party."""


class Runtime:
    """The only sanctioned way to touch a share's value, and the log of what happened.

    Events carry operation type, party, operand ids and result id. Never a value: a trace
    that leaked the numbers would defeat the point of the exercise it is instrumenting.
    """

    def __init__(self, setting: dict) -> None:
        self.setting = setting
        self.events: list[dict] = []
        self.violations: list[dict] = []
        #: How many times `value_of` handed a value out. Not an event -- reading is not an
        #: operation -- but a stage that is supposed to look only at labels must leave it
        #: alone, and that is checkable.
        self.reads = 0
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

    def reconstruct(self, shares) -> int:
        """Sum the shares. On `Runtime`, and **never** forwarded by `ParticipantRuntime`."""
        return sum(share._value for share in shares) % self.setting["p"]  # noqa: SLF001

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
        """`[x] + [y]`, both held by the current party. Local: no round, no message."""
        value = (self.value_of(left) + self.value_of(right)) % self.setting["p"]
        return self._emit("add", (left, right), value)

    def mul_public(self, share: Share, constant: int) -> Share:
        """`c * [x]` for a public `c`. Local, and the reason `c` must not be shared."""
        if isinstance(constant, bool) or not isinstance(constant, int):
            raise TypeError("a public coefficient must be an integer")
        value = (self.value_of(share) * constant) % self.setting["p"]
        return self._emit("mul-public", (share,), value, public=constant)

    def zero(self) -> Share:
        """A share of zero for the current party, so a sum has somewhere to start."""
        if self._party is None:
            self._violate("read-outside-party-scope", None)
            raise CrossPartyRead("a zero share was requested outside any party scope")
        return self._emit("zero", (), 0)

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
        """Communication rounds: events flagged as communicating."""
        return sum(1 for event in self.events if event["communication"])

    def messages(self) -> int:
        """Messages sent: the `messages` field summed over the log.

        Not the same number as `rounds`. One round can carry many messages, and a round with
        no messages in it is not a round -- both are recorded per event so a trace can be
        read rather than guessed at.
        """
        return sum(int(event.get("messages", 0)) for event in self.events)

    def summary(self) -> dict:
        return {
            "operations": len(self.events),
            "rounds": self.rounds(),
            "messages": self.messages(),
            "violations": len(self.violations),
            "parties": tuple(sorted({event["party"] for event in self.events})),
        }

    def ancestry(self, share: Share) -> set[str]:
        """Every operand id the result was built from, transitively.

        This is what makes the audit checkable rather than promised. A share returned by an
        honest implementation traces back, through runtime events, to the input shares of
        **one** party and nothing else. A share this runtime never issued has no ancestry at
        all, and a result folded from another party's operands names them here.
        """
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

    A deliberately narrow facade rather than the `Runtime` itself. The capability to put a
    sharing back together is not withheld by convention or by a test that notices afterwards
    -- it is not an attribute of this object, so the shortcut cannot be written through the
    API. It is not a sandbox: `_runtime` is right there and so is `Share._value`. See the
    writeup for what the audit can and cannot prove about that.
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

    def mul_public(self, share: Share, constant: int) -> Share:
        return self._runtime.mul_public(share, constant)

    def zero(self) -> Share:
        return self._runtime.zero()

    def events(self) -> tuple[dict, ...]:
        """The log so far, as read-only copies. Operation types and ids; never a value."""
        return tuple(dict(event) for event in self._runtime.events)

    def violations(self) -> tuple[dict, ...]:
        """Every refused read, in order."""
        return tuple(dict(violation) for violation in self._runtime.violations)

    def ancestry(self, share: Share) -> set[str]:
        return self._runtime.ancestry(share)

    def issued(self, share: Share) -> bool:
        return self._runtime.issued(share)


# ---------------------------------------------------------------------------
# The relation, and ground truth
# ---------------------------------------------------------------------------


def coefficients(seed: str, label: str, setting: dict, shape: str = "dense") -> tuple[int, ...]:
    """A public coefficient vector of the requested shape.

    `sparse` leaves most entries zero, which is what separates an implementation indexing the
    witness by `j` from one indexing it by position among the non-zero coefficients.
    `signed` draws negatives, which must be reduced mod p rather than left negative.
    """
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
    """The secret. Exists here only to be split; never reaches the participant module."""
    s = _stream(seed, f"witness:{label}")
    return tuple(_pick(s, 2 * j, 0, setting["p"] - 1) for j in range(setting["width"]))


def relation(seed: str, label: str, setting: dict, shape: str = "dense") -> dict:
    """The public half of one R1CS-shaped row: two coefficient vectors and the field.

    Delivered as it arrives, not as it should be stored: under `signed` the coefficients are
    negative representatives, and normalizing them is the parser's job.
    """
    return {
        "a": coefficients(seed, f"{label}:a", setting, shape),
        "b": coefficients(seed, f"{label}:b", setting, shape),
        "fieldId": setting["fieldId"],
        "p": setting["p"],
        "width": setting["width"],
        "parties": setting["parties"],
    }


def dot(coefficient_vector, values, prime: int) -> int:
    """`sum_j c_j * v_j mod p`. The plain-reference answer, computed where the secret is."""
    return sum(c * v for c, v in zip(coefficient_vector, values)) % prime


def health_token(seed: str) -> str:
    cfg = setting(seed)
    return hashlib.sha256(f"health:{seed}:{cfg['settingId']}".encode()).hexdigest()[:16]
