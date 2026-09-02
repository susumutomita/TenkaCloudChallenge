"""Hidden tests. Run by /verify against a copy of the learner's guest.py.

Eight phases, graded separately, because a guest can be right about the arithmetic and wrong
about what the arithmetic is a proof of. The cryptography is out of scope here on purpose:
every phase below is about the two halves a proof system does **not** prove anything about --
the statement a receipt is offered against, and the journal it publishes.

Four of the phases exist because of a guest that would otherwise pass:

  * **encoding** (`check_encoding`). Two real accounts whose statements are the same bytes
    under a length-free encoder. Both have real exploits, so the failure is not that a
    malformed statement slips through -- it is that a *valid* proof about one is a valid proof
    about the other. The phase also offers the same statement with its keys inserted in the
    other order, because two dicts that compare equal are one statement.
  * **reexec** (`check_reexec`). The host's own account of the run is in `env.hints()`, and it
    is confident, detailed and wrong. A guest that takes the hint is fast, is right almost
    always, and proves nothing at all. The phase also runs the same image under a saturating
    and a checked profile, where the claim has no witness -- a guest with one overflow
    behaviour written into it answers about a machine nobody named.
  * **replay** (`check_replay`). Receipts re-offered against something one field away from
    what sealed them, and receipts nobody replayed whose journal was edited afterwards. A
    journal field a verifier *reads* is a journal field an attacker *writes*.
  * **privacy** (`check_privacy`). Ten runs of the same claim, two of which disclose nothing.
    One of the two fills every channel with numbers. Reporting a leak against either is
    exactly as wrong as missing one against the other eight.

Every phase computes its own expected answer from the fixtures. Nothing is graded by asking the
submission a second question and checking that its two answers agree: the runs the journal
phase seals are built here, the receipts the replay phase offers are sealed here, and the `Env`
the re-execution phase reads is loaded here. A guest that is wrong the same way twice would
pass that, and being wrong consistently is the failure mode this whole problem is about.

The one thing that does come back out of the submission is its **encoding**, and it comes back
on purpose. `journal` and `replay` are about whether a receipt binds to its own statement and
to nothing else, so both of them commit through `module.encode_statement`. A guest whose
encoder merges two accounts is therefore handed a receipt that really does verify against both
of them -- which is the failure itself rather than a second report of the encoder's.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from fixtures.generate import (  # noqa: E402
    BYTE_ORDER,
    DIGEST_HEX_LENGTH,
    GUARDS,
    IMAGE_COMMITMENT_DOMAIN,
    INTEGER_BYTES,
    JOURNAL_FIELDS,
    LENGTH_PREFIX_BYTES,
    MEASUREMENT_NAMES,
    PARAM_NAMES,
    PUBLIC_NAMES,
    RUN_FIELDS,
    SEMANTICS,
    STATEMENT_COMMITMENT_DOMAIN,
    STATEMENT_FIELDS,
    WRAP_SITE_OF,
    Env,
    claim_site,
    collision_pair,
    commit,
    corrupt_bodies,
    decode_program,
    disclosure_truth,
    disclosures,
    image,
    naive_collisions,
    replay_cases,
    replay_truth,
    scenario,
    shuffled,
    sibling_images,
    statement,
    statement_family,
)

#: Four draws, so a guest is never graded against one machine. The width, the account, the
#: guard the image ends with and the protocol version all move with the label.
LABELS = ("h0", "h1", "h2", "h3")


# ---------------------------------------------------------------------------
# the models the checker grades against
# ---------------------------------------------------------------------------


def _frame(payload: bytes) -> bytes:
    return len(payload).to_bytes(LENGTH_PREFIX_BYTES, BYTE_ORDER) + payload


def _text(value: str) -> bytes:
    return _frame(value.encode("utf-8"))


def _integer(value: int) -> bytes:
    return _frame(value.to_bytes(INTEGER_BYTES, BYTE_ORDER))


def _encode(record: dict) -> bytes:
    """The canonical encoding, as the checker holds it. Recomputed from the constants."""
    account = record["params"]
    params = _frame(b"".join(_text(name) + _integer(account[name]) for name in PARAM_NAMES))
    return b"".join(
        params if field == "params" else _text(record[field]) for field in STATEMENT_FIELDS
    )


def _digest(record: dict) -> str:
    return commit(_encode(record), STATEMENT_COMMITMENT_DOMAIN)


def _run(built: dict, record: dict, private: dict) -> dict:
    """One run of the image the statement names, on the machine the statement names."""
    profile = SEMANTICS[record["semantics"]]
    price, spent, budget = (record["params"][name] for name in PARAM_NAMES)
    modulus, maximum, overflow = profile["modulus"], profile["max"], profile["overflow"]
    quantity = private["quantity"]

    accumulator, steps, accepted, trapped = 0, 0, False, False
    wrapped: list[str] = []
    for step in decode_program(built["body"]):
        if step == "load-quantity":
            accumulator = quantity
        elif step in GUARDS:
            accepted = accumulator <= budget if step == "guard-le" else accumulator < budget
        else:
            exact = accumulator * price if step == "mul-price" else accumulator + spent
            if exact > maximum:
                if overflow == "checked":
                    trapped = True
                    break
                if overflow == "wrapping":
                    wrapped.append(WRAP_SITE_OF[step])
                    exact %= modulus
                else:
                    exact = maximum
            accumulator = exact
        steps += 1

    violated = spent + price * quantity > budget
    return {
        "imageDigest": commit(bytes(built["body"]), IMAGE_COMMITMENT_DOMAIN),
        "steps": steps,
        "accepted": accepted,
        "violated": violated,
        "wrapped": tuple(sorted(set(wrapped))),
        "trapped": trapped,
        "claimResult": bool(accepted and violated and claim_site(record["claim"]) in wrapped),
    }


def _journal(module, record: dict, run: dict) -> dict:
    """The journal a correct seal produces for that run of that statement.

    The commitment goes through the submission's own `encode_statement` rather than through
    `_encode` above, and the difference matters in exactly one place. A receipt is evidence for
    the statement it was sealed under, and *which statement is that* is the question the
    submission answers -- so a guest whose encoder cannot separate two accounts is handed a
    receipt that genuinely does verify against both of them. It then fails the replay row that
    offers the colliding pair against each other, which is the failure itself rather than a
    second report of what the encoding phase already said.
    """
    return {
        "statementDigest": commit(
            module.encode_statement(dict(record)), STATEMENT_COMMITMENT_DOMAIN
        ),
        "imageDigest": record["imageDigest"],
        "claimResult": bool(run["claimResult"]),
        "guestVersion": record["guestVersion"],
        "measurements": {"steps": run["steps"]},
    }


def _leaks(named, statement_record: dict, steps: int) -> set:
    """The policy, applied to `(channel, name, value)` triples. Used by two phases."""
    out = set()
    for channel, name, value in named:
        if name not in PUBLIC_NAMES:
            out.add((channel, name))
        elif name in PARAM_NAMES and value != statement_record["params"][name]:
            out.add((channel, name))
        elif name in MEASUREMENT_NAMES and value != steps:
            out.add((channel, name))
    return out


# ---------------------------------------------------------------------------
# shared helpers
# ---------------------------------------------------------------------------


class _Raised(str):
    """A call that raised, carrying the failure line. Its own type, not a bare `str`.

    Two of the functions graded here return a string themselves -- `image_digest` returns a
    digest -- so "the answer came back as text" cannot be what marks a failure. A sentinel that
    a real answer can impersonate turns every correct submission into a failing one.
    """


def _attempt(call, what: str):
    """Call the submission where a raise is a failure rather than a refusal."""
    try:
        return call()
    except Exception as error:  # noqa: BLE001
        return _Raised(f"{what} raised {type(error).__name__}")


def _refuses(call, what: str) -> list[str]:
    """Call the submission where `ValueError` is the only right answer.

    Any other exception is not a refusal -- it is the arithmetic or the serializer falling over
    on an operand nobody checked. A guest that hands a string to `int.to_bytes` and lets the
    `AttributeError` out has not refused a statement, it has been lucky about which malformed
    one arrived.
    """
    try:
        call()
    except ValueError:
        return []
    except Exception as error:  # noqa: BLE001
        return [f"crashed with {type(error).__name__} on {what} rather than refusing it"]
    return [f"accepted {what}"]


def _decides(call, what: str):
    """Call a verifier that is not allowed to raise. Returns a bool, or a failure string."""
    try:
        return bool(call())
    except Exception as error:  # noqa: BLE001
        return _Raised(
            f"accept_receipt raised {type(error).__name__} on {what}; a receipt it cannot use "
            "is False, not an error"
        )


def _loaded(record: dict, private: dict, hints: dict) -> Env:
    """An `Env` as a correct host builds it, plus host advice that is confidently wrong."""
    env = Env()
    for field in STATEMENT_FIELDS:
        env.public(field, record[field])
    env.write_private(private)
    for name, value in hints.items():
        env.hint(name, value)
    return env


def _misleading(run: dict) -> dict:
    """What the host says this run produced. Every field of it is wrong."""
    return {
        "imageDigest": "0" * DIGEST_HEX_LENGTH,
        "steps": run["steps"] + 7,
        "accepted": not run["accepted"],
        "violated": not run["violated"],
        "wrapped": tuple(site for site in WRAP_SITE_OF.values() if site not in run["wrapped"]),
        "trapped": not run["trapped"],
        "claimResult": not run["claimResult"],
    }


def _proving(seed: str, label: str, site: str = "mul") -> tuple[dict, dict, dict]:
    """`(image, statement, witness)` where the witness proves the statement's claim."""
    built = scenario(seed, label, site=site)
    return built["image"], built["statement"], built["witness"]


def _profiled(seed: str, label: str, overflow: str) -> tuple[dict, dict, dict]:
    """The same account and the same image, on a machine that does not wrap.

    The width is unchanged, so the account is still one this machine could hold and the witness
    is still in its domain: what changed is what the hardware does when a result does not fit,
    and on both of these the claim has no witness at all. A guest that refuses these because
    the numbers stopped making sense has refused the wrong thing.
    """
    built, record, private = _proving(seed, label)
    width = SEMANTICS[record["semantics"]]["width"]
    return built, {**record, "semantics": f"u{width}-{overflow}"}, private


def _not_statements(record: dict) -> tuple[tuple[object, str], ...]:
    """Records that are not statements, on every field a statement has."""
    profile = SEMANTICS[record["semantics"]]
    params = record["params"]
    hex_digest = record["imageDigest"]

    def swap(**overrides) -> dict:
        return {**record, "params": {**params, **overrides}}

    return (
        (7, "a statement that is not a record"),
        ({field: record[field] for field in STATEMENT_FIELDS[1:]}, "a statement with no domain"),
        ({**record, "note": "for the logs"}, "a statement carrying a field nobody agreed to"),
        (
            {**record, "domain": "tenkacloud.zkvm.exploit-claim.v9"},
            "a claim made in a protocol this build does not have",
        ),
        (
            {**record, "guestVersion": "guest-9.9.9"},
            "a claim decided by a guest build this file has never seen",
        ),
        (
            {**record, "semantics": f"u{profile['width']}-truncating"},
            "an integer semantics whose arithmetic nobody here can perform",
        ),
        (
            {**record, "claim": "budget-exceeded@shift"},
            "a claim naming a wrap site this program does not have",
        ),
        ({**record, "imageDigest": hex_digest[:-1]}, "an image digest one character short"),
        ({**record, "imageDigest": hex_digest[:-1] + "g"}, "an image digest that is not hex"),
        ({**record, "imageDigest": 7}, "an image digest that is not a string"),
        (swap(price=0), "an account whose unit price is zero"),
        (swap(price=profile["max"] + 1), "a price this machine could not hold"),
        (swap(spent=params["budget"]), "an account already at its ceiling"),
        (swap(budget=profile["max"] + 1), "a budget past the machine's largest value"),
        (swap(price=True), "a boolean where the unit price belongs"),
        (swap(units=2), "an account carrying a parameter this target does not have"),
        ({**record, "params": 3}, "an account that is not an account"),
    )


def _not_witnesses(profile: dict) -> tuple[tuple[object, str], ...]:
    """Witnesses for a machine other than this one, in every shape one can arrive in."""
    good = {"quantity": 1, "aux": {"machineCost": 1, "machineTotal": 1}, "search": (1,)}
    return (
        ({**good, "quantity": -1}, "a quantity below the machine's domain"),
        ({**good, "quantity": profile["max"] + 1}, "a quantity past the machine's largest value"),
        ({**good, "quantity": profile["modulus"]}, "a quantity exactly one modulus wide"),
        ({**good, "quantity": True}, "a boolean where the quantity belongs"),
        ({**good, "quantity": "1"}, "a quantity that is not an integer"),
        (
            {**good, "aux": {"machineCost": profile["modulus"], "machineTotal": 1}},
            "an auxiliary value this machine could not have held",
        ),
        ({**good, "aux": {"machineCost": 1}}, "an auxiliary record missing the machine's total"),
        ({**good, "search": (1, profile["max"] + 1)}, "a search trail leaving the machine"),
        ({**good, "search": 3}, "a search trail that is not a trail"),
        ({"quantity": 1}, "a witness with no auxiliary values and no trail"),
        ({**good, "seed": 4}, "a witness carrying a field this machine has no register for"),
        (7, "a witness that is not a witness"),
    )


# ---------------------------------------------------------------------------
# 1. the canonical statement encoding
# ---------------------------------------------------------------------------


def _encoding_failures(module, seed: str, label: str) -> list[str]:
    family = statement_family(seed, label)
    collisions = naive_collisions(seed, label)
    if len({_digest(member) for member in family}) != len(family):
        return [f"the statement family at {label} no longer holds distinct statements"]
    if not collisions:
        return [f"the family at {label} no longer contains a pair a length-free encoder collides"]

    failures: list[str] = []
    produced: dict[bytes, dict] = {}
    for member in family:
        got = _attempt(lambda m=member: module.encode_statement(dict(m)), "encode_statement")
        if isinstance(got, _Raised):
            failures.append(got)
            continue
        if not isinstance(got, (bytes, bytearray)):
            failures.append("encode_statement did not return bytes")
            continue
        raw = bytes(got)
        want = _encode(member)
        if raw in produced and produced[raw] != member:
            # The headline. Both members are real accounts with real exploits, so this is not a
            # malformed statement slipping through -- it is a valid proof about one being a
            # valid proof about the other, with nothing in the cryptography broken.
            failures.append(
                "encode_statement gave two different statements the same bytes; a proof about "
                "one of them is then a proof about the other"
            )
        produced[raw] = member
        if raw != want:
            failures.append(
                "encode_statement's output is not the canonical encoding: every field framed "
                "with its own length, integers at a fixed width, fields in STATEMENT_FIELDS order"
            )

    base = family[0]
    reordered = _attempt(
        lambda: module.encode_statement(shuffled(base)), "encode_statement"
    )
    straight = _attempt(lambda: module.encode_statement(dict(base)), "encode_statement")
    if isinstance(reordered, _Raised):
        failures.append(reordered)
    elif not isinstance(straight, _Raised) and bytes(reordered) != bytes(straight):
        # Two dicts that compare equal are the same statement, so they have to be the same
        # bytes. An encoder that walks the caller's dict has taken the field order from
        # whoever built it rather than from the protocol.
        failures.append(
            "encode_statement is not canonical: the same statement with its keys inserted in "
            "another order encoded differently"
        )

    for malformed, what in _not_statements(base):
        failures.extend(
            _refuses(lambda m=malformed: module.encode_statement(m), what)
        )
    return failures


def check_encoding(module, seed: str) -> list[str]:
    failures: list[str] = []
    for label in LABELS:
        failures.extend(_encoding_failures(module, seed, label))
    return failures


# ---------------------------------------------------------------------------
# 2. which program the claim is about
# ---------------------------------------------------------------------------


def _identity_failures(module, seed: str, label: str) -> list[str]:
    base = image(seed, label)
    siblings = sibling_images(seed, label)
    want = commit(bytes(base["body"]), IMAGE_COMMITMENT_DOMAIN)

    #: Which of the four are the same program as the base image, and which are not.
    same = {"renamed": True, "relabelled": True, "rebuilt": False, "restamped": False}
    explained = {
        "rebuilt": "a rebuild with one comparison changed is a different program, and the two "
        "disagree about every order whose total lands exactly on the budget",
        "restamped": "a rebuild is a different image even when nothing observable changed; "
        "'nothing observable changed' is the claim under audit rather than an input to it",
        "renamed": "the same bytes under another path are the same program",
        "relabelled": "the same bytes under another image's id are the same program",
    }

    failures: list[str] = []
    got = _attempt(lambda: module.image_digest(dict(base)), "image_digest")
    if isinstance(got, _Raised):
        return [got]
    if got != want:
        failures.append(
            "image_digest is not a commitment to the image body under IMAGE_COMMITMENT_DOMAIN"
        )
    again = _attempt(lambda: module.image_digest(dict(base)), "image_digest")
    if isinstance(again, _Raised) or again != got:
        failures.append("image_digest is not deterministic")

    for name, sibling in siblings.items():
        answered = _attempt(lambda s=sibling: module.image_digest(dict(s)), "image_digest")
        if isinstance(answered, _Raised):
            failures.append(answered)
            continue
        if (answered == got) is not same[name]:
            failures.append(
                f"image_digest calls the {name} image "
                + ("a different program" if same[name] else "the base image")
                + f"; {explained[name]}"
            )

    for body, what in corrupt_bodies(seed, label):
        failures.extend(
            _refuses(lambda b=body: module.image_digest({**base, "body": b}), what)
        )
    failures.extend(
        _refuses(
            lambda: module.image_digest({"sourcePath": base["sourcePath"]}),
            "an image record with no body in it",
        )
    )
    failures.extend(_refuses(lambda: module.image_digest(7), "an image that is not a record"))
    return failures


def check_identity(module, seed: str) -> list[str]:
    failures: list[str] = []
    for label in LABELS:
        failures.extend(_identity_failures(module, seed, label))
    return failures


# ---------------------------------------------------------------------------
# 3. handing the guest its inputs
# ---------------------------------------------------------------------------


def _ingestion_failures(module, seed: str, label: str) -> list[str]:
    built, record, private = _proving(seed, label)
    profile = SEMANTICS[record["semantics"]]
    steps = len(decode_program(built["body"]))

    failures: list[str] = []
    env = Env()
    outcome = _attempt(
        lambda: module.guest_input(env, dict(record), dict(private)), "guest_input"
    )
    if isinstance(outcome, _Raised):
        return [outcome]

    public = env.public_inputs()
    if set(public) != set(STATEMENT_FIELDS):
        missing = sorted(set(STATEMENT_FIELDS) - set(public))
        extra = sorted(set(public) - set(STATEMENT_FIELDS))
        failures.append(
            f"guest_input published {sorted(public)}; a verifier reading that is holding a "
            f"claim it cannot reconstruct" + (f" (missing {missing})" if missing else "")
            + (f" and a public input nobody agreed to ({extra})" if extra else "")
        )
    elif any(public[field] != record[field] for field in STATEMENT_FIELDS):
        failures.append("guest_input published a public input the statement does not carry")

    if env.writes() != 1:
        failures.append(
            "guest_input did not write the witness to the private channel exactly once"
            if env.writes() == 0
            else "guest_input wrote to the private channel more than once"
        )
    else:
        delivered = _attempt(env.read_private, "the private channel")
        if isinstance(delivered, _Raised):
            failures.append(delivered)
        elif delivered != private:
            failures.append(
                "the private channel does not carry the witness the guest was handed"
            )

    transcript = env.transcript()
    named = []
    for channel, values in (
        ("public", transcript["public"]),
        ("variables", transcript["variables"]),
    ):
        for name, value in values.items():
            named.append((channel, name, value))
            if isinstance(value, dict):
                named.extend((channel, inner, item) for inner, item in value.items())
    for note in transcript["notes"]:
        for name, value in note["values"].items():
            named.append(("notes", name, value))
            if isinstance(value, dict):
                named.extend(("notes", inner, item) for inner, item in value.items())
    for channel, name in sorted(_leaks(named, record, steps)):
        # The transcript is what an operator's log aggregator keeps for ninety days. A witness
        # in it is a witness published, whichever door it was handed to.
        failures.append(
            f"guest_input put {name!r} into the run's {channel}, which the private channel is "
            "the whole reason for"
        )

    for malformed, what in _not_statements(record):
        failures.extend(
            _refuses(lambda m=malformed: module.guest_input(Env(), m, dict(private)), what)
        )
    for malformed, what in _not_witnesses(profile):
        failures.extend(
            _refuses(lambda w=malformed: module.guest_input(Env(), dict(record), w), what)
        )
    return failures


def check_ingestion(module, seed: str) -> list[str]:
    failures: list[str] = []
    for label in LABELS:
        failures.extend(_ingestion_failures(module, seed, label))
    return failures


# ---------------------------------------------------------------------------
# 4. running the program the statement names
# ---------------------------------------------------------------------------


def _one_run(module, built: dict, record: dict, private: dict, what: str) -> list[str]:
    want = _run(built, record, private)
    env = _loaded(record, private, _misleading(want))
    got = _attempt(lambda: module.run_guest(dict(built), env), "run_guest")
    if isinstance(got, _Raised):
        return [got]
    if not isinstance(got, dict):
        return ["run_guest did not return a dict"]
    if set(got) != set(RUN_FIELDS):
        return [f"run_guest reported {sorted(got)}; not a run's field set"]

    failures: list[str] = []
    hinted = _misleading(want)
    for field in RUN_FIELDS:
        mine, theirs = want[field], got[field]
        if field in ("accepted", "violated", "trapped", "claimResult"):
            theirs = bool(theirs)
        if field == "wrapped":
            theirs = tuple(theirs) if isinstance(theirs, (list, tuple)) else theirs
        if theirs == mine:
            continue
        if theirs == hinted[field]:
            # The host is the party being proved about. Its account of the run reaches the
            # guest and is not evidence of anything, which is the whole reason `hints` is a
            # separate door from `public`.
            failures.append(
                f"run_guest took the host's hint for {field!r} on {what} rather than "
                "recomputing it"
            )
        elif field == "violated":
            failures.append(
                "run_guest read the security property off the machine's own total on "
                f"{what}; the property is about value, and the machine not having noticed "
                "is the failure being proven"
            )
        elif field == "wrapped":
            # Issue 630: participant-visible now -- echo their sites, never the run's
            # actual wrap set.
            failures.append(
                f"run_guest says {list(theirs) if isinstance(theirs, tuple) else theirs} "
                f"wrapped on {what}, and that is not what that run wraps"
            )
        else:
            failures.append(f"run_guest's {field} is wrong on {what}")
    return failures


def _refused_wrap(built: dict, record: dict, bare) -> dict | None:
    """A quantity that wraps the site the claim names and is then refused by the guard.

    The claim has three conjuncts and this is the only run that separates the second one: the
    named site really did wrap, the property really was violated, and nothing was delivered --
    so there is no effect for a proof to be about.
    """
    site = claim_site(record["claim"])
    for quantity in range(SEMANTICS[record["semantics"]]["max"] + 1):
        run = _run(built, record, bare(quantity))
        if site in run["wrapped"] and run["violated"] and not run["accepted"]:
            return bare(quantity)
    return None


def _reexec_failures(module, seed: str, label: str) -> list[str]:
    built, record, private = _proving(seed, label)
    other = sibling_images(seed, label)["rebuilt"]
    profile = SEMANTICS[record["semantics"]]
    add_image, add_record, add_witness = _proving(seed, label, site="add")

    def bare(quantity: int) -> dict:
        return {"quantity": quantity, "aux": {"machineCost": 0, "machineTotal": 0}, "search": ()}

    runs = [
        (built, record, private, "the exploit at the multiply"),
        (add_image, add_record, add_witness, "the exploit at the addition"),
        # The same witness under the other claim. Nothing about the run changes and the verdict
        # does, which is what it means for a claim to name a wrap site: a real failure at the
        # site this claim does not name is not evidence for this claim.
        (built, record, add_witness, "the addition's exploit, offered under the multiply's claim"),
        (built, record, bare(0), "an order of nothing"),
        (built, record, bare(1), "one unit, which every account can afford"),
        (built, record, bare(profile["max"]), "the largest quantity this machine can hold"),
        (
            built,
            record,
            # The last order the account can still afford, which is the one place a guard that
            # bounds an order by something other than the budget gives a different answer.
            bare(
                (record["params"]["budget"] - record["params"]["spent"])
                // record["params"]["price"]
            ),
            "the largest order the account can still afford",
        ),
    ]
    for overflow in ("saturating", "checked"):
        clamped_image, clamped, clamped_witness = _profiled(seed, label, overflow)
        runs.append(
            (clamped_image, clamped, clamped_witness, f"the same order on a {overflow} machine")
        )

    failures: list[str] = []
    refused = _refused_wrap(built, record, bare)
    if refused is None:
        failures.append(f"no order at {label} wraps the claimed site and is then refused")
    else:
        runs.append((built, record, refused, "a wrap the guard refused, so nothing was delivered"))
    if _run(built, record, add_witness)["wrapped"] != ("add",):
        failures.append(f"the addition's exploit at {label} no longer wraps the addition alone")

    for run_image, run_record, run_witness, what in runs:
        failures.extend(_one_run(module, run_image, run_record, run_witness, what))

    # The two runs this phase exists for, asserted of the fixtures before they are asked of the
    # submission: on a machine that clamps, and on one that traps, this claim has no witness.
    for overflow in ("saturating", "checked"):
        _, clamped, clamped_witness = _profiled(seed, label, overflow)
        truth = _run(built, clamped, clamped_witness)
        if truth["claimResult"] or truth["wrapped"]:
            failures.append(
                f"the {overflow} profile at {label} no longer makes this claim unwitnessable"
            )
    if not _run(built, record, private)["claimResult"]:
        failures.append(f"the fixtures' exploit at {label} is no longer an exploit")

    failures.extend(
        _refuses(
            lambda: module.run_guest(dict(other), _loaded(record, private, {})),
            "an image the statement does not name",
        )
    )
    for malformed, what in _not_witnesses(profile):
        env = Env()
        for field in STATEMENT_FIELDS:
            env.public(field, record[field])
        env.write_private(malformed)
        failures.extend(_refuses(lambda e=env: module.run_guest(dict(built), e), what))
    for malformed, what in _not_statements(record):
        env = Env()
        if isinstance(malformed, dict):
            for field, value in malformed.items():
                env.public(field, value)
        else:
            env.public("statement", malformed)
        env.write_private(private)
        failures.extend(_refuses(lambda e=env: module.run_guest(dict(built), e), what))
    return failures


def check_reexec(module, seed: str) -> list[str]:
    failures: list[str] = []
    for label in LABELS:
        failures.extend(_reexec_failures(module, seed, label))
    return failures


# ---------------------------------------------------------------------------
# 5. what the run publishes
# ---------------------------------------------------------------------------


def _journal_failures(module, seed: str, label: str) -> list[str]:
    built, record, private = _proving(seed, label)
    add_image, add_record, add_witness = _proving(seed, label, site="add")
    left, right = collision_pair(seed, label)
    family = statement_family(seed, label)

    def bare(quantity: int) -> dict:
        return {"quantity": quantity, "aux": {"machineCost": 0, "machineTotal": 0}, "search": ()}

    cases = [
        (built, record, private, "the exploit at the multiply"),
        (add_image, add_record, add_witness, "the exploit at the addition"),
        (built, record, bare(1), "an ordinary purchase, where the claim does not hold"),
    ]
    for overflow in ("saturating", "checked"):
        cases.append((*_profiled(seed, label, overflow), f"a run on a {overflow} machine"))

    failures: list[str] = []
    sealed: dict[str, dict] = {}
    for run_image, run_record, run_witness, what in cases:
        run = _run(run_image, run_record, run_witness)
        want = _attempt(lambda r=run_record, s=run: _journal(module, r, s), "encode_statement")
        if isinstance(want, _Raised):
            failures.append(f"{want} while the checker was sealing {what}")
            continue
        got = _attempt(
            lambda r=run_record, s=run: module.seal_journal(dict(r), dict(s)), "seal_journal"
        )
        if isinstance(got, _Raised):
            failures.append(got)
            continue
        if not isinstance(got, dict):
            failures.append("seal_journal did not return a dict")
            continue
        if set(got) != set(JOURNAL_FIELDS):
            failures.append(
                f"seal_journal published {sorted(got)}; not a journal's field set"
            )
            continue
        sealed[what] = got
        if got["statementDigest"] != want["statementDigest"]:
            # Measured against this guest's *own* encoding, so the line is about the seal and
            # not about the encoder. What it catches is a journal committed under the image's
            # commitment domain, or to the statement's repr, or to the fields it found
            # interesting -- all of which produce a digest that binds less than the statement.
            failures.append(
                "seal_journal's statementDigest is not this guest's own encoding of the "
                "statement, committed under STATEMENT_COMMITMENT_DOMAIN"
            )
        if got["imageDigest"] != want["imageDigest"]:
            failures.append("seal_journal's imageDigest is not the one the statement names")
        if got["guestVersion"] != want["guestVersion"]:
            failures.append("seal_journal's guestVersion is not the one the statement names")
        if bool(got["claimResult"]) is not want["claimResult"]:
            failures.append(f"seal_journal's claimResult is wrong for {what}")
        measurements = got["measurements"]
        if not isinstance(measurements, dict) or set(measurements) != set(MEASUREMENT_NAMES):
            failures.append(
                "seal_journal's measurements are not exactly the expected set; a measurement "
                "is safe when a reader could already compute it, and everything else is the "
                "witness at lower resolution"
            )
        elif measurements != want["measurements"]:
            failures.append("seal_journal's step count is not the one this run took")

    # Every member of the family is a statement somebody could legitimately make, and no two of
    # them are the same statement. Two journals sharing a digest have said a proof about one is
    # a proof about the other -- and `left`/`right` is the pair a length-free encoder merges.
    digests = {}
    steps = len(decode_program(built["body"]))
    for member in (*family, left, right):
        # A run record rather than a run: `seal_journal` is graded on what it commits to, and
        # every member naming its own image keeps the phase about the digest.
        run = {
            "imageDigest": member["imageDigest"],
            "steps": steps,
            "accepted": True,
            "violated": True,
            "wrapped": (claim_site(member["claim"]),),
            "trapped": False,
            "claimResult": True,
        }
        got = _attempt(
            lambda m=member, s=run: module.seal_journal(dict(m), dict(s)), "seal_journal"
        )
        if not isinstance(got, dict) or "statementDigest" not in got:
            continue
        key = got["statementDigest"]
        if key in digests and digests[key] != member:
            failures.append(
                "seal_journal sealed two different statements under the same digest; the "
                "journal is then a commitment to neither of them"
            )
        digests[key] = member

    run = _run(built, record, private)
    for malformed, what in _not_statements(record):
        failures.extend(
            _refuses(lambda m=malformed: module.seal_journal(m, dict(run)), what)
        )
    broken = (
        ({field: run[field] for field in RUN_FIELDS[1:]}, "a run with no image digest"),
        ({**run, "hint": True}, "a run carrying a field this guest does not report"),
        (
            {**run, "imageDigest": "0" * DIGEST_HEX_LENGTH},
            "a run that executed a program this statement does not name",
        ),
        (7, "a run that is not a run"),
    )
    for malformed, what in broken:
        failures.extend(
            _refuses(lambda m=malformed: module.seal_journal(dict(record), m), what)
        )
    return failures


def check_journal(module, seed: str) -> list[str]:
    failures: list[str] = []
    for label in LABELS:
        failures.extend(_journal_failures(module, seed, label))
    return failures


# ---------------------------------------------------------------------------
# 6. offering it against something else
# ---------------------------------------------------------------------------


def _offered(module, case: dict, steps: int) -> dict:
    """The receipt this case offers: sealed under one statement, then edited or trimmed.

    Sealed through the submission's own encoding, which is what makes the `other-params` row a
    test rather than a formality. The colliding pair is offered against itself there: a guest
    that separates the two accounts computes a different digest for the statement it is looking
    at and refuses, and a guest that does not is holding a receipt that really is evidence for
    an account nobody has touched.
    """
    journal = _journal(module, case["sealed"], {"claimResult": True, "steps": steps})
    journal.update(case["edit"])
    for field in case["drop"]:
        journal.pop(field, None)
    return {"journal": journal}


def _replay_failures(module, seed: str, label: str) -> list[str]:
    built = image(seed, label)
    steps = len(decode_program(built["body"]))
    truth = replay_truth(seed, label)
    if sum(1 for verdict in truth.values() if verdict) != 2:
        return [f"the replay table at {label} no longer holds exactly two honest receipts"]

    failures: list[str] = []
    for case in replay_cases(seed, label):
        want = truth[case["id"]]
        receipt = _attempt(lambda c=case: _offered(module, c, steps), "encode_statement")
        if isinstance(receipt, _Raised):
            failures.append(f"{receipt} while the checker was sealing the {case['id']} receipt")
            continue
        got = _decides(
            lambda r=receipt, s=case["offered"]: module.accept_receipt(r, dict(s)), case["id"]
        )
        if isinstance(got, _Raised):
            failures.append(got)
        elif got is not want:
            failures.append(
                f"accept_receipt refused the {case['id']} receipt, which was sealed under the "
                "statement it is offered against"
                if want
                else f"accept_receipt accepted the {case['id']} receipt, which is evidence for "
                "something other than the statement it was offered against"
            )

    record = statement(seed, label)
    honest = _attempt(
        lambda: _journal(module, record, {"claimResult": True, "steps": steps}),
        "encode_statement",
    )
    if isinstance(honest, _Raised):
        return [*failures, f"{honest} while the checker was sealing an honest receipt"]
    junk = (
        (None, dict(record), "a receipt that is not a receipt"),
        ({"journal": honest, "seal": "..."}, dict(record), "a receipt carrying an extra field"),
        ({"journal": 7}, dict(record), "a receipt whose journal is not a journal"),
        (
            {"journal": {**honest, "measurements": {"quantity": 3}}},
            dict(record),
            "a journal measuring something the public image does not imply",
        ),
        (
            {"journal": {**honest, "measurements": 3}},
            dict(record),
            "a journal whose measurements are not measurements",
        ),
        ({"journal": honest}, 7, "a statement that is not a statement"),
        ({"journal": honest}, {**record, "params": 3}, "a statement with no account in it"),
    )
    for receipt, offered, what in junk:
        got = _decides(lambda r=receipt, s=offered: module.accept_receipt(r, s), what)
        if isinstance(got, _Raised):
            failures.append(got)
        elif got:
            failures.append(f"accept_receipt accepted {what}")
    return failures


def check_replay(module, seed: str) -> list[str]:
    failures: list[str] = []
    for label in LABELS:
        failures.extend(_replay_failures(module, seed, label))
    return failures


# ---------------------------------------------------------------------------
# 7. what a run gave away
# ---------------------------------------------------------------------------


def _privacy_failures(module, seed: str, label: str) -> list[str]:
    built = scenario(seed, label)
    record, image_record = built["statement"], built["image"]
    truth = disclosure_truth(seed, label)
    clean = [name for name, leaks in truth.items() if not leaks]
    if len(clean) != 2:
        # Two of the ten are spotless, and one of those two is loud. An audit graded only on
        # runs that leak learns to answer "yes" and is right nine times out of ten.
        return [f"the disclosures at {label} no longer hold exactly two clean runs"]

    failures: list[str] = []
    for entry in disclosures(seed, label):
        want = truth[entry["id"]]
        got = _attempt(
            lambda d=entry["disclosure"]: module.leak_report(d, dict(record), dict(image_record)),
            "leak_report",
        )
        if isinstance(got, _Raised):
            failures.append(got)
            continue
        if not isinstance(got, (list, tuple)) or any(
            not isinstance(pair, (list, tuple)) or len(pair) != 2 for pair in got
        ):
            failures.append("leak_report did not return (channel, name) pairs")
            continue
        reported = tuple(tuple(pair) for pair in got)
        if reported == want:
            continue
        if sorted(set(reported)) != sorted(reported):
            failures.append("leak_report reported the same disclosure more than once")
            continue
        if tuple(sorted(reported)) != tuple(reported):
            failures.append("leak_report reported its findings out of order")
            continue
        missed = sorted(set(want) - set(reported))
        invented = sorted(set(reported) - set(want))
        if missed:
            # Issue 630: participant-visible now -- the missed name is the checkpoint's
            # answer, so only the channel is reported.
            failures.append(
                f"leak_report missed a disclosed name on the {missed[0][0]} channel of one run"
            )
        if invented:
            failures.append(
                f"leak_report called {invented[0][1]!r} on the {invented[0][0]} channel a leak; "
                "an audit that always finds something has not read anything"
            )
    return failures


def check_privacy(module, seed: str) -> list[str]:
    failures: list[str] = []
    for label in LABELS:
        failures.extend(_privacy_failures(module, seed, label))
    return failures


# ---------------------------------------------------------------------------
# 8. a target, a claim and a protocol version nothing above has seen
# ---------------------------------------------------------------------------


def check_transfer(module, seed: str) -> list[str]:
    # A derived seed, so the width, the account, the guard the image ends with, the protocol
    # namespace and the guest build are none of the ones the seven phases above ran on. A guest
    # with this machine's modulus or this build's version string written into it clears every
    # checkpoint until this one.
    transferred = f"{seed}:transfer"
    return [
        *check_encoding(module, transferred),
        *check_identity(module, transferred),
        *check_ingestion(module, transferred),
        *check_reexec(module, transferred),
        *check_journal(module, transferred),
        *check_replay(module, transferred),
        *check_privacy(module, transferred),
    ]


PHASES = (
    check_encoding,
    check_identity,
    check_ingestion,
    check_reexec,
    check_journal,
    check_replay,
    check_privacy,
    check_transfer,
)


def run(module, seed: str) -> list[str]:
    failures: list[str] = []
    for phase in PHASES:
        failures.extend(phase(module, seed))
    return failures
