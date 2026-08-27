"""Mutation suite: break the reference on purpose, assert the hidden tests notice.

It also measures the thing the problem is actually about. Every mutation is run twice: once
through the hidden checker, and once through a **value-only probe** that does what a natural
test of a prover does -- reconstruct `A` and `B` on every shape and compare them with the
plain dot products. The count of mutations the value probe cannot see is printed on every
run, and the README quotes it. If a later edit makes the checkpoints cheaper, that number
moves and the claim moves with it.
"""

from __future__ import annotations

import sys
import types
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from fixtures.generate import SHAPES, dot  # noqa: E402
from tests.hidden.check_prover import LABELS, _Scenario, _valid_sharing, run  # noqa: E402

SEED = "mutation-suite-seed"
REFERENCE = (Path(__file__).resolve().parent / "reference" / "prover.py").read_text("utf-8")

# Issue 543 option B2: the supplied layer moved to `participant/mpc.py`, so the
# reference imports `field_id` from there. This string has to track it, or the
# reshare mutant below silently stops replacing anything and stops being a mutant.
_IMPORT = "from participant.mpc import field_id"

_RESHARE = '''def shared_linear_combination(runtime, coefficients, shares) -> tuple:
    prime = runtime.setting["p"]
    parties = runtime.setting["parties"]
    field = runtime.setting["fieldId"]
    values = [sum(share._value for share in sharing) % prime for sharing in shares]
    total = sum(c * v for c, v in zip(coefficients, values)) % prime
    head = [(total * 7 + index * 13) % prime for index in range(parties - 1)]
    parts = [*head, (total - sum(head)) % prime]
    return tuple(
        Share(party, field, f"reshared-{party}", value) for party, value in enumerate(parts)
    )'''

_HONEST_COMBINATION = '''def shared_linear_combination(runtime, coefficients, shares) -> tuple:
    parties = runtime.setting["parties"]
    out = []
    for party in range(parties):
        with runtime.party_scope(party):
            total = runtime.zero()
            for coefficient, sharing in zip(coefficients, shares):
                total = runtime.add(total, runtime.mul_public(sharing[party], coefficient))
            out.append(total)
    return tuple(out)'''

_VALIDATION_BODY = "            row.append(share.id)"


def _mutations() -> list[tuple[str, str]]:
    return [
        (
            "coefficients left as the representative they arrived as",
            REFERENCE.replace(
                "        vectors[name] = tuple(c % prime for c in raw)",
                "        vectors[name] = tuple(raw)",
            ),
        ),
        (
            "negative coefficients normalized with abs() instead of mod p",
            REFERENCE.replace(
                "        vectors[name] = tuple(c % prime for c in raw)",
                "        vectors[name] = tuple(abs(c) % prime for c in raw)",
            ),
        ),
        (
            "parser accepts a coefficient vector whose length is not the width",
            REFERENCE.replace(
                "        if len(raw) != width:\n"
                '            raise ValueError(f"coefficient vector {name} has {len(raw)} entries, width is {width}")\n',
                "",
            ),
        ),
        (
            "parser accepts a fieldId that names a different field",
            REFERENCE.replace(
                "    if field != field_id(prime):\n"
                '        raise ValueError(f"relation fieldId {field!r} does not name the field of p={prime}")\n',
                "",
            ),
        ),
        (
            "validation reads each share's value to check its label",
            REFERENCE.replace(
                _VALIDATION_BODY,
                "            with runtime.party_scope(party):\n"
                "                runtime.value_of(share)\n"
                "            row.append(share.id)",
            ),
        ),
        (
            "validation does not check that the sharing is in party order",
            REFERENCE.replace(
                '            if getattr(share, "party", None) != party:\n'
                "                raise ValueError(\n"
                '                    f"witness position {index} is not in party order at slot {party}"\n'
                "                )\n",
                "",
            ),
        ),
        (
            "validation does not check the field stamp",
            REFERENCE.replace(
                '            if getattr(share, "field", None) != field:\n'
                "                raise ValueError(\n"
                '                    f"witness position {index} party {party} lives in {share.field}, not {field}"\n'
                "                )\n",
                "",
            ),
        ),
        (
            "validation allows one sharing at two witness positions",
            REFERENCE.replace(
                "            if share.id in seen:\n"
                '                raise ValueError(f"share {share.id!r} appears at more than one witness position")\n',
                "",
            ),
        ),
        (
            "combination pairs the non-zero coefficients with the witness by position",
            REFERENCE.replace(
                "            for coefficient, sharing in zip(coefficients, shares):",
                "            for coefficient, sharing in zip([c for c in coefficients if c], shares):",
            ),
        ),
        (
            "combination always folds party 0's share, whichever party is computing",
            REFERENCE.replace(
                "                total = runtime.add(total, runtime.mul_public(sharing[party], coefficient))",
                "                total = runtime.add(total, runtime.mul_public(sharing[0], coefficient))",
            ),
        ),
        (
            "combination indexes the witness by party and the sharing by position",
            REFERENCE.replace(
                "            for coefficient, sharing in zip(coefficients, shares):\n"
                "                total = runtime.add(total, runtime.mul_public(sharing[party], coefficient))",
                "            for index, coefficient in enumerate(coefficients):\n"
                "                total = runtime.add(total, runtime.mul_public(shares[party][index], coefficient))",
            ),
        ),
        (
            "B built from the a coefficients",
            REFERENCE.replace(
                '        "B": shared_linear_combination(runtime, parsed["b"], shares),',
                '        "B": shared_linear_combination(runtime, parsed["a"], shares),',
            ),
        ),
        (
            "A and B returned the wrong way round",
            REFERENCE.replace(
                '        "A": shared_linear_combination(runtime, parsed["a"], shares),\n'
                '        "B": shared_linear_combination(runtime, parsed["b"], shares),',
                '        "A": shared_linear_combination(runtime, parsed["b"], shares),\n'
                '        "B": shared_linear_combination(runtime, parsed["a"], shares),',
            ),
        ),
        (
            "prover folds the witness without checking it against the relation",
            REFERENCE.replace("    validate_shared_witness(runtime, parsed, shares)\n", ""),
        ),
        (
            "witness reconstructed, folded in the clear, and re-shared",
            REFERENCE.replace(_IMPORT, "from participant.mpc import Share, field_id").replace(
                _HONEST_COMBINATION, _RESHARE
            ),
        ),
        (
            "audit asserts the results were issued instead of asking",
            REFERENCE.replace('        "issued": issued,', '        "issued": True,'),
        ),
        (
            "audit asserts every result stayed with its own party",
            REFERENCE.replace('        "singleParty": single_party,', '        "singleParty": True,'),
        ),
        (
            "audit reports no refused reads without looking",
            REFERENCE.replace(
                '        "violations": len(runtime.violations()),', '        "violations": 0,'
            ),
        ),
        (
            "audit assumes the runtime it was handed withholds reconstruct",
            REFERENCE.replace(
                '        "reconstructAvailable": hasattr(runtime, "reconstruct"),',
                '        "reconstructAvailable": False,',
            ),
        ),
        (
            "trace reports the answer everyone already knows",
            REFERENCE.replace(
                '        "rounds": sum(1 for event in events if event.get("communication")),\n'
                '        "messages": sum(int(event.get("messages", 0)) for event in events),',
                '        "rounds": 0,\n        "messages": 0,',
            ),
        ),
        (
            "trace counts one message per round",
            REFERENCE.replace(
                '        "messages": sum(int(event.get("messages", 0)) for event in events),',
                '        "messages": sum(1 for event in events if event.get("communication")),',
            ),
        ),
        (
            "trace reads the log before running the prover",
            REFERENCE.replace(
                "    prove_linear(runtime, relation, shares)\n    events = runtime.events()",
                "    events = runtime.events()\n    prove_linear(runtime, relation, shares)",
            ),
        ),
        (
            "trace names the parties the setting declares, not the ones the log holds",
            REFERENCE.replace(
                '        "parties": tuple(sorted({event["party"] for event in events})),',
                '        "parties": tuple(range(runtime.setting["parties"])),',
            ),
        ),
        (
            "trace calls a log with a silent round local anyway",
            REFERENCE.replace(
                '        "localOnly": not any(event.get("communication") for event in events),',
                '        "localOnly": all(int(event.get("messages", 0)) == 0 for event in events),',
            ),
        ),
    ]


def _load(source: str) -> types.ModuleType:
    module = types.ModuleType("mut_prover")
    exec(compile(source, "<mutation>", "exec"), module.__dict__)  # noqa: S102 - our own fixtures
    return module


def _values_agree(module) -> bool:
    """What a natural end-to-end test of a prover sees: do A and B come out right?

    Reconstructs both halves on every label and every coefficient shape. This is the probe
    the checkpoints exist to be better than.
    """
    for label in LABELS:
        for shape in SHAPES:
            scenario = _Scenario(SEED, label, shape)
            try:
                proof = module.prove_linear(
                    scenario.participant, dict(scenario.relation), scenario.shares
                )
            except Exception:  # noqa: BLE001
                return False
            if not isinstance(proof, dict):
                return False
            if not _valid_sharing(proof.get("A"), scenario.cfg) or not _valid_sharing(
                proof.get("B"), scenario.cfg
            ):
                return False
            prime = scenario.cfg["p"]
            if scenario.runtime.reconstruct(proof["A"]) != dot(
                scenario.relation["a"], scenario.witness, prime
            ):
                return False
            if scenario.runtime.reconstruct(proof["B"]) != dot(
                scenario.relation["b"], scenario.witness, prime
            ):
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
    if run(reference, SEED):
        print("FAIL reference implementation does not pass the hidden tests")
        for failure in run(reference, SEED):
            print(f"  {failure}")
        return 1
    print("PASS reference implementation passes the hidden tests")
    if not _values_agree(reference):
        print("FAIL reference implementation does not agree with the plain relation")
        return 1
    print("PASS reference implementation agrees with the plain relation")

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
        agrees = _values_agree(module)
        if agrees:
            invisible.append(name)
        if failures:
            print(f"KILLED {name} ({failures[0]})")
        else:
            survivors.append(name)
            print(f"SURVIVED {name}")

    from verifier.server import evaluate  # noqa: PLC0415 - imported after sys.path

    if evaluate("relation", SPOOF):
        survivors.append("verifier credits a submission that prints its own verdict")
        print("SURVIVED verifier credits a submission that prints its own verdict")
    else:
        print("KILLED verifier credits a submission that prints its own verdict")

    print()
    print(
        f"{len(invisible)} of {len(mutations)} mutations reconstruct to the right A and B "
        "on every shape:"
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
