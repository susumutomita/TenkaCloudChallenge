"""Reference solution. Ships inside the image so the mutation suite can break it on purpose.

The seven functions are one contract, not seven exercises, and the shape of that contract is
what makes them short. `encode_statement` decides what a statement *is* as bytes; every other
function that has to say "this proof is about that statement" says it by calling that one and
hashing the answer. There is deliberately no second encoder anywhere in this file. A journal
sealed by one set of rules and checked by another is two proof systems that agree most of the
time, and the seams between them are where a replayed receipt gets in.

Three of the functions refuse rather than answer, and it is worth being clear about which and
why. `encode_statement`, `guest_input` and `run_guest` raise: an encoder that will encode
anything hands out commitments to objects that are not statements, and a guest that will
execute anything has proved something about a program nobody named. `accept_receipt` never
raises, because it is the verifier: it is called on whatever a prover sends, and a verifier that
crashes on bad input has handed the decision back to the caller.

The one line most worth arguing about is in `run_guest`, and it is the line that is not there.
`env.hints()` is never read. The host is the party being proved about; its account of what the
answer should be is an input to the guest's work and never a substitute for it. A guest that
takes the hint is fast, is right almost always, and proves nothing at all.
"""

from __future__ import annotations

from fixtures.generate import (
    BYTE_ORDER,
    CLAIMS,
    DIGEST_HEX_LENGTH,
    DOMAINS,
    GUARDS,
    GUEST_VERSIONS,
    INTEGER_BYTES,
    IMAGE_COMMITMENT_DOMAIN,
    JOURNAL_FIELDS,
    LENGTH_PREFIX_BYTES,
    MEASUREMENT_NAMES,
    PARAM_NAMES,
    PUBLIC_NAMES,
    RECEIPT_FIELDS,
    RUN_FIELDS,
    SEMANTICS,
    STATEMENT_COMMITMENT_DOMAIN,
    STATEMENT_FIELDS,
    WRAP_SITE_OF,
    claim_site,
    commit,
    decode_program,
    is_well_formed,
)

_HEX = frozenset("0123456789abcdef")


# ---------------------------------------------------------------------------
# what a statement has to be before anything below will touch it
# ---------------------------------------------------------------------------


def _are_params(params: object, profile: dict) -> bool:
    """Whether an account is one this machine could hold.

    The bounds come from the profile the statement itself names, which is the only place they
    could come from: the same three numbers are a legal account on a thirteen-bit machine and
    nonsense on a seven-bit one.
    """
    if not isinstance(params, dict) or set(params) != set(PARAM_NAMES):
        return False
    values = [params[name] for name in PARAM_NAMES]
    if any(isinstance(value, bool) or not isinstance(value, int) for value in values):
        return False
    price, spent, budget = values
    return 0 < price <= profile["max"] and 0 <= spent < budget <= profile["max"]


def _is_statement(record: object) -> bool:
    """Whether this is a statement at all, on every field it has.

    Vocabularies rather than types. A `semantics` this build has never heard of is not a
    forward-compatible statement, it is a claim about a machine whose arithmetic nobody here
    can perform -- and answering it anyway is answering about the machine one was assumed to
    mean.
    """
    if not isinstance(record, dict) or set(record) != set(STATEMENT_FIELDS):
        return False
    if record["domain"] not in DOMAINS or record["guestVersion"] not in GUEST_VERSIONS:
        return False
    if record["semantics"] not in SEMANTICS or record["claim"] not in CLAIMS:
        return False
    digest = record["imageDigest"]
    if not isinstance(digest, str) or len(digest) != DIGEST_HEX_LENGTH:
        return False
    if any(character not in _HEX for character in digest):
        return False
    return _are_params(record["params"], SEMANTICS[record["semantics"]])


def _require_statement(record: object) -> dict:
    if not _is_statement(record):
        raise ValueError(f"{record!r} is not a statement this guest can be bound to")
    return record


def _statement_digest(record: dict) -> str:
    """The one commitment every binding below is made of."""
    return commit(encode_statement(record), STATEMENT_COMMITMENT_DOMAIN)


# ---------------------------------------------------------------------------
# 1. the canonical statement encoding
# ---------------------------------------------------------------------------


def _frame(payload: bytes) -> bytes:
    """One field, with its own length in front of it.

    The prefix is what makes the encoding self-delimiting, and self-delimiting is what makes it
    an encoding: with it, a reader knows where each field ends without knowing what any of them
    were supposed to contain, so no byte can belong to two fields at once.
    """
    return len(payload).to_bytes(LENGTH_PREFIX_BYTES, BYTE_ORDER) + payload


def _text(value: str) -> bytes:
    return _frame(value.encode("utf-8"))


def _integer(value: int) -> bytes:
    """A fixed width and a fixed byte order, framed like everything else.

    Fixed width because `1` and `01` are the same number and must be the same bytes; framed
    anyway, so that "every field is length-prefixed" is a rule with no exceptions to remember.
    """
    return _frame(value.to_bytes(INTEGER_BYTES, BYTE_ORDER))


def _params_block(params: dict) -> bytes:
    """The account as one field: each name with its value, in `PARAM_NAMES` order.

    The whole block is framed as well as each pair inside it. Without the outer frame a
    statement with three parameters and one with two followed by a longer next field are not
    separated by anything, and `params` is the last field only in this version of it.
    """
    return _frame(b"".join(_text(name) + _integer(params[name]) for name in PARAM_NAMES))


def encode_statement(statement: dict) -> bytes:
    _require_statement(statement)
    # The field order is `STATEMENT_FIELDS`, read rather than restated. An encoder that spelled
    # the order out itself would keep encoding statements after the statement changed shape,
    # and would keep producing bytes for the old shape under the new one's name.
    return b"".join(
        _params_block(statement["params"]) if field == "params" else _text(statement[field])
        for field in STATEMENT_FIELDS
    )


# ---------------------------------------------------------------------------
# 2. which program the claim is about
# ---------------------------------------------------------------------------


def image_digest(image: dict) -> str:
    if not isinstance(image, dict) or "body" not in image:
        raise ValueError("an image record carries the body that will be executed")
    # Decoded before it is digested. A digest is a promise that the bytes under it are the bytes
    # that ran, and bytes nothing can run have no such promise to make -- so this refuses to
    # commit to them rather than handing out a name for a program that does not exist.
    decode_program(image["body"])
    # The body, and nothing next to it. `sourcePath` is where a toolchain says it built this
    # and `imageId` is what the toolchain calls it; both are labels a build system writes down,
    # and neither of them is what the machine will execute.
    return commit(bytes(image["body"]), IMAGE_COMMITMENT_DOMAIN)


# ---------------------------------------------------------------------------
# 3. handing the guest its inputs
# ---------------------------------------------------------------------------


def guest_input(env, statement: dict, witness: dict) -> None:
    _require_statement(statement)
    profile = SEMANTICS[statement["semantics"]]
    if not is_well_formed(witness, profile):
        raise ValueError("the witness is not one this machine could have taken")
    # Exactly the statement, one field per public input. Fewer and the verifier is reading a
    # claim it cannot reconstruct; more and the extra one is a public input nobody agreed to.
    for field in STATEMENT_FIELDS:
        env.public(field, statement[field])
    # The one door that is not recorded. Everything the witness carries goes through it in a
    # single write -- not into an argument, not into the process environment, and not into a
    # note "so the run can be reproduced", which is the sentence at the end of most of these.
    env.write_private(witness)


# ---------------------------------------------------------------------------
# 4. running the program the statement names
# ---------------------------------------------------------------------------


def run_guest(image: dict, env) -> dict:
    statement = _require_statement(env.public_inputs())
    digest = image_digest(image)
    if digest != statement["imageDigest"]:
        # Fail closed, before a single step runs. Executing the wrong program and reporting
        # which one afterwards is a run somebody can quote out of context.
        raise ValueError("the image handed over is not the one this statement names")

    profile = SEMANTICS[statement["semantics"]]
    witness = env.read_private()
    if not is_well_formed(witness, profile):
        raise ValueError("the private channel does not carry a witness for this machine")

    quantity = witness["quantity"]
    price, spent, budget = (statement["params"][name] for name in PARAM_NAMES)
    modulus, maximum, overflow = profile["modulus"], profile["max"], profile["overflow"]

    accumulator, steps, accepted, trapped = 0, 0, False, False
    wrapped: list[str] = []
    for step in decode_program(image["body"]):
        if step == "load-quantity":
            accumulator = quantity
        elif step in GUARDS:
            accepted = accumulator <= budget if step == "guard-le" else accumulator < budget
        else:
            exact = accumulator * price if step == "mul-price" else accumulator + spent
            if exact > maximum:
                if overflow == "checked":
                    # A checked build stops here, which is the whole reason it is a different
                    # machine: on this profile the claim has no witness rather than a hard one.
                    trapped = True
                    break
                if overflow == "wrapping":
                    wrapped.append(WRAP_SITE_OF[step])
                    exact %= modulus
                else:
                    exact = maximum  # saturating: clamped, not carried around zero
            accumulator = exact
        steps += 1

    return {
        "imageDigest": digest,
        "steps": steps,
        "accepted": accepted,
        # Over plain integers, on every profile. The security property is a statement about
        # value; which register the machine kept the value in is no part of it, and the machine
        # not having noticed is the failure being proven rather than a verdict on it.
        "violated": spent + price * quantity > budget,
        "wrapped": tuple(sorted(set(wrapped))),
        "trapped": trapped,
        "claimResult": bool(
            accepted
            and spent + price * quantity > budget
            and claim_site(statement["claim"]) in wrapped
        ),
    }


# ---------------------------------------------------------------------------
# 5. what the run publishes
# ---------------------------------------------------------------------------


def seal_journal(statement: dict, run: dict) -> dict:
    _require_statement(statement)
    if not isinstance(run, dict) or set(run) != set(RUN_FIELDS):
        raise ValueError("a journal is sealed over a run this guest produced")
    if run["imageDigest"] != statement["imageDigest"]:
        # The run and the statement disagree about which program this is. Sealing anyway
        # produces a journal that is internally consistent and about two different things.
        raise ValueError("the run executed a program this statement does not name")
    return {
        # The commitment. Everything the statement says is inside this one field, which is why
        # the four below can be checked against a statement and the whole statement cannot.
        "statementDigest": _statement_digest(statement),
        "imageDigest": statement["imageDigest"],
        "claimResult": bool(run["claimResult"]),
        "guestVersion": statement["guestVersion"],
        # The only measurement, and it is one the reader could already compute from the public
        # image. That is the test a measurement has to pass, not "is it small".
        "measurements": {"steps": run["steps"]},
    }


# ---------------------------------------------------------------------------
# 6. offering it against something else
# ---------------------------------------------------------------------------


def accept_receipt(receipt: object, statement: object) -> bool:
    # Nothing in here raises. Every refusal below is an answer a verifier owes its caller, and a
    # verifier that throws at a malformed receipt has turned a decision into an exception whose
    # handling is no part of the proof system.
    if not isinstance(receipt, dict) or set(receipt) != set(RECEIPT_FIELDS):
        return False
    journal = receipt["journal"]
    if not isinstance(journal, dict) or set(journal) != set(JOURNAL_FIELDS):
        return False
    measurements = journal["measurements"]
    if not isinstance(measurements, dict) or not set(measurements) <= set(MEASUREMENT_NAMES):
        return False
    if not _is_statement(statement):
        return False
    # The binding, and the only line that refuses a receipt offered against another target, a
    # different claim, another integer semantics or another protocol version. All four are the
    # same refusal because all four are the same statement changing, which is what committing
    # to the whole statement buys and what committing to its interesting fields does not.
    if journal["statementDigest"] != _statement_digest(statement):
        return False
    # The journal's own fields, checked rather than read. They are a convenience for a reader
    # who has the journal and not the statement, and a field a reader trusts is a field an
    # attacker writes: the digest above is the evidence, and these two have to agree with it.
    if journal["imageDigest"] != statement["imageDigest"]:
        return False
    if journal["guestVersion"] != statement["guestVersion"]:
        return False
    # A receipt whose claim did not hold is a correct journal about a run that proves nothing,
    # and accepting it as evidence for the claim is the last way in.
    return journal["claimResult"] is True


# ---------------------------------------------------------------------------
# 7. what a run gave away
# ---------------------------------------------------------------------------


def _named(channel: str, values: dict):
    """Every `(channel, name, value)` a record puts in front of a reader.

    One level down as well as at the top, because a name nested inside an approved container is
    still a name that was published -- the journal's `measurements` is exactly that container,
    and so is any record that hands over a whole dict "for context".
    """
    for name, value in values.items():
        yield channel, name, value
        if isinstance(value, dict):
            yield from ((channel, inner, item) for inner, item in value.items())


def _disclosed(disclosure):
    yield from _named("journal", disclosure.journal)
    for channel in ("stdout", "stderr", "trace", "temp"):
        for entry in getattr(disclosure, channel):
            yield from _named(channel, entry["values"])
    if disclosure.error is not None:
        yield from _named("error", disclosure.error["values"])


def leak_report(disclosure, statement: dict, image: dict) -> tuple[tuple[str, str], ...]:
    _require_statement(statement)
    steps = len(decode_program(image["body"]))
    out = set()
    for channel, name, value in _disclosed(disclosure):
        if name not in PUBLIC_NAMES:
            out.add((channel, name))
        elif name in PARAM_NAMES and value != statement["params"][name]:
            # An approved label is not an approval. `spent` may be published; the machine's own
            # total wearing the name `spent` is a different disclosure, and the price is public
            # and invertible, so it is the quantity with one step of arithmetic left to do.
            out.add((channel, name))
        elif name in MEASUREMENT_NAMES and value != steps:
            # A measurement is safe when a reader could already compute it. One that varies with
            # the witness is not a measurement, it is the witness at lower resolution.
            out.add((channel, name))
    return tuple(sorted(out))
