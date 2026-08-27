"""This deployment's own data, and the fixtures' own answers. Hidden material.

Issue 537/538 (Issue 543 option B2): this module used to ship in the single Docker stage a
learner's `make build` produced, beside `tests/hidden/check_guest.py`. Everything below the
"Ground truth" rules is an answer to a checkpoint -- `_machine` is `run_guest`, and
`replay_truth` and `disclosure_truth` are the `replay` and `privacy` verdicts -- and the checker
next to it carried the other four (`_encode` is `encode_statement`, `_run` is `run_guest` again,
`_journal` is `seal_journal`, `_leaks` is `leak_report`). A submission transcribed from those two
files, with no reasoning past copying, scored 8 of 8 checkpoints (300 of 300 points).

So this file lives in the `verifier` stage now and in no other (see ../Dockerfile). The supplied
half a learner is meant to have -- the vocabulary, the semantics profiles, the commitment, the
image decoder, the two encoders and the toy runner -- moved to `participant/lab.py` and is
imported back here rather than defined twice, so the machine a learner inspects and the machine
this checker grades on are one implementation. What a participant reads instead of importing
this module is `public_payload` below, served as `GET /public` (see ../verifier/server.py).

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

Nothing here is copied from the course's `zkvm-exploit` exercise: no struct names, no function
names, no constants, no fixtures, no skeleton. The target program is the one
`ac26-w6-zkvm-exploit-predicate` was built around -- a prepaid account with two places one order
can wrap -- and everything around it is written out below.

## The image, and what a digest is over

An image is bytes: a header, a build stamp, and the opcodes the guest will execute. The fixtures
also hand out the two labels a real toolchain puts next to those bytes -- a source path and an
image id -- and both of them lie in at least one of the siblings. A rebuild of the same source
with one comparison changed is a different program under the same path; the same bytes copied to
another path are the same program. A digest that reads either label instead of the body will
call one of those pairs wrong.
"""

from __future__ import annotations

import hashlib
import sys
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

# The supplied half. Re-exported rather than redefined: `tests/hidden/check_guest.py`,
# `mutation.py` and this module all import these names from here, and a learner's submission
# imports the same objects from `participant.lab` -- one implementation, graded and inspected.
from participant.lab import (  # noqa: E402,F401 - re-exported for the hidden checker
    BYTE_ORDER,
    CHANNELS,
    CLAIMS,
    DIGEST_HEX_LENGTH,
    DOMAINS,
    EFFECT,
    GUARDS,
    GUEST_VERSIONS,
    IMAGE_COMMITMENT_DOMAIN,
    IMAGE_FORMAT,
    INTEGER_BYTES,
    JOURNAL_FIELDS,
    LENGTH_PREFIX_BYTES,
    MAGIC,
    MEASUREMENT_NAMES,
    OPCODES,
    OVERFLOWS,
    PARAM_NAMES,
    PUBLIC_NAMES,
    RECEIPT_FIELDS,
    RUN_FIELDS,
    SEMANTICS,
    SEMANTICS_IDS,
    STATEMENT_COMMITMENT_DOMAIN,
    STATEMENT_FIELDS,
    WIDTHS,
    WRAP_SITES,
    WRAP_SITE_OF,
    Disclosure,
    Env,
    claim_site,
    commit,
    decode_program,
    inverse,
    is_well_formed,
    naive_encode,
    record,
    shuffled,
    witness,
)

# ---------------------------------------------------------------------------
# The program image
# ---------------------------------------------------------------------------


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


# ---------------------------------------------------------------------------
# What a participant may see for this deployment
# ---------------------------------------------------------------------------


def _public_image(built: dict) -> dict:
    """One image record over the wire: the two labels, the stamp, and the bytes as hex."""
    return {
        "imageId": built["imageId"],
        "sourcePath": built["sourcePath"],
        "buildId": built["buildId"],
        "body": bytes(built["body"]).hex(),
    }


def _public_disclosure(disclosure: Disclosure) -> dict:
    """One run's six channels over the wire. What is *behind* them does not travel."""
    return {
        "journal": dict(disclosure.journal),
        "stdout": [dict(entry) for entry in disclosure.stdout],
        "stderr": [dict(entry) for entry in disclosure.stderr],
        "error": None if disclosure.error is None else dict(disclosure.error),
        "trace": [dict(entry) for entry in disclosure.trace],
        "temp": [dict(entry) for entry in disclosure.temp],
    }


def public_payload(seed: str) -> dict[str, Any]:
    """Everything a participant may see for this deployment. Carries data, not code.

    Exactly what `make inspect` has always printed and what the public tests have always been
    handed: the public label's statement, the image the statement names and the four siblings
    beside it, the witness that proves the claim, the colliding pair, the size of the statement
    family, and the ids of the receipts and of the ten audited runs. The public tests hand the
    statement, the image and the witness straight to the learner's own functions as their
    arguments, so a submission holds them at runtime by construction; withholding them here
    would hide them from `show.py` and from nobody else (the same reading as
    ac26-w2-private-aggregate's shares).

    The witness travels for the same reason and for one more: it is the *previous* problem's
    answer, not this one's. `ac26-w6-zkvm-exploit-predicate` graded finding a quantity that
    overflows a named site; here it is handed over so that the eight checkpoints can be about
    what a guest may say about a run, and `starter/guest.py` names it as something a learner is
    given.

    What does not travel is every verdict and every derivation. `replay_truth` (which of the
    fifteen receipts a verifier may accept) and `disclosure_truth` (which `(channel, name)` pairs
    each of the ten runs gave away) are the `replay` and `privacy` checkpoints, so only the ids
    are printed -- for the public label no less than for a graded one. `naive_collisions`, which
    pairs a length-free encoder merges, is the `encoding` checkpoint. `_machine`, the toy
    runner's own arithmetic, is `run_guest`. And none of `h0`..`h3` -- each a different width,
    account, protocol namespace and guest build, and every checkpoint is graded on those and on
    `transfer`'s own derived seed -- is reachable from this payload, which is what makes them
    unreachable rather than merely unnamed.
    """
    built = scenario(seed, "public")
    left, right = collision_pair(seed, "public")
    return {
        "healthToken": health_token(seed),
        "statement": built["statement"],
        "image": _public_image(built["image"]),
        "witness": {
            "quantity": built["witness"]["quantity"],
            "aux": dict(built["witness"]["aux"]),
            "search": list(built["witness"]["search"]),
        },
        "siblings": {
            name: _public_image(sibling)
            for name, sibling in sibling_images(seed, "public").items()
        },
        "collisionPair": [left, right],
        "statementFamilySize": len(statement_family(seed, "public")),
        "replayCaseIds": [case["id"] for case in replay_cases(seed, "public")],
        "disclosures": [
            {"id": entry["id"], "disclosure": _public_disclosure(entry["disclosure"])}
            for entry in disclosures(seed, "public")
        ],
    }
