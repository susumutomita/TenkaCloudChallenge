"""The program image, the public statement, the private witness, and the toy runner.

Nothing here is copied from the course's `zkvm-exploit` exercise: no struct names, no function
names, no constants, no fixtures, no skeleton. The target program is the one
`ac26-w6-zkvm-exploit-predicate` was built around -- a prepaid account with two places one
order can wrap -- and everything around it is written out below.

## What is being built, and what is deliberately not

A zkVM proof has two halves that nobody proves anything about: the **statement** the proof is
offered against, and the **journal** it publishes. The cryptography binds the journal to a run
of a program. It does not tell you which program, which inputs, or which claim -- those are
things the guest has to say out loud, in bytes, in a way that means exactly one thing.

So no proof is generated here. What is built is the contract around it:

```text
public statement    the target's digest, the integer semantics, the claim, the public
                    parameters, the guest version, and the domain the claim is made in
private witness     the exploit input, the auxiliary values, the search intermediates
public journal      the statement's canonical digest, the target digest, the claim result,
                    the guest version, and a minimal public measurement -- and none of the
                    three private things, ever
```

Every failure this problem is about lives in that contract. A statement that two different
targets can both satisfy. A digest over a source path rather than over the bytes that ran. A
witness handed to the guest through an argument anyone can read. A guest that believes the
host's answer instead of recomputing it. A journal that carries one number too many, and the
number happens to determine the witness.

## The target program, carried over

`ac26-w6-zkvm-exploit-predicate` decided *what counts as an exploit* on a toy prepaid account:

```text
order(quantity)
    cost  = price * quantity      <- wrap site "mul"
    total = spent + cost          <- wrap site "add"
    if total <= budget:
        deliver(quantity)
        spent = total
```

with the security property stated over plain integers, where nothing wraps:

```text
spent + price * quantity <= budget
```

That predicate is the thing being proved *about* here. It is not restated as an exercise: this
problem hands the same account and the same two wrap sites to a guest and asks what the guest
may publish about them.

Two things changed on the way over, and both are the point.

The account's numbers -- `price`, `spent`, `budget` -- are no longer baked into a target spec.
They are **public inputs** to the program, carried in the statement. The same compiled guest
proves claims about every account there is, and the only thing that says *which* account a
proof is about is the statement it was bound to. That is what `concept.public-input-binding`
names, and it is why an encoder that lets two accounts produce the same bytes is not a
formatting bug.

The integer semantics are no longer a property of the target either. A `semantics` profile
names the width **and** what the hardware does on overflow, and the same image under two
profiles is two different machines:

```text
wrapping     the result is reduced modulo 2**width -- the machine the exploit needs
saturating   the result is clamped at the largest value the machine can hold
checked      the machine traps and the run stops
```

The exploit exists on exactly one of the three. A journal that does not say which one it ran
under is a proof about whichever machine the reader happens to assume.

## The image, and what a digest is over

An image is bytes: a header, a build stamp, and the opcodes the guest will execute. The
fixtures also hand out the two labels a real toolchain puts next to those bytes -- a source
path and an image id -- and both of them lie in at least one of the siblings. A rebuild of the
same source with one comparison changed is a different program under the same path; the same
bytes copied to another path are the same program. A digest that reads either label instead of
the body will call one of those pairs wrong.

## The runner has two doors

`Env` is the call a host builds for one guest run. Everything a host says through
`public`, `variable` and `note` lands in the transcript, which is what a verifier -- and
anyone with the operator's logs -- reads afterwards. `write_private` is the private input
channel and does not. `hint` is host advice: it reaches the guest, it is not in the
transcript, and it is not evidence of anything, because the host is the party being proved
about.

None of this is a security boundary. The participant owns the machine and the image, and the
runner is an *instrument*: it records which door each value went through. What the record can
prove is exactly that, and no more.
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


def _assemble(build_id: int, ops: tuple[str, ...]) -> bytes:
    """An image body. No validation, so a corrupt one can be built on purpose."""
    codes = {name: code for code, name in OPCODES.items()}
    return b"".join(
        (
            MAGIC,
            bytes((IMAGE_FORMAT,)),
            build_id.to_bytes(4, BYTE_ORDER),
            bytes((len(ops),)),
            bytes(codes[name] for name in ops),
        )
    )


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


def _image_record(source_path: str, body: bytes, image_id: str | None = None) -> dict:
    """One image as a toolchain hands it over: the bytes, and two labels next to them.

    ```text
    body        what the guest executes
    sourcePath  where the toolchain says it was built from
    imageId     what the toolchain calls it
    buildId     the build stamp inside the body
    ```

    The two labels are metadata. They are here because they are what a real pipeline puts in
    front of you, and because at least one sibling image below has one of them wrong.
    """
    return {
        "imageId": image_id or f"IMG-{commit(body, IMAGE_COMMITMENT_DOMAIN)[:12]}",
        "sourcePath": source_path,
        "buildId": int.from_bytes(body[len(MAGIC) + 1 : len(MAGIC) + 5], BYTE_ORDER),
        "body": body,
    }


#: Where the guest is built from. Every image the fixtures hand out claims this path except the
#: one that was copied somewhere else.
SOURCE_PATH = "guest/order/src/main.rs"


def image(seed: str, label: str = "public") -> dict:
    """The compiled guest for one checkpoint: four steps and a build stamp."""
    s = _stream(seed, f"image:{label}")
    guard = GUARDS[s[0] % len(GUARDS)]
    build_id = _pick(s, 2, 1, 0xFFFF)
    return _image_record(
        SOURCE_PATH, _assemble(build_id, ("load-quantity", "mul-price", "add-spent", guard))
    )


def sibling_images(seed: str, label: str = "public") -> dict:
    """Four images next to `image(seed, label)`, each differing in exactly one way.

    ```text
    rebuilt     the same source path, the other guard, a new stamp -- a different program
    restamped   the same steps, a different build stamp -- a different image, same behaviour
    renamed     the same bytes under another path -- the same program
    relabelled  the same bytes under the rebuilt image's id -- the same program
    ```

    A digest over the source path calls `rebuilt` the base image, which it is not: the two of
    them disagree about every order whose total lands exactly on the budget. A digest over the
    toolchain's `imageId` calls `relabelled` a different program, which it also is not. Only
    `restamped` is a judgement call, and it is settled the way real proving systems settle it:
    a rebuild is a different image even when nothing observable changed, because "nothing
    observable changed" is the claim under audit rather than an input to it.
    """
    base = image(seed, label)
    body = base["body"]
    steps = decode_program(body)
    other_guard = next(guard for guard in GUARDS if guard != steps[-1])
    rebuilt = _image_record(
        SOURCE_PATH, _assemble(base["buildId"] ^ 3, (*steps[:-1], other_guard))
    )
    return {
        "rebuilt": rebuilt,
        "restamped": _image_record(SOURCE_PATH, _assemble(base["buildId"] ^ 1, steps)),
        "renamed": _image_record("vendor/order-guest/main.rs", body),
        "relabelled": _image_record(SOURCE_PATH, body, image_id=rebuilt["imageId"]),
    }


def corrupt_bodies(seed: str, label: str = "public") -> tuple[tuple[object, str], ...]:
    """Bodies that are not programs, in every shape one can arrive in.

    A digest is a promise that the thing digested is the thing that ran. Bytes nothing can run
    have no such promise to make, so digesting them anyway hands out a commitment to nothing.
    """
    body = image(seed, label)["body"]
    return (
        (b"", "an empty body"),
        (b"NOPE" + body[len(MAGIC) :], "a body that is not a zkVM image"),
        (body[:-1], "a body one opcode shorter than it declares"),
        (body[:-1] + bytes((0x99,)), "a body holding an opcode this machine does not have"),
        (
            _assemble(1, ("guard-le", "load-quantity", "mul-price", "add-spent")),
            "a body whose steps are not a program",
        ),
        ("not bytes at all", "a body that is not bytes"),
    )


# ---------------------------------------------------------------------------
# Drawing the seed
# ---------------------------------------------------------------------------


def _stream(seed: str, label: str) -> list[int]:
    out: list[int] = []
    counter = 0
    while len(out) < 512:
        out.extend(hashlib.sha256(f"{seed}:{label}:{counter}".encode()).digest())
        counter += 1
    return out


def _pick(s: list[int], i: int, low: int, high: int) -> int:
    return low + ((s[i % 500] * 256 + s[(i + 1) % 500]) % (high - low + 1))


# ---------------------------------------------------------------------------
# The public statement
# ---------------------------------------------------------------------------


def semantics_id(seed: str, label: str = "public") -> str:
    """The profile a checkpoint's statement runs under. Always wrapping, never the same width.

    The other two behaviours are in `SEMANTICS` and never in a statement these fixtures build,
    because on a saturating or a checked machine this claim has no witness at all. They are
    there to be offered to a verifier that ought to refuse them.
    """
    s = _stream(seed, f"semantics:{label}")
    return f"u{WIDTHS[s[0] % len(WIDTHS)]}-wrapping"


def params(seed: str, label: str, profile: dict) -> dict:
    """One account, as public inputs to the program.

    `price` is odd, which is not decoration: the modulus is a power of two, so an odd price is
    invertible and *every* residue is reachable by some quantity. An even price would leave the
    machine's arithmetic unable to land where the exploit needs it, and a checkpoint that
    happened to draw one would be unsolvable rather than hard.

    `spent` is at least the price, which is what keeps the add-site witness inside the
    machine's domain; `budget` leaves room for at least one honest unit, without which there is
    no ordinary purchase for an exploit to be told apart from.

    The budget stays under half the modulus, which does more than keep the property breakable:
    it means the same three numbers are still a legal account one width down, so a statement can
    be re-offered under another integer semantics without becoming malformed. A refusal has to
    be about the binding, not about the numbers having stopped making sense.
    """
    s = _stream(seed, f"params:{label}")
    modulus = profile["modulus"]
    price = _pick(s, 0, 3, max(3, modulus // 16)) | 1
    spent = _pick(s, 4, price, max(price + 1, modulus // 8))
    budget = _pick(s, 8, spent + price, modulus // 2 - 1)
    return {"price": price, "spent": spent, "budget": budget}


def statement(seed: str, label: str = "public", site: str = "mul", **overrides) -> dict:
    """The public half of one proof of exploit: everything a reader needs and nothing more.

    ```text
    domain        which protocol this claim is made in
    guestVersion  which guest build decided it
    imageDigest   which program was executed
    semantics     which machine it was executed on
    claim         which security failure, at which wrap site
    params        the account the claim is about
    ```

    The witness is not in here, which is the whole construction: the statement says *what* is
    being asserted, and the proof says that somebody knew an input making it true.
    """
    s = _stream(seed, f"statement:{label}")
    profile = SEMANTICS[semantics_id(seed, label)]
    drawn = {
        "domain": DOMAINS[s[0] % len(DOMAINS)],
        "guestVersion": GUEST_VERSIONS[s[2] % len(GUEST_VERSIONS)],
        "imageDigest": commit(image(seed, label)["body"], IMAGE_COMMITMENT_DOMAIN),
        "semantics": profile["semanticsId"],
        "claim": f"{EFFECT}@{site}",
        "params": params(seed, label, profile),
    }
    drawn.update(overrides)
    # Rebuilt in the declared order rather than handed back as it was assembled, so a statement
    # from these fixtures never happens to be canonical by accident of insertion order.
    return {field: drawn[field] for field in STATEMENT_FIELDS}


def statement_id(record: dict) -> str:
    """A readable name for one statement. For messages and for the disclosures below."""
    values = "-".join(f"{name[0].upper()}{record['params'][name]}" for name in PARAM_NAMES)
    site, digest = claim_site(record["claim"]), record["imageDigest"][:8]
    return f"{record['semantics']}-{values}-{site}-{digest}"


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
# Ground truth: the fixtures' own answers
#
# Everything from here down exists so a hidden checker can tell a right answer from a
# convincing one. The hidden checker imports this; a guest module must not.
# ---------------------------------------------------------------------------


def _machine(record: dict, program: tuple[str, ...], quantity: int) -> dict:
    """One order on the wrapping machine, as the fixtures need it to build a witness.

    Wrapping only. Every statement these fixtures build names a wrapping profile, so the
    saturating and the checked behaviours are nowhere in this file -- a guest owes its caller
    all three, and the two that are missing here are the two that make the claim unwitnessable.
    """
    profile = SEMANTICS[record["semantics"]]
    modulus, maximum = profile["modulus"], profile["max"]
    price, spent, budget = (record["params"][name] for name in PARAM_NAMES)
    accumulator, cost, wrapped = 0, 0, []
    accepted = False
    for step in program:
        if step == "load-quantity":
            accumulator = quantity
            continue
        if step in GUARDS:
            accepted = accumulator <= budget if step == "guard-le" else accumulator < budget
            continue
        exact = accumulator * price if step == "mul-price" else accumulator + spent
        if exact > maximum:
            wrapped.append(WRAP_SITE_OF[step])
        accumulator = exact % modulus
        if step == "mul-price":
            cost = accumulator
    return {
        "cost": cost,
        "total": accumulator,
        "accepted": accepted,
        # The property is about value, not about registers. Asked of the wrapped total it
        # becomes "did the machine notice", the machine did not notice, and not noticing is the
        # failure being proven rather than a verdict on it.
        "violated": spent + price * quantity > budget,
        "wrapped": tuple(sorted(set(wrapped))),
    }


def _proves(record: dict, program: tuple[str, ...], quantity: int, site: str) -> bool:
    run = _machine(record, program, quantity)
    return bool(run["accepted"] and run["violated"] and site in run["wrapped"])


def exploit_quantity(record: dict, program: tuple[str, ...], site: str) -> int:
    """A quantity that overflows the named site and gets goods delivered anyway.

    For `mul`: the price is invertible, so `price**-1 mod modulus` makes the machine's cost
    exactly 1. The true cost is at least the modulus, which is past the budget by construction.

    For `add`: the smallest quantity whose product carries the total past zero. The product
    itself stays inside the machine, so the multiply does not wrap and the claim about the
    addition is the only one this witness supports.

    Both closed forms are checked against the machine before they are returned, and a bounded
    scan takes over if either fails. The forms are right for every draw these fixtures make and
    that is a statement about the draw, not about the algebra; a fixture that is right for most
    seeds is a fixture that fails on somebody's.
    """
    profile = SEMANTICS[record["semantics"]]
    price, spent = record["params"]["price"], record["params"]["spent"]
    modulus = profile["modulus"]
    closed = inverse(price, modulus) if site == "mul" else -(-(modulus - spent) // price)
    for quantity in (closed, *range(profile["max"] + 1)):
        if 0 <= quantity <= profile["max"] and _proves(record, program, quantity, site):
            return quantity
    raise ValueError(f"no quantity proves {site} on {statement_id(record)}")


def _search_trail(quantity: int, count: int = 5) -> tuple[int, ...]:
    """The quantities a search touched, ending at the one it found.

    Five of them, so the trail's length is never the program's step count -- a measurement that
    happens to equal a public constant would let one of the disclosures below be right by
    accident instead of by policy.
    """
    trail = [max(0, quantity - offset) for offset in range(count - 1, 0, -1)]
    return (*trail, quantity)


def exploit_witness(record: dict, program: tuple[str, ...], site: str) -> dict:
    """The complete private half for one statement: the quantity, the run, and the trail."""
    quantity = exploit_quantity(record, program, site)
    run = _machine(record, program, quantity)
    return witness(quantity, run["cost"], run["total"], _search_trail(quantity))


def scenario(seed: str, label: str = "public", site: str = "mul") -> dict:
    """One image, one statement about it, and a witness that proves that statement's claim."""
    built = image(seed, label)
    record = statement(seed, label, site=site)
    return {
        "image": built,
        "statement": record,
        "witness": exploit_witness(record, decode_program(built["body"]), site),
    }


# ---------------------------------------------------------------------------
# Ground truth: two statements a sloppy encoder cannot tell apart
# ---------------------------------------------------------------------------


def collision_pair(seed: str, label: str = "public") -> tuple[dict, dict]:
    """Two accounts whose statements are the same bytes under `naive_encode`, and only there.

    They agree on the domain, the guest, the image and the claim. They disagree about who is
    being charged what: one account is expensive and barely used, the other is cheap and
    heavily used. Concatenate the decimal parameters and the two disagreements cancel, digit
    for digit -- `"53" + "7"` and `"5" + "37"` are the same three characters.

    Both members are real accounts with real exploits. That matters: the failure this pair
    demonstrates is not that a malformed statement slips through, it is that a **valid** proof
    about one real account is a valid proof about a different real account. The width is drawn
    from the wider profiles because both members have to fit in the machine's domain at once,
    and the two-digit parameters need the room.
    """
    s = _stream(seed, f"collision:{label}")
    profile = SEMANTICS[f"u{(10, 11, 12, 13)[s[0] % 4]}-wrapping"]
    head = (3, 5, 7, 9)[s[2] % 4]
    tail = (1, 3, 5, 7, 9)[s[4] % 5]
    left_spent = _pick(s, 6, 1, 9)
    budget = _pick(s, 10, 120, min(profile["max"], 400))
    shared = statement(seed, label, semantics=profile["semanticsId"])
    left_params = {"price": head * 10 + tail, "spent": left_spent, "budget": budget}
    right_params = {"price": head, "spent": tail * 10 + left_spent, "budget": budget}
    left = {**shared, "params": left_params}
    right = {**shared, "params": right_params}
    if left == right or naive_encode(left) != naive_encode(right):
        raise ValueError(f"the collision pair for {label} no longer collides")
    return left, right


def statement_family(seed: str, label: str = "public") -> tuple[dict, ...]:
    """A base statement, one single-field variant of it per field, and the colliding pair.

    Every member is a statement somebody could legitimately make, and no two of them are the
    same statement. An encoding that maps any two of them to the same bytes has said that a
    proof about one is a proof about the other, and which pair it was does not soften that.
    """
    base = statement(seed, label)
    rebuilt = sibling_images(seed, label)["rebuilt"]
    left, right = collision_pair(seed, label)
    # The same integers on a machine that clamps instead of carrying. Every member of the family
    # has to be an account somebody could really make a claim about, and reusing this account's
    # numbers at another *width* would put them outside the narrower machine's domain.
    clamping = f"u{SEMANTICS[base['semantics']]['width']}-saturating"
    return (
        base,
        {**base, "domain": next(name for name in DOMAINS if name != base["domain"])},
        {**base, "guestVersion": next(v for v in GUEST_VERSIONS if v != base["guestVersion"])},
        {**base, "imageDigest": commit(rebuilt["body"], IMAGE_COMMITMENT_DOMAIN)},
        {**base, "semantics": clamping},
        {**base, "claim": next(c for c in CLAIMS if c != base["claim"])},
        {**base, "params": {**base["params"], "budget": base["params"]["budget"] + 1}},
        left,
        right,
    )


def naive_collisions(seed: str, label: str = "public") -> tuple[tuple[dict, dict], ...]:
    """Every pair in the family that `naive_encode` cannot tell apart.

    Computed rather than declared, so it stays true when the family changes -- and so the claim
    "a sloppy encoder collides here" is measured rather than asserted.
    """
    family = statement_family(seed, label)
    return tuple(
        (left, right)
        for index, left in enumerate(family)
        for right in family[index + 1 :]
        if left != right and naive_encode(left) == naive_encode(right)
    )


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


# ---------------------------------------------------------------------------
# Ground truth: receipts offered against the wrong thing
# ---------------------------------------------------------------------------


def replay_cases(seed: str, label: str = "public") -> tuple[dict, ...]:
    """Receipts re-offered, each against something one field away from what sealed them.

    ```text
    id        opaque, and stable per seed
    sealed    the statement the journal was sealed under
    offered   the statement it is being offered against
    edit      journal fields replaced after sealing
    drop      journal fields removed after sealing
    ```

    Every `sealed` statement names the base image, so one program and one witness search cover
    the whole table. Two of the rows are honest and the rest are not, and the one worth staring
    at is `other-params`: it is the colliding pair, offered against each other. Under a
    length-free encoder that row verifies, and the receipt is then a valid proof that an account
    nobody has touched is over its budget.
    """
    base = statement(seed, label)
    add_site = statement(seed, label, site="add")
    left, right = collision_pair(seed, label)
    rebuilt = commit(sibling_images(seed, label)["rebuilt"]["body"], IMAGE_COMMITMENT_DOMAIN)
    profile = SEMANTICS[base["semantics"]]
    saturating = f"u{profile['width']}-saturating"
    # The widest width that is not this one, so the account is still inside the machine's domain
    # there. An offered statement that is refused for being malformed has not tested the binding.
    wider = next(f"u{width}-wrapping" for width in reversed(WIDTHS) if width != profile["width"])

    rows = (
        ("honest", base, base, {}, ()),
        ("honest-add-site", add_site, add_site, {}, ()),
        ("other-image", base, {**base, "imageDigest": rebuilt}, {}, ()),
        ("other-claim", base, {**base, "claim": f"{EFFECT}@add"}, {}, ()),
        ("other-width", base, {**base, "semantics": wider}, {}, ()),
        ("other-overflow", base, {**base, "semantics": saturating}, {}, ()),
        ("other-domain", base, {**base, "domain": _other(DOMAINS, base["domain"])}, {}, ()),
        (
            "other-guest",
            base,
            {**base, "guestVersion": _other(GUEST_VERSIONS, base["guestVersion"])},
            {},
            (),
        ),
        ("other-params", left, right, {}, ()),
        ("edited-image-digest", base, base, {"imageDigest": rebuilt}, ()),
        (
            "edited-guest-version",
            base,
            base,
            {"guestVersion": _other(GUEST_VERSIONS, base["guestVersion"])},
            (),
        ),
        ("refuted", base, base, {"claimResult": False}, ()),
        ("extra-field", base, base, {"trace": ("load-quantity", "mul-price")}, ()),
        ("missing-field", base, base, {}, ("measurements",)),
        ("bad-measurement", base, base, {"measurements": {"quantity": 1}}, ()),
    )
    return tuple(
        {"id": name, "sealed": sealed, "offered": offered, "edit": dict(edit), "drop": tuple(drop)}
        for name, sealed, offered, edit, drop in rows
    )


def _other(vocabulary: tuple[str, ...], value: str) -> str:
    return next(item for item in vocabulary if item != value)


def replay_truth(seed: str, label: str = "public") -> dict:
    """Whether each replay case should verify. The hidden checker imports this; a guest must not.

    A receipt verifies against exactly the statement it was sealed under, carrying exactly the
    journal it was sealed with, asserting that the claim held. Everything else is a receipt
    about something else.
    """
    return {
        case["id"]: case["sealed"] == case["offered"] and not case["edit"] and not case["drop"]
        for case in replay_cases(seed, label)
    }


# ---------------------------------------------------------------------------
# Ground truth: what ten runs said, and which of them gave the witness away
# ---------------------------------------------------------------------------


def _specimens(seed: str, label: str) -> tuple[tuple[str, Disclosure, tuple], ...]:
    """`(kind, disclosure, leaks)` for each run, before the seed shuffles them."""
    built = scenario(seed, label)
    record_statement, private = built["statement"], built["witness"]
    steps = len(decode_program(built["image"]["body"]))
    cost, total = private["aux"]["machineCost"], private["aux"]["machineTotal"]
    # A stand-in commitment. These disclosures exist to be audited for what they name, not for
    # whether the digest in them is the right digest, so the statement's own id is enough.
    digest = commit(statement_id(record_statement).encode(), STATEMENT_COMMITMENT_DOMAIN)
    journal = {
        "statementDigest": digest,
        "imageDigest": record_statement["imageDigest"],
        "claimResult": True,
        "guestVersion": record_statement["guestVersion"],
        "measurements": {"steps": steps},
    }
    working = record(
        "proving", claim=record_statement["claim"], semantics=record_statement["semantics"]
    )
    return (
        ("clean", Disclosure(journal, stdout=(working,)), ()),
        (
            "journal-quantity",
            Disclosure(
                {**journal, "measurements": {"steps": steps, "quantity": private["quantity"]}}
            ),
            (("journal", "quantity"),),
        ),
        (
            "journal-search-steps",
            Disclosure({**journal, "measurements": {"steps": len(private["search"])}}),
            (("journal", "steps"),),
        ),
        (
            "stdout-cost",
            Disclosure(journal, stdout=(working, record("cost", machineCost=cost))),
            (("stdout", "machineCost"),),
        ),
        (
            "stderr-search",
            Disclosure(journal, stderr=(record("retry", searchTried=private["search"]),)),
            (("stderr", "searchTried"),),
        ),
        (
            "error-witness",
            Disclosure(
                journal,
                error={
                    "message": "guard refused the order",
                    "values": {"quantity": private["quantity"], "aux": (cost, total)},
                },
            ),
            (("error", "aux"), ("error", "quantity")),
        ),
        (
            "trace-accumulator",
            Disclosure(
                journal,
                trace=(record("mul-price", acc=cost), record("add-spent", acc=total)),
            ),
            (("trace", "acc"),),
        ),
        (
            "temp-witness",
            Disclosure(
                journal,
                temp=(record("/tmp/prove-1/witness.json", witness=(private["quantity"],)),),
            ),
            (("temp", "witness"),),
        ),
        (
            # An approved label is not an approval. `spent` may be published; the machine's own
            # total wearing the name `spent` is a different disclosure entirely, and one modular
            # inverse away from the quantity.
            "stdout-relabelled-total",
            Disclosure(journal, stdout=(record("charged", spent=total),)),
            (("stdout", "spent"),),
        ),
        (
            # Loud and clean. Every channel is full of numbers and not one of them says
            # anything a reader did not have before the run started.
            "public-noise",
            Disclosure(
                journal,
                stdout=(
                    record(
                        "statement",
                        params=dict(record_statement["params"]),
                        statementId=statement_id(record_statement),
                    ),
                ),
                stderr=(
                    record(
                        "build",
                        imageId=built["image"]["imageId"],
                        sourcePath=built["image"]["sourcePath"],
                    ),
                ),
                trace=(record("cycles", steps=steps),),
                temp=(
                    record("/tmp/prove-1/image.id", imageDigest=record_statement["imageDigest"]),
                ),
            ),
            (),
        ),
    )


def disclosures(seed: str, label: str = "public") -> tuple[dict, ...]:
    """Ten runs of the same claim, in a seed-derived order and under opaque ids.

    ```text
    id          opaque, re-drawn per seed
    disclosure  what that run put in front of you
    ```

    All ten produced the same journal claim and all ten are correct. Two of them disclose
    nothing that gives the witness away, and reporting a leak against either of those is exactly
    as wrong as missing one against the other eight. The statement, image and witness behind
    them are `scenario(seed, label)`, which is how an auditor can tell whether an approved name
    is carrying the value it names.
    """
    ordered = _specimens(seed, label)
    s = _stream(seed, f"disclosures:{label}")
    order = sorted(range(len(ordered)), key=lambda index: (s[(7 * index) % 500], index))
    return tuple(
        {"id": f"d{position}", "disclosure": ordered[index][1]}
        for position, index in enumerate(order)
    )


def disclosure_truth(seed: str, label: str = "public") -> dict:
    """The `(channel, name)` leaks behind each disclosure id, sorted.

    The hidden checker imports this; a guest module must not.
    """
    ordered = _specimens(seed, label)
    s = _stream(seed, f"disclosures:{label}")
    order = sorted(range(len(ordered)), key=lambda index: (s[(7 * index) % 500], index))
    return {
        f"d{position}": tuple(sorted(ordered[index][2]))
        for position, index in enumerate(order)
    }


def health_token(seed: str) -> str:
    name = statement_id(statement(seed))
    return hashlib.sha256(f"health:{seed}:{name}".encode()).hexdigest()[:16]
