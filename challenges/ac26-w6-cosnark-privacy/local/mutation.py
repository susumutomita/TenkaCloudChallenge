"""Mutation suite: break the reference on purpose, assert the hidden tests notice.

It also measures the thing this problem is about. Every mutation is run twice: once through
the hidden checker, and once through a **verdict probe** that asks each specimen the only
question a natural test of an auditor asks -- *did you spot that this one is not clean?* No
channel, no pair, no value, no opening record. The count of mutations the verdict probe
cannot see is printed on every run and both READMEs quote it. If a later edit makes the
checkpoints cheaper, that number moves and the claim moves with it.
"""

from __future__ import annotations

import sys
import types
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from fixtures.generate import SHAPES  # noqa: E402
from participant.lab import Scenario, probe_factory, run_on  # noqa: E402
from fixtures.specimens import GROUND_TRUTH, MALFORMED_TRUTH, SPECIMEN_IDS  # noqa: E402
from tests.hidden.check_prover import CROSS_PARTY, run  # noqa: E402

SEED = "mutation-suite-seed"
REFERENCE = (Path(__file__).resolve().parent / "reference" / "prover.py").read_text("utf-8")

_AUTHORIZED = (
    '    return bool(record.get("maskedBy")) and record.get("roundId") == round_id_for(row)'
)

_VOCABULARY = """    for field, vocabulary in (("origin", ORIGINS), ("form", FORMS), ("audience", AUDIENCES)):
        if entry.get(field) not in vocabulary:
            raise ValueError(f"{field} {entry.get(field)!r} is not one of {vocabulary}")
"""

_PROBES = """    runs = (honest, probe(specimen_id, malformed_row(honest.row)))"""

_OPEN_RECORD = """            "masked": bool(record["maskedBy"]),"""

_CROSSED = """        "crossed": len(parties) > 1,"""

_LEAKAGE_RULES = """        if name not in ALLOWED_NAMES:
            out.add((channel, name))
        elif name in SHARING_ONLY_NAMES and not is_sharing(value, parties):"""

_DERIVE_SHARING = """    if isinstance(value, (list, tuple)) and value and all(_integer(item) for item in value):
        # A sharing in the clear. Additive shares sum to what they were hiding.
        return sum(value) % prime"""

_DERIVE_MASK = """    mask_partner = siblings.get("d")
    if _integer(mask_partner):"""

_REPAIR_BODY = """    proof = beaver_product(runtime, row, halves, triple)
    # Everything below names the run. Nothing below carries any of it."""


def _mutations() -> list[tuple[str, str]]:
    return [
        # -- the policy ----------------------------------------------------
        (
            "classify calls every opening an allowed one",
            REFERENCE.replace(
                "    if opened is not None and _authorized(opened, row):",
                "    if opened is not None:",
            ),
        ),
        (
            "classify authorizes an opening on its mask alone",
            REFERENCE.replace(_AUTHORIZED, '    return bool(record.get("maskedBy"))'),
        ),
        (
            "classify authorizes an opening on its round id alone",
            REFERENCE.replace(
                _AUTHORIZED, '    return record.get("roundId") == round_id_for(row)'
            ),
        ),
        (
            "classify hands the verifier's own values to the participant",
            REFERENCE.replace(
                '    if entry["audience"] == "verifier":\n        return "verifier-only"\n', ""
            ),
        ),
        (
            "classify calls any sharing a participant artifact",
            REFERENCE.replace(
                '    if entry["form"] == "sharing" and entry["audience"] == "participant":',
                '    if entry["form"] == "sharing":',
            ),
        ),
        (
            "classify calls metadata secret unless the relation produced it",
            REFERENCE.replace(
                '    if entry["origin"] == "relation" or entry["form"] == "metadata":',
                '    if entry["origin"] == "relation":',
            ),
        ),
        (
            "classify accepts a descriptor outside the vocabulary",
            REFERENCE.replace(_VOCABULARY, ""),
        ),
        # -- what a run was able to do -------------------------------------
        (
            "the capability audit only ever runs the specimen once",
            REFERENCE.replace(_PROBES, "    runs = (honest,)"),
        ),
        (
            "the capability audit probes twice with the same row",
            REFERENCE.replace(_PROBES, "    runs = (honest, probe(specimen_id, honest.row))"),
        ),
        (
            "the capability audit counts the multiplication's own capability",
            REFERENCE.replace(
                "    return tuple(sorted(reached.difference(PROTOCOL_CAPABILITIES)))",
                "    return tuple(sorted(reached))",
            ),
        ),
        (
            "the capability audit reads the operation trace instead of the record",
            REFERENCE.replace(
                '    reached = {record["capability"] for run in runs for record in run.runtime.reached()}',
                '    reached = {record["op"] for run in runs for record in run.runtime.events()}',
            ),
        ),
        # -- what a run published to the other parties ----------------------
        (
            "the open-set audit accepts any opening that carries a mask",
            REFERENCE.replace(
                "        if not _authorized(record, evidence.row)",
                '        if not record["maskedBy"]',
            ),
        ),
        (
            "the open-set audit accepts any opening in the declared round",
            REFERENCE.replace(
                "        if not _authorized(record, evidence.row)",
                '        if record["roundId"] != round_id_for(evidence.row)',
            ),
        ),
        (
            "the open-set audit reports every opening the run made",
            REFERENCE.replace(
                "        if not _authorized(record, evidence.row)\n", ""
            ),
        ),
        (
            "the open-set audit reports the masks rather than whether there were any",
            REFERENCE.replace(_OPEN_RECORD, '            "masked": record["maskedBy"],'),
        ),
        # -- whose shares a run read ---------------------------------------
        (
            "the cross-party audit calls any peek a boundary crossing",
            REFERENCE.replace(_CROSSED, '        "crossed": len(peeks) > 0,'),
        ),
        (
            "the cross-party audit never finds a crossing",
            REFERENCE.replace(_CROSSED, '        "crossed": False,'),
        ),
        (
            "the cross-party audit reports one entry per peek instead of per owner",
            REFERENCE.replace(
                '    parties = tuple(sorted({record["party"] for record in peeks}))',
                '    parties = tuple(record["party"] for record in peeks)',
            ),
        ),
        (
            "the cross-party audit counts owners where it should count peeks",
            REFERENCE.replace('        "peeks": len(peeks),', '        "peeks": len(parties),'),
        ),
        # -- what a run published to us ------------------------------------
        (
            "the leakage audit trusts a name on the allowlist whatever it carries",
            REFERENCE.replace(
                _LEAKAGE_RULES,
                "        if name not in ALLOWED_NAMES:\n"
                "            out.add((channel, name))\n"
                "        elif False:",
            ),
        ),
        (
            "the leakage audit only checks the names that must carry a sharing",
            REFERENCE.replace(
                _LEAKAGE_RULES,
                "        if False:\n"
                "            out.add((channel, name))\n"
                "        elif name in SHARING_ONLY_NAMES and not is_sharing(value, parties):",
            ),
        ),
        (
            "the leakage audit reads the proof artifact and nothing else",
            REFERENCE.replace(
                "    for channel, name, value, _ in _channels(evidence.disclosure):",
                "    for channel, name, value, _ in list(_channels(evidence.disclosure))[\n"
                "        : len(evidence.disclosure.artifact)\n"
                "    ]:",
            ),
        ),
        (
            "the leakage audit polices the log's event names as well as its fields",
            REFERENCE.replace(
                '    for record in disclosure.log:\n'
                '        yield from (("log", name, value, record["values"])\n'
                '                    for name, value in record["values"].items())',
                '    for record in disclosure.log:\n'
                '        yield "log", record["event"], record["event"], record["values"]\n'
                '        yield from (("log", name, value, record["values"])\n'
                '                    for name, value in record["values"].items())',
            ),
        ),
        (
            "the leakage audit treats an error's prose as a disclosed field",
            REFERENCE.replace(
                '    if disclosure.error is not None:\n'
                '        yield from (("error", name, value, disclosure.error["values"])\n'
                '                    for name, value in disclosure.error["values"].items())',
                '    if disclosure.error is not None:\n'
                '        yield "error", "message", disclosure.error["message"], disclosure.error["values"]\n'
                '        yield from (("error", name, value, disclosure.error["values"])\n'
                '                    for name, value in disclosure.error["values"].items())',
            ),
        ),
        # -- what we can recover from it -----------------------------------
        (
            "the evidence takes a disclosed value at face value next to its mask",
            REFERENCE.replace(_DERIVE_MASK, "    mask_partner = None\n    if _integer(mask_partner):"),
        ),
        (
            "the evidence adds the mask without reducing it",
            REFERENCE.replace(
                "        return (value + mask_partner) % prime",
                "        return value + mask_partner",
            ),
        ),
        (
            "the evidence reads one share of a sharing published in the clear",
            REFERENCE.replace(_DERIVE_SHARING.split("\n")[-1], "        return value[0] % prime"),
        ),
        (
            "the evidence never finds anything",
            REFERENCE.replace(
                "        recovered = _derive(value, siblings, prime)", "        recovered = None"
            ),
        ),
        (
            "the evidence trusts an allowed name whatever it carries",
            REFERENCE.replace(
                "    if name not in ALLOWED_NAMES:\n        return True\n    return name in SHARING_ONLY_NAMES and not (",
                "    if name not in ALLOWED_NAMES:\n        return True\n    return False and (",
            ),
        ),
        (
            "the evidence names a channel it did not take the value from",
            REFERENCE.replace(
                '            return {"value": recovered, "from": (channel, name)}',
                '            return {"value": recovered, "from": ("artifact", name)}',
            ),
        ),
        # -- the repair ----------------------------------------------------
        (
            "the repaired prover ships C as a reconstructed value",
            REFERENCE.replace(
                "    sink.publish(clean_artifact(row, proof))",
                "    artifact = clean_artifact(row, proof)\n"
                '    artifact["C"] = runtime.reconstruct(proof["C"])\n'
                "    sink.publish(artifact)",
            ),
        ),
        (
            "the repaired prover logs the mask next to the value it was masking",
            REFERENCE.replace(
                '    sink.emit("opened", d=proof["d"], e=proof["e"])',
                '    sink.emit(\n'
                '        "opened",\n'
                '        d=proof["d"],\n'
                '        e=proof["e"],\n'
                '        x=sum(runtime.peek(share) for share in triple.x) % row["p"],\n'
                "    )",
            ),
        ),
        (
            "the repaired prover publishes no artifact at all",
            REFERENCE.replace("    sink.publish(clean_artifact(row, proof))\n", ""),
        ),
        (
            "the repaired prover opens the left half to check its own arithmetic",
            REFERENCE.replace(
                _REPAIR_BODY,
                _REPAIR_BODY + '\n    runtime.open(f"{row[\'relationId\']}:sanity", proof["A"])',
            ),
        ),
        (
            "the repaired prover puts the failing state in the error",
            REFERENCE.replace(
                _REPAIR_BODY,
                "    try:\n"
                "        proof = beaver_product(runtime, row, halves, triple)\n"
                "    except Exception as error:\n"
                "        sink.fail(\n"
                '            f"prover failed: {error}",\n'
                '            shares=tuple(runtime.peek(share) for share in halves["B"]),\n'
                "        )\n"
                "        raise",
            ),
        ),
    ]


def _load(source: str) -> types.ModuleType:
    module = types.ModuleType("mut_prover")
    exec(compile(source, "<mutation>", "exec"), module.__dict__)  # noqa: S102 - our own fixtures
    return module


def _leaky(identifier: str) -> bool:
    honest = GROUND_TRUTH[identifier]
    malformed = MALFORMED_TRUTH.get(identifier, honest)
    return bool(
        honest["capabilities"]
        or malformed["capabilities"]
        or honest["unauthorized"]
        or malformed["unauthorized"]
        or honest["disclosed"]
        or malformed["disclosed"]
        or identifier in CROSS_PARTY
    )


VERDICTS = {identifier: _leaky(identifier) for identifier in SPECIMEN_IDS}


def _verdicts_agree(module) -> bool:
    """What a natural test of an auditor asks: did you spot that this one is not clean?

    A yes or a no per specimen, over every coefficient shape. It never asks which channel,
    which field, which value, or which opening record -- and every one of those is a
    different thing an auditor can get wrong while still pointing at the right prover.
    """
    for shape in SHAPES:
        probe = probe_factory(SEED, "m", shape)
        for identifier in SPECIMEN_IDS:
            evidence = run_on(Scenario(SEED, "m", shape), identifier)
            try:
                cross = module.cross_party_audit(evidence)
                flagged = bool(
                    module.capability_audit(probe, identifier)
                    or module.open_set_audit(evidence)
                    or module.leakage_audit(evidence)
                    or (isinstance(cross, dict) and cross.get("crossed"))
                )
            except Exception:  # noqa: BLE001
                return False
            if flagged is not VERDICTS[identifier]:
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
    if not _verdicts_agree(reference):
        print("FAIL reference implementation does not agree with the plain verdicts")
        return 1
    print("PASS reference implementation agrees with the plain verdicts")

    mutations = _mutations()
    survivors: list[str] = []
    invisible: list[str] = []
    for name, source in mutations:
        if source == REFERENCE:
            survivors.append(f"{name} (the mutation did not change the reference)")
            print(f"SURVIVED {name} -- the replacement matched nothing")
            continue
        module = _load(source)
        failures = run(module, SEED)
        if _verdicts_agree(module):
            invisible.append(name)
        if failures:
            print(f"KILLED {name} ({failures[0]})")
        else:
            survivors.append(name)
            print(f"SURVIVED {name}")

    from verifier.server import evaluate  # noqa: PLC0415 - imported after sys.path

    if evaluate("classify", SPOOF):
        survivors.append("verifier credits a submission that prints its own verdict")
        print("SURVIVED verifier credits a submission that prints its own verdict")
    else:
        print("KILLED verifier credits a submission that prints its own verdict")

    print()
    print(
        f"{len(invisible)} of {len(mutations)} broken audits still give every specimen "
        "the right verdict:"
    )
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
