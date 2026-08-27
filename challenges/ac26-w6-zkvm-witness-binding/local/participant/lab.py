"""The supplied half: the vocabulary, the shapes, the commitment, the decoder and the runner.

Issue 537/538 (Issue 543 option B2): `fixtures/generate.py` used to carry these names as well as
the ones a checkpoint is graded on -- `_machine` (the whole of `run_guest`), `exploit_quantity`,
`replay_truth` and `disclosure_truth`. That module shipped in the single Docker stage a learner's
own `make build` produced, beside `tests/hidden/check_guest.py`, whose `_encode`, `_run`,
`_journal` and `_leaks` are the answers to four more of the eight checkpoints. This file is the
part that was never an answer, and it stays in the participant image; `fixtures/generate.py`
re-exports it rather than defining it a second time, so the machine a learner inspects and the
machine the hidden checker grades on are one implementation and cannot drift.

Nothing here is graded. `starter/guest.py` names every one of these in its own docstring, so a
submission has to be able to import them: the verifier's runner preloads this module before the
Issue 591 guard takes the problem root off `sys.path`.

What is *not* here is the deployment's own data. The statement, the image and its four siblings,
the colliding pair, the receipts and the ten audited runs are drawn from the seed, and a
participant reads them from the verifier's `GET /public` (see `../show.py` and
`../tests/public/test_guest.py`) rather than deriving them in their own container.
"""

from __future__ import annotations

import hashlib


# ---------------------------------------------------------------------------
# What a statement says
# ---------------------------------------------------------------------------

#: The protocol namespaces a claim can be made in. A statement names one of them, and a proof
#: made in one is not a proof in the other -- which is the whole job of a domain identifier.
DOMAINS = ("tenkacloud.zkvm.exploit-claim.v1", "tenkacloud.zkvm.exploit-claim.v2")

#: The guest builds a claim can be made under. Two guests that disagree about the predicate
#: agree about nothing, so a journal names the build that produced it.
GUEST_VERSIONS = ("guest-1.0.3", "guest-1.1.0")

#: Every field of the public statement, in the order a canonical encoding emits them. The
#: order lives here rather than in a guest so that a guest which quietly reordered them is
#: reordering something it does not own.
STATEMENT_FIELDS = ("domain", "guestVersion", "imageDigest", "semantics", "claim", "params")

#: The public target parameters, in the order a canonical encoding emits them. These are the
#: account: the unit price, what has already been charged, and the ceiling the guard enforces.
PARAM_NAMES = ("price", "spent", "budget")

#: The two places one `order` can wrap. A claim names exactly one of them.
WRAP_SITES = ("mul", "add")

#: The security effect a claim may assert. This target has one.
EFFECT = "budget-exceeded"

#: The claim types. `budget-exceeded@mul` and `budget-exceeded@add` are different claims about
#: the same account, and a witness for one is not evidence for the other.
CLAIMS = tuple(f"{EFFECT}@{site}" for site in WRAP_SITES)

#: A hex digest's length, so nothing has to spell out 64 in three places.
DIGEST_HEX_LENGTH = 64


def claim_site(claim: str) -> str:
    """The wrap site a claim is about."""
    return claim.rsplit("@", 1)[-1]


# ---------------------------------------------------------------------------
# The machine
# ---------------------------------------------------------------------------

#: Machine widths, small enough to enumerate and none of them a familiar one. A guest that
#: hard-codes 16 or 32 is describing somebody else's machine.
WIDTHS = (7, 9, 10, 11, 12, 13)

#: What the hardware does when a result does not fit. Only one of the three leaves the exploit
#: reachable, and a statement that does not name which one has not said what it is about.
OVERFLOWS = ("wrapping", "saturating", "checked")


def _profile(width: int, overflow: str) -> dict:
    return {
        "semanticsId": f"u{width}-{overflow}",
        "width": width,
        "modulus": 1 << width,
        "max": (1 << width) - 1,
        "overflow": overflow,
    }


#: Every semantics profile, by id. A statement names one; the guest reads the arithmetic out
#: of it rather than out of a constant.
SEMANTICS = {
    profile["semanticsId"]: profile
    for profile in (_profile(width, overflow) for width in WIDTHS for overflow in OVERFLOWS)
}

SEMANTICS_IDS = tuple(SEMANTICS)


# ---------------------------------------------------------------------------
# Canonical bytes and the commitment
# ---------------------------------------------------------------------------

#: How long a length prefix is, and how wide an integer is, in a canonical encoding. Both are
#: exported so that a guest and the checker that grades it are reading the same numbers rather
#: than each writing 4 and 8 down separately and agreeing by luck.
LENGTH_PREFIX_BYTES = 4
INTEGER_BYTES = 8
BYTE_ORDER = "big"

#: The commitment domains. These are **not** the statement's own `domain` field: that one says
#: which protocol a claim belongs to, and these two say which kind of object a hash was taken
#: over. Both layers are needed. Without the statement's domain a v1 claim is a v2 claim;
#: without these, an image body that happens to look like an encoded statement commits to both.
IMAGE_COMMITMENT_DOMAIN = "tenkacloud.zkvm.image.v1"
STATEMENT_COMMITMENT_DOMAIN = "tenkacloud.zkvm.statement.v1"


def commit(payload: bytes, domain: str) -> str:
    """A domain-separated digest over `payload`. Supplied; the hash is not the lesson.

    The domain goes in length-prefixed rather than concatenated, for the same reason every
    field of a statement does: `"abc" + "def"` and `"ab" + "cdef"` are the same bytes, and a
    commitment that cannot tell those apart is a commitment to neither.
    """
    if not isinstance(payload, (bytes, bytearray)):
        raise ValueError("a commitment is taken over bytes")
    tag = domain.encode("utf-8")
    framed = len(tag).to_bytes(LENGTH_PREFIX_BYTES, BYTE_ORDER) + tag
    return hashlib.sha256(framed + bytes(payload)).hexdigest()


# ---------------------------------------------------------------------------
# The program image
# ---------------------------------------------------------------------------

#: The four bytes every image starts with, and the image format they announce.
MAGIC = b"TZKV"
IMAGE_FORMAT = 1

#: The instruction set. One byte each, no operands: this machine has one accumulator, three
#: public inputs and one private one, so an instruction only has to say which step it is.
OPCODES = {
    0x11: "load-quantity",
    0x22: "mul-price",
    0x44: "add-spent",
    0x55: "guard-le",
    0x56: "guard-lt",
}

#: The two arithmetic steps, and which wrap site each of them is. The guard cannot overflow and
#: the load cannot either, so those are not in here.
WRAP_SITE_OF = {"mul-price": "mul", "add-spent": "add"}

#: The two guards a build can end with. `<=` and `<` differ on exactly one total, and that one
#: total is the difference between two programs under the same source path.
GUARDS = ("guard-le", "guard-lt")

#: Where the header ends and the opcodes begin: magic, format, build stamp, step count.
_HEADER_BYTES = len(MAGIC) + 1 + 4 + 1


def decode_program(body: object) -> tuple[str, ...]:
    """The steps an image body holds, or a refusal. Supplied; the decoder is not the lesson.

    It refuses rather than repairs. An image whose declared step count disagrees with its body,
    or that carries an opcode this machine does not have, is not a program with a small problem
    -- it is bytes somebody is asking a guest to vouch for.
    """
    if not isinstance(body, (bytes, bytearray)):
        raise ValueError("an image body is bytes")
    raw = bytes(body)
    if len(raw) < _HEADER_BYTES or raw[: len(MAGIC)] != MAGIC:
        raise ValueError("the image does not begin with a zkVM image header")
    if raw[len(MAGIC)] != IMAGE_FORMAT:
        raise ValueError(f"image format {raw[len(MAGIC)]} is not {IMAGE_FORMAT}")
    declared = raw[_HEADER_BYTES - 1]
    ops = raw[_HEADER_BYTES:]
    if len(ops) != declared:
        raise ValueError("the image declares a step count its body does not hold")
    if any(code not in OPCODES for code in ops):
        raise ValueError("the image holds an opcode this machine does not have")
    program = tuple(OPCODES[code] for code in ops)
    if not program or program[0] != "load-quantity" or program[-1] not in GUARDS:
        raise ValueError("a program loads the quantity first and guards last")
    return program


# ---------------------------------------------------------------------------
# The two ways a statement can be written down
# ---------------------------------------------------------------------------


def shuffled(record: dict) -> dict:
    """The same statement with its keys in another insertion order.

    Two dicts that compare equal are the same statement. A canonical encoding has to agree,
    which is what "fixed field order" means: the order comes from `STATEMENT_FIELDS`, not from
    whatever order the caller's dict happened to be built in.
    """
    flipped = {field: record[field] for field in reversed(STATEMENT_FIELDS)}
    flipped["params"] = {name: record["params"][name] for name in reversed(PARAM_NAMES)}
    return flipped


def naive_encode(record: dict) -> bytes:
    """Every field, concatenated. Supplied so the collision is visible rather than asserted.

    This is not a straw man: it is what an encoder looks like when it is written to be read by
    a human first and to be a commitment second. Field order is fixed, every field is present,
    nothing is dropped, and it is still not an encoding -- because the boundary between one
    field and the next is not in the output, so a byte can belong to either.
    """
    out: list[bytes] = []
    for field in STATEMENT_FIELDS:
        value = record[field]
        if field == "params":
            out.extend(str(value[name]).encode("utf-8") for name in PARAM_NAMES)
        else:
            out.append(str(value).encode("utf-8"))
    return b"".join(out)


# ---------------------------------------------------------------------------
# The private witness
# ---------------------------------------------------------------------------


def witness(quantity: int, machine_cost: int, machine_total: int, search=()) -> dict:
    """The private half: the exploit input, what the machine computed, and how it was found.

    ```text
    quantity  the operand the exploit needs
    aux       the machine's own cost and total for that quantity
    search    the quantities the search touched on the way to it
    ```

    All three are private and none of them is private for the same reason. The quantity is the
    exploit. The auxiliary values are the exploit with one modular inverse applied -- the price
    is public and invertible, so a published cost is a published quantity. And the search trail
    is the exploit surrounded by its neighbours, which is worse than the quantity alone.
    """
    return {
        "quantity": quantity,
        "aux": {"machineCost": machine_cost, "machineTotal": machine_total},
        "search": tuple(search),
    }


def _in_domain(value: object, maximum: int) -> bool:
    return isinstance(value, int) and not isinstance(value, bool) and 0 <= value <= maximum


def is_well_formed(candidate: object, profile: dict) -> bool:
    """Whether a witness is in this machine's domain at all.

    A value outside `0..max` is not a small mistake, it is a witness for a different machine. A
    guest that clamps or masks one into range proves something about a run that never happened,
    and proves it convincingly.
    """
    if not isinstance(candidate, dict) or set(candidate) != {"quantity", "aux", "search"}:
        return False
    maximum = profile["max"]
    if not _in_domain(candidate["quantity"], maximum):
        return False
    aux = candidate["aux"]
    if not isinstance(aux, dict) or set(aux) != {"machineCost", "machineTotal"}:
        return False
    if not all(_in_domain(aux[name], maximum) for name in ("machineCost", "machineTotal")):
        return False
    search = candidate["search"]
    if not isinstance(search, (list, tuple)):
        return False
    return all(_in_domain(quantity, maximum) for quantity in search)


def inverse(value: int, modulus: int) -> int:
    """`value**-1 mod modulus`, for an odd value and a power-of-two modulus."""
    return pow(value, -1, modulus)


# ---------------------------------------------------------------------------
# The toy runner
# ---------------------------------------------------------------------------


class Env:
    """The call a host builds for one guest run, and everything an observer of it can read.

    ```text
    public(name, value)     a public input. The verifier reads it, and so does anyone
                            holding the transcript
    variable(name, value)   a process environment variable for the guest. Recorded, like
                            every other thing a host puts on a command line
    note(label, **values)   one host log record. Structured, so the field names inside it
                            are the policy surface rather than a regular expression
    hint(name, value)       host advice. It reaches the guest and it is not in the
                            transcript, and it is not evidence of anything
    write_private(payload)  the private input channel. Nothing written here is recorded
    ```

    The guest side reads `public_inputs()`, `hints()` and `read_private()`. An auditor reads
    `transcript()` and `writes()`, and gets neither the hints nor the private payload -- which
    is the asymmetry the ingestion checkpoint is about.
    """

    __slots__ = ("_public", "_variables", "_notes", "_hints", "_private", "_writes", "_reads")

    def __init__(self) -> None:
        self._public: dict = {}
        self._variables: dict = {}
        self._notes: list = []
        self._hints: dict = {}
        self._private: object = None
        self._writes = 0
        self._reads = 0

    # -- what the host puts in ---------------------------------------------

    def public(self, name: str, value) -> None:
        self._public[str(name)] = value

    def variable(self, name: str, value) -> None:
        self._variables[str(name)] = value

    def note(self, label: str, **values) -> None:
        self._notes.append({"label": str(label), "values": dict(values)})

    def hint(self, name: str, value) -> None:
        self._hints[str(name)] = value

    def write_private(self, payload) -> None:
        self._private = payload
        self._writes += 1

    # -- what the guest reads ----------------------------------------------

    def public_inputs(self) -> dict:
        return dict(self._public)

    def hints(self) -> dict:
        return dict(self._hints)

    def read_private(self):
        if self._writes == 0:
            raise ValueError("nothing was written to the private input channel")
        self._reads += 1
        return self._private

    # -- what an observer reads --------------------------------------------

    def transcript(self) -> dict:
        """Everything a run leaves behind on the host. The private channel is not in it."""
        return {
            "public": dict(self._public),
            "variables": dict(self._variables),
            "notes": tuple(dict(record) for record in self._notes),
        }

    def writes(self) -> int:
        return self._writes

    def reads(self) -> int:
        return self._reads

    def __repr__(self) -> str:  # pragma: no cover - a debugging aid, never asserted on
        return (
            f"Env(public={sorted(self._public)}, variables={sorted(self._variables)}, "
            f"notes={len(self._notes)}, writes={self._writes})"
        )


# ---------------------------------------------------------------------------
# What a run publishes, and the policy it is audited against
# ---------------------------------------------------------------------------

#: Every field of the public journal, in order. Nothing else belongs in one, and the three
#: things that most want to be in one -- the witness, the execution trace, the search -- are
#: not on this list and are not coming.
JOURNAL_FIELDS = (
    "statementDigest",
    "imageDigest",
    "claimResult",
    "guestVersion",
    "measurements",
)

#: The public measurements a journal may carry. One, and it is one that is already implied by
#: the image: a measurement is safe exactly when publishing it tells a reader nothing they
#: could not already compute.
MEASUREMENT_NAMES = ("steps",)

#: What a receipt is here. A real one carries a seal as well, and verifying a seal is precisely
#: the part of this that cryptography already does -- so it is out of scope and the binding it
#: is useless without is not.
RECEIPT_FIELDS = ("journal",)

#: What one run reports back to the host that started it.
RUN_FIELDS = (
    "imageDigest",
    "steps",
    "accepted",
    "violated",
    "wrapped",
    "trapped",
    "claimResult",
)

#: The six places a run can put something in front of somebody. A leak is a (channel, name)
#: pair, because the same name is a different disclosure depending on where it comes out.
CHANNELS = ("journal", "stdout", "stderr", "error", "trace", "temp")

#: Every field name a run may disclose, whichever channel it comes out of. Everything on this
#: list is either public before the run started or is the claim the run exists to publish.
#: Everything else is witness-derived, and "derived" is doing real work: the price is public and
#: the modulus is a power of two, so a machine cost is a quantity with one inverse applied.
PUBLIC_NAMES = (
    "budget",
    "claim",
    "claimResult",
    "domain",
    "guestVersion",
    "imageDigest",
    "imageId",
    "measurements",
    "params",
    "price",
    "semantics",
    "sourcePath",
    "spent",
    "statementDigest",
    "statementId",
    "steps",
)


class Disclosure:
    """One run's view from the outside, frozen. Six channels, and a correctness test reads one.

    ```text
    journal  the sealed journal itself
    stdout   records a run wrote to its output
    stderr   records a run wrote to its error output
    error    the record a failed run left, or None
    trace    the execution trace a prover kept for debugging
    temp     the temporary artifacts it left on disk
    ```

    Every channel but `journal` and `error` is a tuple of `{"label", "values"}` records, and
    `error` is `{"message", "values"}`. The label and the message are free text and are not
    policed; the names inside `values` are, because a name is what a policy can be written
    against and a formatted string is not.
    """

    __slots__ = CHANNELS

    def __init__(self, journal: dict, stdout=(), stderr=(), error=None, trace=(), temp=()) -> None:
        self.journal = dict(journal)
        self.stdout = tuple(stdout)
        self.stderr = tuple(stderr)
        self.error = None if error is None else dict(error)
        self.trace = tuple(trace)
        self.temp = tuple(temp)

    def __repr__(self) -> str:  # pragma: no cover - a debugging aid, never asserted on
        return (
            f"Disclosure(journal={sorted(self.journal)}, stdout={len(self.stdout)}, "
            f"stderr={len(self.stderr)}, error={self.error is not None}, "
            f"trace={len(self.trace)}, temp={len(self.temp)})"
        )


def record(label: str, **values) -> dict:
    """One channel record: a free-text label, and the named fields a policy is written against."""
    return {"label": str(label), "values": dict(values)}
