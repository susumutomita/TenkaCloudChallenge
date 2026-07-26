"""Mutation suite: break the reference on purpose, assert the hidden tests notice.

It also measures the thing this problem is about. Every mutation is run twice: once through the
hidden checker, and once through a **weak probe** that asks the two questions anybody writing a
test for a guest contract asks first -- *does the happy path produce a receipt that verifies,
and is a receipt offered against a different program refused?* Both are stated outright in the
problem text, and both are one call away from fixtures the learner was handed. The count of
mutations the weak probe cannot see is printed on every run and both READMEs quote it. If a
later edit makes the checkpoints cheaper, that number moves and the claim moves with it.

Every replacement below is asserted to have changed the reference text. A mutation whose anchor
has drifted out of the reference would otherwise be reported as killed while testing nothing.
"""

from __future__ import annotations

import sys
import types
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from fixtures.generate import (  # noqa: E402
    IMAGE_COMMITMENT_DOMAIN,
    Env,
    STATEMENT_FIELDS,
    commit,
    scenario,
    sibling_images,
)
from tests.hidden.check_guest import LABELS, run  # noqa: E402

SEED = "mutation-suite-seed"
REFERENCE = (Path(__file__).resolve().parent / "reference" / "guest.py").read_text("utf-8")

_FRAME = """    return len(payload).to_bytes(LENGTH_PREFIX_BYTES, BYTE_ORDER) + payload
"""

_INTEGER = """    return _frame(value.to_bytes(INTEGER_BYTES, BYTE_ORDER))
"""

_PARAMS_BLOCK = """    return _frame(b"".join(_text(name) + _integer(params[name]) for name in PARAM_NAMES))
"""

_ENCODE_FIELDS = """    return b"".join(
        _params_block(statement["params"]) if field == "params" else _text(statement[field])
        for field in STATEMENT_FIELDS
    )
"""

_ENCODE_GUARD = """def encode_statement(statement: dict) -> bytes:
    _require_statement(statement)
"""

_DOMAIN_CHECK = """    if record["domain"] not in DOMAINS or record["guestVersion"] not in GUEST_VERSIONS:
        return False
"""

_SEMANTICS_CHECK = """    if record["semantics"] not in SEMANTICS or record["claim"] not in CLAIMS:
        return False
"""

_HEX_CHECK = """    if any(character not in _HEX for character in digest):
        return False
"""

_PARAM_BOUNDS = """    return 0 < price <= profile["max"] and 0 <= spent < budget <= profile["max"]
"""

_IMAGE_BODY = """    decode_program(image["body"])
"""

_IMAGE_COMMIT = """    return commit(bytes(image["body"]), IMAGE_COMMITMENT_DOMAIN)
"""

_INGEST_PUBLIC = """    for field in STATEMENT_FIELDS:
        env.public(field, statement[field])
"""

_INGEST_PRIVATE = """    env.write_private(witness)
"""

_INGEST_GUARD = """    if not is_well_formed(witness, profile):
        raise ValueError("the witness is not one this machine could have taken")
"""

_RUN_FAIL_CLOSED = """    if digest != statement["imageDigest"]:
        # Fail closed, before a single step runs. Executing the wrong program and reporting
        # which one afterwards is a run somebody can quote out of context.
        raise ValueError("the image handed over is not the one this statement names")
"""

_RUN_WITNESS_GUARD = """    if not is_well_formed(witness, profile):
        raise ValueError("the private channel does not carry a witness for this machine")
"""

_RUN_PROFILE = """    modulus, maximum, overflow = profile["modulus"], profile["max"], profile["overflow"]
"""

_RUN_OVERFLOW = """            if exact > maximum:
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
"""

_RUN_CLAIM = """        "claimResult": bool(
            accepted
            and spent + price * quantity > budget
            and claim_site(statement["claim"]) in wrapped
        ),
"""

_SEAL_DIGEST = """        "statementDigest": _statement_digest(statement),
"""

_SEAL_IMAGE_GUARD = """    if run["imageDigest"] != statement["imageDigest"]:
        # The run and the statement disagree about which program this is. Sealing anyway
        # produces a journal that is internally consistent and about two different things.
        raise ValueError("the run executed a program this statement does not name")
"""

_SEAL_RUN_GUARD = """    if not isinstance(run, dict) or set(run) != set(RUN_FIELDS):
        raise ValueError("a journal is sealed over a run this guest produced")
"""

_ACCEPT_RECEIPT_SHAPE = """    if not isinstance(receipt, dict) or set(receipt) != set(RECEIPT_FIELDS):
        return False
"""

_ACCEPT_JOURNAL_SHAPE = """    if not isinstance(journal, dict) or set(journal) != set(JOURNAL_FIELDS):
        return False
"""

_ACCEPT_MEASUREMENTS = """    measurements = journal["measurements"]
    if not isinstance(measurements, dict) or not set(measurements) <= set(MEASUREMENT_NAMES):
        return False
"""

_ACCEPT_STATEMENT = """    if not _is_statement(statement):
        return False
"""

_ACCEPT_BINDING = """    if journal["statementDigest"] != _statement_digest(statement):
        return False
"""

_ACCEPT_CONVENIENCE = """    if journal["imageDigest"] != statement["imageDigest"]:
        return False
    if journal["guestVersion"] != statement["guestVersion"]:
        return False
"""

_LEAK_NESTED = """    for name, value in values.items():
        yield channel, name, value
        if isinstance(value, dict):
            yield from ((channel, inner, item) for inner, item in value.items())
"""

_LEAK_CHANNELS = """    for channel in ("stdout", "stderr", "trace", "temp"):
        for entry in getattr(disclosure, channel):
            yield from _named(channel, entry["values"])
"""

_LEAK_ERROR = """    if disclosure.error is not None:
        yield from _named("error", disclosure.error["values"])
"""

_LEAK_NAME_RULE = """        if name not in PUBLIC_NAMES:
            out.add((channel, name))
"""

_LEAK_PARAM_RULE = """        elif name in PARAM_NAMES and value != statement["params"][name]:
            # An approved label is not an approval. `spent` may be published; the machine's own
            # total wearing the name `spent` is a different disclosure, and the price is public
            # and invertible, so it is the quantity with one step of arithmetic left to do.
            out.add((channel, name))
"""

_LEAK_MEASUREMENT_RULE = """        elif name in MEASUREMENT_NAMES and value != steps:
            # A measurement is safe when a reader could already compute it. One that varies with
            # the witness is not a measurement, it is the witness at lower resolution.
            out.add((channel, name))
"""

_LEAK_SORT = """    return tuple(sorted(out))
"""


def _mutations() -> list[tuple[str, str]]:
    return [
        # -- the canonical statement encoding --------------------------------
        (
            "the encoding has no length prefixes",
            REFERENCE.replace(_FRAME, "    return payload\n"),
        ),
        (
            # The one that collides rather than merely failing to be canonical. Fixed-width
            # integers keep two accounts apart even with the frames taken off; rendering them
            # the way a human would read them does not, and this is the mutation that carries
            # the encoding failure all the way through to a receipt the replay phase accepts
            # for an account nobody has touched.
            "the encoding is every field run together, the way it reads best",
            REFERENCE.replace(
                _ENCODE_FIELDS,
                "    out = []\n"
                "    for field in STATEMENT_FIELDS:\n"
                "        value = statement[field]\n"
                '        if field == "params":\n'
                '            out.extend(str(value[name]).encode("utf-8") for name in PARAM_NAMES)\n'
                "        else:\n"
                '            out.append(str(value).encode("utf-8"))\n'
                '    return b"".join(out)\n',
            ),
        ),
        (
            "an integer is emitted at whatever width it happens to need",
            REFERENCE.replace(
                _INTEGER,
                "    return _frame(value.to_bytes((value.bit_length() + 7) // 8 or 1, BYTE_ORDER))\n",
            ),
        ),
        (
            "the encoding emits its fields in the order the caller's dict was built in",
            REFERENCE.replace("        for field in STATEMENT_FIELDS\n", "        for field in statement\n"),
        ),
        (
            "the account is emitted without a frame of its own",
            REFERENCE.replace(
                _PARAMS_BLOCK,
                '    return b"".join(_text(name) + _integer(params[name]) for name in PARAM_NAMES)\n',
            ),
        ),
        (
            "the account is emitted as values with the names left out",
            REFERENCE.replace(
                _PARAMS_BLOCK,
                '    return _frame(b"".join(_integer(params[name]) for name in PARAM_NAMES))\n',
            ),
        ),
        (
            "the encoder emits only the fields that affect the computation",
            REFERENCE.replace(
                _ENCODE_FIELDS,
                '    return b"".join(\n'
                '        _params_block(statement["params"]) if field == "params" else _text(statement[field])\n'
                "        for field in STATEMENT_FIELDS[2:]\n"
                "    )\n",
            ),
        ),
        (
            "the encoder hands out a commitment to anything it is given",
            REFERENCE.replace(_ENCODE_GUARD, "def encode_statement(statement: dict) -> bytes:\n"),
        ),
        (
            "the statement commitment has no domain separator",
            REFERENCE.replace(
                '    return commit(encode_statement(record), STATEMENT_COMMITMENT_DOMAIN)',
                '    return commit(encode_statement(record), "")',
            ),
        ),
        # -- what counts as a statement at all -------------------------------
        (
            "a claim may be made in a protocol nobody implemented",
            REFERENCE.replace(_DOMAIN_CHECK, ""),
        ),
        (
            "a claim may be decided by a guest build this file has never seen",
            REFERENCE.replace(
                _DOMAIN_CHECK,
                '    if record["domain"] not in DOMAINS:\n        return False\n',
            ),
        ),
        (
            "a statement may name an integer semantics nobody here can perform",
            REFERENCE.replace(
                _SEMANTICS_CHECK,
                '    if record["semantics"] not in SEMANTICS:\n        return False\n',
            ),
        ),
        (
            "a statement may carry any string the right length as its image digest",
            REFERENCE.replace(_HEX_CHECK, ""),
        ),
        (
            "an account may be one this machine could never hold",
            REFERENCE.replace(_PARAM_BOUNDS, "    return True\n"),
        ),
        # -- which program the claim is about ---------------------------------
        (
            "a program is named by where the toolchain says it was built",
            REFERENCE.replace(
                _IMAGE_COMMIT,
                '    return commit(image["sourcePath"].encode("utf-8"), IMAGE_COMMITMENT_DOMAIN)\n',
            ),
        ),
        (
            "a program is named by what the toolchain calls it",
            REFERENCE.replace(
                _IMAGE_COMMIT,
                '    return commit(image["imageId"].encode("utf-8"), IMAGE_COMMITMENT_DOMAIN)\n',
            ),
        ),
        (
            "a program is named by the steps it holds rather than the bytes it is",
            REFERENCE.replace(
                _IMAGE_COMMIT,
                '    return commit(str(decode_program(image["body"])).encode("utf-8"), IMAGE_COMMITMENT_DOMAIN)\n',
            ),
        ),
        (
            "an image and a statement are committed under the same domain",
            REFERENCE.replace(
                _IMAGE_COMMIT,
                '    return commit(bytes(image["body"]), STATEMENT_COMMITMENT_DOMAIN)\n',
            ),
        ),
        (
            "a digest is handed out for bytes nothing can run",
            REFERENCE.replace(_IMAGE_BODY, ""),
        ),
        # -- handing the guest its inputs -------------------------------------
        (
            "the witness travels as a public input",
            REFERENCE.replace(_INGEST_PRIVATE, '    env.public("witness", witness)\n'),
        ),
        (
            "the witness travels in the process environment as well",
            REFERENCE.replace(
                _INGEST_PRIVATE,
                '    env.variable("quantity", witness["quantity"])\n    env.write_private(witness)\n',
            ),
        ),
        (
            "the run is noted so it can be reproduced",
            REFERENCE.replace(
                _INGEST_PRIVATE,
                '    env.note("proving", searchTried=witness["search"])\n    env.write_private(witness)\n',
            ),
        ),
        (
            "the guest is handed the public inputs somebody thought it needed",
            REFERENCE.replace(
                _INGEST_PUBLIC,
                '    for field in ("imageDigest", "semantics", "claim", "params"):\n'
                "        env.public(field, statement[field])\n",
            ),
        ),
        (
            "the account is published field by field next to the statement",
            REFERENCE.replace(
                _INGEST_PRIVATE,
                "    for name in PARAM_NAMES:\n"
                '        env.public(name, statement["params"][name])\n'
                "    env.write_private(witness)\n",
            ),
        ),
        (
            "a witness for another machine is masked into this one's domain",
            REFERENCE.replace(
                _INGEST_GUARD,
                "    if isinstance(witness, dict) and isinstance(witness.get(\"quantity\"), int):\n"
                '        witness = {**witness, "quantity": witness["quantity"] % profile["modulus"]}\n',
            ),
        ),
        # -- running the program the statement names ---------------------------
        (
            "the guest believes the host's verdict",
            REFERENCE.replace(
                _RUN_CLAIM, '        "claimResult": bool(env.hints().get("claimResult")),\n'
            ),
        ),
        (
            "the guest takes the host's step count",
            REFERENCE.replace(
                '        "steps": steps,\n', '        "steps": env.hints().get("steps", steps),\n'
            ),
        ),
        (
            "the guest runs whatever image it is handed",
            REFERENCE.replace(_RUN_FAIL_CLOSED, ""),
        ),
        (
            "the guest trusts whatever arrives on the private channel",
            REFERENCE.replace(_RUN_WITNESS_GUARD, ""),
        ),
        (
            "the machine wraps at a familiar width",
            REFERENCE.replace(
                _RUN_PROFILE,
                '    modulus, maximum, overflow = 1 << 16, (1 << 16) - 1, "wrapping"\n',
            ),
        ),
        (
            "every machine wraps, whatever profile the statement named",
            REFERENCE.replace(
                _RUN_OVERFLOW,
                "            if exact > maximum:\n"
                "                wrapped.append(WRAP_SITE_OF[step])\n"
                "                exact %= modulus\n",
            ),
        ),
        (
            "the wrapping and the saturating machines are swapped",
            REFERENCE.replace(
                '                if overflow == "wrapping":\n',
                '                if overflow == "saturating":\n',
            ),
        ),
        (
            "the security property is read off the machine's own total",
            REFERENCE.replace(
                '        "violated": spent + price * quantity > budget,\n',
                '        "violated": accumulator > budget,\n',
            ),
        ),
        (
            "the claim is credited whenever something wrapped",
            REFERENCE.replace(
                '            and claim_site(statement["claim"]) in wrapped\n',
                "            and bool(wrapped)\n",
            ),
        ),
        (
            "the claim is credited on a run the guard refused",
            REFERENCE.replace("            accepted\n            and spent", "            spent"),
        ),
        (
            "a trapped run counts the step that trapped it",
            REFERENCE.replace(
                "                    trapped = True\n                    break\n",
                "                    trapped = True\n                    steps += 1\n                    break\n",
            ),
        ),
        # -- what the run publishes ---------------------------------------------
        (
            "the journal commits to the fields somebody found interesting",
            REFERENCE.replace(
                _SEAL_DIGEST,
                '        "statementDigest": commit(\n'
                '            _text(statement["imageDigest"]) + _text(statement["claim"]),\n'
                "            STATEMENT_COMMITMENT_DOMAIN,\n"
                "        ),\n",
            ),
        ),
        (
            "the journal carries a cycle count next to the step count",
            REFERENCE.replace(
                '        "measurements": {"steps": run["steps"]},\n',
                '        "measurements": {"steps": run["steps"], "cycles": run["steps"] * 17},\n',
            ),
        ),
        (
            "the journal seals a run of a program the statement does not name",
            REFERENCE.replace(_SEAL_IMAGE_GUARD, ""),
        ),
        (
            "the journal seals whatever record it is handed",
            REFERENCE.replace(_SEAL_RUN_GUARD, ""),
        ),
        (
            "the journal reports a guest version the statement never named",
            REFERENCE.replace(
                '        "guestVersion": statement["guestVersion"],\n',
                '        "guestVersion": statement["domain"],\n',
            ),
        ),
        # -- offering it against something else ----------------------------------
        (
            "a receipt is accepted on the strength of its own journal",
            REFERENCE.replace(_ACCEPT_BINDING, ""),
        ),
        (
            "the journal's own fields are taken at their word",
            REFERENCE.replace(_ACCEPT_CONVENIENCE, ""),
        ),
        (
            "a receipt about a claim that did not hold is evidence for it",
            REFERENCE.replace(
                '    return journal["claimResult"] is True', "    return True"
            ),
        ),
        (
            "a journal may carry a field somebody added after sealing",
            REFERENCE.replace(
                _ACCEPT_JOURNAL_SHAPE,
                "    if not isinstance(journal, dict) or not set(JOURNAL_FIELDS) <= set(journal):\n"
                "        return False\n",
            ),
        ),
        (
            "a journal may measure something the public image does not imply",
            REFERENCE.replace(_ACCEPT_MEASUREMENTS, ""),
        ),
        (
            "the verifier crashes on a receipt that is not a receipt",
            REFERENCE.replace(
                _ACCEPT_RECEIPT_SHAPE,
                "    if set(receipt) != set(RECEIPT_FIELDS):\n        return False\n",
            ),
        ),
        (
            "the verifier is offered a statement and does not ask whether it is one",
            REFERENCE.replace(_ACCEPT_STATEMENT, ""),
        ),
        # -- what a run gave away -------------------------------------------------
        (
            "the audit reads the journal and nothing else",
            REFERENCE.replace(_LEAK_CHANNELS, "").replace(_LEAK_ERROR, ""),
        ),
        (
            "the audit forgets the record a failed run left",
            REFERENCE.replace(_LEAK_ERROR, ""),
        ),
        (
            "a name nested inside an approved container is not a published name",
            REFERENCE.replace(
                _LEAK_NESTED, "    for name, value in values.items():\n        yield channel, name, value\n"
            ),
        ),
        (
            "an approved name is an approval, whatever it carries",
            REFERENCE.replace(_LEAK_PARAM_RULE, ""),
        ),
        (
            "a measurement is safe because it is a number",
            REFERENCE.replace(_LEAK_MEASUREMENT_RULE, ""),
        ),
        (
            "the audit reports every name it finds",
            REFERENCE.replace(
                _LEAK_NAME_RULE, "        if True:\n            out.add((channel, name))\n"
            ),
        ),
        (
            "the audit reports its findings in whatever order it found them",
            REFERENCE.replace(_LEAK_SORT, "    return tuple(sorted(out, reverse=True))\n"),
        ),
    ]


def _load(source: str) -> types.ModuleType:
    module = types.ModuleType("mut_guest")
    exec(compile(source, "<mutation>", "exec"), module.__dict__)  # noqa: S102 - our own fixtures
    return module


def _easy_cases_agree(module) -> bool:
    """The two questions a natural test of a guest contract asks, and nothing else.

    Does the happy path end in a receipt that verifies, and is a receipt offered against a
    different program refused? Both are named in the problem text, both are one call away from
    a fixture the learner was handed, and both are things a guest can get right while binding
    nothing at all. Nothing here asks whether two accounts can share an encoding, whether the
    host's hint was believed, what a saturating machine does, which journal field a verifier
    may read, or what a run said on a channel nobody reads -- and each of those is a different
    way to be wrong while still getting these two right.
    """
    for label in LABELS:
        built = scenario(SEED, label)
        record, image_record, private = built["statement"], built["image"], built["witness"]
        other = commit(
            bytes(sibling_images(SEED, label)["rebuilt"]["body"]), IMAGE_COMMITMENT_DOMAIN
        )
        try:
            env = Env()
            module.guest_input(env, dict(record), dict(private))
            if set(env.public_inputs()) != set(STATEMENT_FIELDS):
                return False
            run = module.run_guest(dict(image_record), env)
            receipt = {"journal": module.seal_journal(dict(record), run)}
            if module.accept_receipt(receipt, dict(record)) is not True:
                return False
            if module.accept_receipt(receipt, {**record, "imageDigest": other}) is not False:
                return False
        except Exception:  # noqa: BLE001 - a guest that raises has not answered
            return False
    return True


SPOOF = "\n".join(
    [
        "import atexit, json",
        'atexit.register(lambda: print(json.dumps({"failures": []})))',
        "",
    ]
)


def main() -> int:
    reference = _load(REFERENCE)
    reference_failures = run(reference, SEED)
    if reference_failures:
        print("FAIL reference implementation does not pass the hidden tests")
        for failure in reference_failures:
            print(f"  {failure}")
        return 1
    print("PASS reference implementation passes the hidden tests")
    if not _easy_cases_agree(reference):
        print("FAIL reference implementation does not get the easy two right")
        return 1
    print("PASS reference implementation gets the easy two right")

    mutations = _mutations()
    survivors: list[str] = []
    invisible: list[str] = []
    for name, source in mutations:
        if source == REFERENCE:
            survivors.append(f"{name} (the mutation did not change the reference)")
            print(f"SURVIVED {name} -- the replacement matched nothing")
            continue
        module = None
        try:
            module = _load(source)
            failures = run(module, SEED)
        except Exception as error:  # noqa: BLE001 - a guest that cannot even load is caught
            failures = [f"the mutated guest raised {type(error).__name__} at import"]
        # The same module object the checker was handed, not a second load of the same source.
        # A mutation that cannot be imported at all has no weak-probe answer to give, and asking
        # for one would raise here rather than in the guarded block above.
        if module is not None and _easy_cases_agree(module):
            invisible.append(name)
        if failures:
            print(f"KILLED {name} ({failures[0]})")
        else:
            survivors.append(name)
            print(f"SURVIVED {name}")

    from verifier.server import evaluate  # noqa: PLC0415 - imported after sys.path

    if evaluate("encoding", SPOOF):
        survivors.append("verifier credits a submission that prints its own verdict")
        print("SURVIVED verifier credits a submission that prints its own verdict")
    else:
        print("KILLED verifier credits a submission that prints its own verdict")

    print()
    print(f"{len(invisible)} of {len(mutations)} broken guests still get the easy two right:")
    for name in invisible:
        print(f"  - {name}")

    print()
    if survivors:
        print(f"{len(survivors)} mutation(s) survived:")
        for name in survivors:
            print(f"  - {name}")
        return 1
    print(f"All {len(mutations) + 1} mutations killed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
