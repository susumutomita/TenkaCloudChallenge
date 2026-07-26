"""Mutation suite: break the reference on purpose, assert the hidden tests notice.

It also measures the thing the problem is actually about. Every mutation is run twice: once
through the hidden checker, and once through a **value-only probe** that does what a natural
test of a multiplication does -- run the whole step and check that `C` reconstructs to
`A * B` on every shape. The count of mutations the value probe cannot see is printed on every
run, and both READMEs quote it. If a later edit makes the checkpoints cheaper, that number
moves and the claim moves with it.
"""

from __future__ import annotations

import sys
import types
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from fixtures.generate import SHAPES  # noqa: E402
from tests.hidden.check_prover import LABELS, _Scenario, _valid_sharing, run  # noqa: E402

SEED = "mutation-suite-seed"
REFERENCE = (Path(__file__).resolve().parent / "reference" / "prover.py").read_text("utf-8")

_DE_TERM = """            if party == 0:
                # Public constants are added once, not once per party. Which party does it
                # is arbitrary; that exactly one does is not.
                total = runtime.add_public(total, (d * e) % prime)
"""

_MASK_LINES = """            d_shares.append(runtime.sub(halves["A"][party], triple.x[party]))
            e_shares.append(runtime.sub(halves["B"][party], triple.y[party]))"""

_PRODUCT_TERMS = """            total = runtime.add(triple.z[party], runtime.mul_public(triple.y[party], d))
            total = runtime.add(total, runtime.mul_public(triple.x[party], e))"""

_OPEN_REPORT = """        "openings": len(records),
        "rounds": len({record["roundId"] for record in records}),"""

_AUDIT_REPORT = """        "opened": len(records),
        "rounds": len({record["roundId"] for record in records}),"""

# The shortcut this problem exists to make visible: open both halves in the clear, do the
# arithmetic on plain integers, and hand back a sharing of the answer. `C` is correct at every
# seed and every shape, the schedule is still one round, and the triple is still spent -- so
# every value-shaped assertion in the suite passes. What it threw away is in `openings()`.
_HONEST_STEP = '''def prove_product(runtime, relation: dict, halves: dict, triple) -> dict:
    reservation = reserve_fresh_triple(runtime, relation, triple)
    masked = masked_operands(runtime, triple, halves)
    round_id = f"{relation['relationId']}:mul"
    opened = open_masks(runtime, round_id, masked)
    product = shared_product(runtime, triple, opened["d"], opened["e"])
    return {
        "A": tuple(halves["A"]),
        "B": tuple(halves["B"]),
        "C": product,
        "d": opened["d"],
        "e": opened["e"],
        "tripleId": reservation["tripleId"],
        "roundId": round_id,
        "rounds": opened["rounds"],
    }'''

_SHORTCUT = '''def prove_product(runtime, relation: dict, halves: dict, triple) -> dict:
    reservation = reserve_fresh_triple(runtime, relation, triple)
    round_id = f"{relation['relationId']}:mul"
    prime = runtime.setting["p"]
    a = runtime.open(round_id, halves["A"])
    b = runtime.open(round_id, halves["B"])
    product = []
    for party in range(runtime.setting["parties"]):
        with runtime.party_scope(party):
            share = runtime.zero()
            if party == 0:
                share = runtime.add_public(share, (a * b) % prime)
            product.append(share)
    records = runtime.openings()
    return {
        "A": tuple(halves["A"]),
        "B": tuple(halves["B"]),
        "C": tuple(product),
        "d": a,
        "e": b,
        "tripleId": reservation["tripleId"],
        "roundId": round_id,
        "rounds": len({record["roundId"] for record in records}),
    }'''


def _mutations() -> list[tuple[str, str]]:
    return [
        # -- the plan ------------------------------------------------------
        (
            "plan calls a layer with nothing in it one round",
            REFERENCE.replace('"rounds": 1 if products else 0,', '"rounds": 1,'),
        ),
        (
            "plan spends one round per multiplication instead of one per layer",
            REFERENCE.replace('"rounds": 1 if products else 0,', '"rounds": products,'),
        ),
        (
            "plan counts open among the local operations",
            REFERENCE.replace(
                'LOCAL_OPERATIONS = ("add", "add-public", "mul-public", "sub")',
                'LOCAL_OPERATIONS = ("add", "add-public", "mul-public", "open", "sub")',
            ),
        ),
        (
            "plan counts one message per party per multiplication",
            REFERENCE.replace(
                '"messages": 2 * products * parties,', '"messages": products * parties,'
            ),
        ),
        (
            "plan accepts a fieldId that names a different field",
            REFERENCE.replace(
                "    if field != field_id(prime):\n"
                '        raise ValueError(f"relation fieldId {field!r} does not name the field of p={prime}")\n',
                "",
            ),
        ),
        (
            "plan accepts a layer of negative width",
            REFERENCE.replace(
                "    if products < 0:\n"
                '        raise ValueError("a layer cannot hold a negative number of multiplications")\n',
                "",
            ),
        ),
        # -- the triple ----------------------------------------------------
        (
            "triple reservation swallows the runtime's refusal",
            REFERENCE.replace(
                "    reserved = runtime.reserve_triple(triple)",
                "    try:\n"
                "        reserved = runtime.reserve_triple(triple)\n"
                "    except Exception:\n"
                "        reserved = triple",
            ),
        ),
        (
            "triple reservation reports its own receipt instead of the runtime's ledger",
            REFERENCE.replace(
                '        "consumed": tuple(runtime.consumed_triples()),',
                '        "consumed": (triple.id,),',
            ),
        ),
        (
            "triple accepted without checking it against the relation's field",
            REFERENCE.replace(
                '    if getattr(triple, "fieldId", None) != relation.get("fieldId"):\n'
                "        raise ValueError(\"the triple was drawn for another field than the relation's\")\n",
                "",
            ),
        ),
        (
            "triple accepted without checking it against the relation's party count",
            REFERENCE.replace(
                '    if getattr(triple, "parties", None) != relation.get("parties"):\n'
                "        raise ValueError(\"the triple was drawn for another party count than the relation's\")\n",
                "",
            ),
        ),
        # -- the masks -----------------------------------------------------
        (
            "masks subtract the share from the mask rather than the mask from the share",
            REFERENCE.replace(
                'runtime.sub(halves["A"][party], triple.x[party])',
                'runtime.sub(triple.x[party], halves["A"][party])',
            ).replace(
                'runtime.sub(halves["B"][party], triple.y[party])',
                'runtime.sub(triple.y[party], halves["B"][party])',
            ),
        ),
        (
            "masks pair A with y and B with x",
            REFERENCE.replace(
                _MASK_LINES,
                '            d_shares.append(runtime.sub(halves["A"][party], triple.y[party]))\n'
                '            e_shares.append(runtime.sub(halves["B"][party], triple.x[party]))',
            ),
        ),
        (
            "masks add the triple's share instead of subtracting it",
            REFERENCE.replace("runtime.sub(halves[", "runtime.add(halves["),
        ),
        (
            "[d] is masked with the triple's z rather than its x",
            REFERENCE.replace(
                'runtime.sub(halves["A"][party], triple.x[party])',
                'runtime.sub(halves["A"][party], triple.z[party])',
            ),
        ),
        # -- the round -----------------------------------------------------
        (
            "d and e go out in separate rounds",
            REFERENCE.replace(
                '    e = runtime.open(round_id, masked["e"])',
                '    e = runtime.open(round_id + ":e", masked["e"])',
            ),
        ),
        (
            "the opening report states two openings in one round without looking",
            REFERENCE.replace(_OPEN_REPORT, '        "openings": 2,\n        "rounds": 1,'),
        ),
        (
            "the opening report calls every opening a round",
            REFERENCE.replace(
                _OPEN_REPORT, '        "openings": len(records),\n        "rounds": len(records),'
            ),
        ),
        # -- the product ---------------------------------------------------
        (
            "every party folds the public d*e into its own share",
            REFERENCE.replace(
                _DE_TERM, "            total = runtime.add_public(total, (d * e) % prime)\n"
            ),
        ),
        (
            "the public d*e term is left out of [C]",
            REFERENCE.replace(_DE_TERM, ""),
        ),
        (
            "d scales [x] and e scales [y]",
            REFERENCE.replace(
                _PRODUCT_TERMS,
                "            total = runtime.add(triple.z[party], runtime.mul_public(triple.x[party], d))\n"
                "            total = runtime.add(total, runtime.mul_public(triple.y[party], e))",
            ),
        ),
        (
            "the round is named by a constant rather than by the relation",
            REFERENCE.replace(
                "    round_id = f\"{relation['relationId']}:mul\"", '    round_id = "mul"'
            ),
        ),
        (
            "the step reports one round from belief rather than from the runtime",
            REFERENCE.replace('        "rounds": opened["rounds"],', '        "rounds": 1,'),
        ),
        # -- the artifact --------------------------------------------------
        (
            "the artifact publishes C as a reconstructed value",
            REFERENCE.replace(
                '        "C": proof["C"],',
                '        "C": runtime.open(proof["roundId"], proof["C"]),',
            ),
        ),
        (
            "the artifact carries the opened d and e as well",
            REFERENCE.replace(
                '        "tripleId": proof["tripleId"],\n        "roundId": proof["roundId"],\n    }',
                '        "tripleId": proof["tripleId"],\n        "roundId": proof["roundId"],\n'
                '        "d": proof["d"],\n        "e": proof["e"],\n    }',
            ),
        ),
        (
            "the artifact labels itself with a constant relation id",
            REFERENCE.replace(
                '        "relationId": relation["relationId"],', '        "relationId": "R-row",'
            ),
        ),
        # -- the audit -----------------------------------------------------
        (
            "A and B are opened in the clear and C is re-shared",
            REFERENCE.replace(_HONEST_STEP, _SHORTCUT),
        ),
        (
            "the audit reports no unmasked opening without looking",
            REFERENCE.replace(
                '        "unmasked": sum(1 for record in records if not record["maskedBy"]),',
                '        "unmasked": 0,',
            ),
        ),
        (
            "the audit reports the triple it spent instead of the runtime's ledger",
            REFERENCE.replace(
                '        "triplesConsumed": tuple(runtime.consumed_triples()),',
                '        "triplesConsumed": (triple.id,),',
            ),
        ),
        (
            "the audit assumes the runtime it was handed withholds reconstruct",
            REFERENCE.replace(
                '        "reconstructAvailable": hasattr(runtime, "reconstruct"),',
                '        "reconstructAvailable": False,',
            ),
        ),
        (
            "the audit calls every opening a round",
            REFERENCE.replace(
                _AUDIT_REPORT,
                '        "opened": len(records),\n        "rounds": len(records),',
            ),
        ),
        (
            "the audit reports no violations without looking",
            REFERENCE.replace(
                '        "violations": len(runtime.violations()),', '        "violations": 0,'
            ),
        ),
    ]


def _load(source: str) -> types.ModuleType:
    module = types.ModuleType("mut_prover")
    exec(compile(source, "<mutation>", "exec"), module.__dict__)  # noqa: S102 - our own fixtures
    return module


def _values_agree(module) -> bool:
    """What a natural end-to-end test of a multiplication sees: does C come out right?

    Runs the whole step on every label and every coefficient shape and reconstructs `C`. This
    is the probe the checkpoints exist to be better than.
    """
    for label in LABELS:
        for shape in SHAPES:
            scenario = _Scenario(SEED, label, shape)
            try:
                proof = module.prove_product(
                    scenario.participant,
                    dict(scenario.relation),
                    scenario.halves,
                    scenario.triple,
                )
            except Exception:  # noqa: BLE001
                return False
            if not isinstance(proof, dict):
                return False
            if not _valid_sharing(proof.get("C"), scenario.cfg):
                return False
            if scenario.runtime.reconstruct(proof["C"]) != scenario.expected_product():
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
    if not _values_agree(reference):
        print("FAIL reference implementation does not agree with the plain product")
        return 1
    print("PASS reference implementation agrees with the plain product")

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
        if _values_agree(module):
            invisible.append(name)
        if failures:
            print(f"KILLED {name} ({failures[0]})")
        else:
            survivors.append(name)
            print(f"SURVIVED {name}")

    from verifier.server import evaluate  # noqa: PLC0415 - imported after sys.path

    if evaluate("plan", SPOOF):
        survivors.append("verifier credits a submission that prints its own verdict")
        print("SURVIVED verifier credits a submission that prints its own verdict")
    else:
        print("KILLED verifier credits a submission that prints its own verdict")

    print()
    print(f"{len(invisible)} of {len(mutations)} mutations still reconstruct C to A * B on every shape:")
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
