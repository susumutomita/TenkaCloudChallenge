"""Mutation suite: break the reference on purpose and assert the hidden tests notice.

This is the check that keeps the hidden suite honest. A green run against a correct design
proves nothing about whether the tests would catch a wrong one — and in a design problem the
wrong answers are the interesting part, because every one of them still returns a design.
Each mutation below produces a complete, well-formed, plausible-looking answer. None of them
is right, and the whole question is whether that difference is observable.

Run inside the image (or in CI):  python mutation.py
Exit code 0 means every mutation was killed.
"""

from __future__ import annotations

import sys
import types
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))

from tests.hidden import check_design  # noqa: E402

REFERENCE = (ROOT / "reference" / "design.py").read_text(encoding="utf-8")
SEED = "mutation-suite-seed"

#: (name, [(needle, replacement), ...]). Every needle must be present in the reference, so a
#: mutation that stopped applying is reported rather than silently passing.
#:
#: Equivalent mutants are deliberately absent. Two candidates were dropped after failing the
#: "does it change an observable output" test: returning `select_primitive`'s list in another
#: order (every check compares it as a set), and emitting the `known_to` edges in another
#: order (no assertion depends on edge order). Listing either would produce a permanent
#: SURVIVED that trains an author to skim past this suite.
MUTATIONS: tuple[tuple[str, list[tuple[str, str]]], ...] = (
    (
        "classifies an asset somebody must not learn as public",
        [('        secret = bool(asset["must_not_learn"])', "        secret = False")],
    ),
    (
        "does not distinguish a computed asset from an input",
        [('        derived = bool(asset.get("derived_from"))', "        derived = False")],
    ),
    (
        # The distinction the requirements checkpoint turns on: a party that only reads the
        # answer is not a party you need privacy from.
        "treats being hidden from a party that only reads the result as a privacy requirement",
        [
            (
                '        if any(_role_of(brief, other) in PARTICIPATING_ROLES for other in asset["must_not_learn"]):',
                '        if asset["must_not_learn"]:',
            )
        ],
    ),
    (
        "requires zero knowledge wherever soundness is required",
        [
            (
                '        for source_id in asset.get("derived_from", []):',
                '        required["zero_knowledge"] = True\n        for source_id in asset.get("derived_from", []):',
            )
        ],
    ),
    (
        "misses that a deadline rule puts availability on the list",
        [
            (
                '    required["availability"] = bool(brief["constraints"].get("must_complete_without_all_parties"))',
                '    required["availability"] = False',
            )
        ],
    ),
    (
        # The habit this problem exists to break.
        "reaches for cryptography on a brief that requires none",
        [
            (
                '    if _covers(["none"], required) and is_admissible("none", brief):\n        return ["none"]',
                "    pass",
            )
        ],
    ),
    (
        "takes every option that is available rather than the ones the brief needs",
        [
            (
                "    for size in range(1, len(admissible) + 1):",
                "    if _covers(admissible, required):\n"
                "        return sorted(admissible)\n"
                "    for size in range(1, len(admissible) + 1):",
            )
        ],
    ),
    (
        "settles for the first combination that covers, rather than the smallest",
        [
            (
                "        if covers:\n            return list(covers[0])",
                "        if covers:\n            return list(covers[-1])",
            ),
            (
                "    for size in range(1, len(admissible) + 1):",
                "    for size in range(len(admissible), 0, -1):",
            ),
        ],
    ),
    (
        "ignores whether the brief supplies the party an option makes you trust",
        [
            (
                '    for trusted in PRIMITIVES[primitive]["trusts"]:',
                '    return True\n    for trusted in PRIMITIVES[primitive]["trusts"]:',
            )
        ],
    ),
    (
        "assumes one key holder wherever there is a secret at all",
        [
            (
                "    return next(iter(owners)) if len(owners) == 1 else None",
                "    return next(iter(owners)) if owners else None",
            )
        ],
    ),
    (
        "sends private inputs to the computation in the clear",
        [
            (
                '    if not asset["must_not_learn"]:\n'
                '        return "plaintext"\n'
                '    return "share" if "mpc" in selection else "ciphertext"',
                '    return "plaintext"',
            )
        ],
    ),
    (
        "makes the first component responsible for every property",
        [
            (
                '    for node in graph["nodes"]:\n'
                '        for primitive in node["primitives"]:\n'
                '            if prop in PRIMITIVES[primitive]["provides"]:\n'
                '                return node["id"]\n'
                '    return ""',
                '    return graph["nodes"][0]["id"]',
            )
        ],
    ),
    (
        "records a property with no experiment behind it",
        [('            "evidence": by_property.get(prop, ""),', '            "evidence": "",')],
    ),
    (
        "records a property with no limitation",
        [
            (
                '            "limitation": _limitation(graph, component, prop),',
                '            "limitation": "",',
            )
        ],
    ),
    (
        "attacks only the property it happens to think of first",
        [
            (
                "    for prop, needed in required.items():\n"
                "        if not needed:\n"
                "            continue\n"
                "        kind, observable = ATTACK_KINDS[prop]",
                "    for prop, needed in list(required.items())[:1]:\n"
                "        if not needed:\n"
                "            continue\n"
                "        kind, observable = ATTACK_KINDS[prop]",
            )
        ],
    ),
    (
        "plans experiments that name nothing that would be observed",
        [
            (
                '    "correctness": ("replace", "the returned result does not match the honest computation"),',
                '    "correctness": ("replace", ""),',
            ),
            ('    "privacy": ("observe", "a party recovers an input it must not learn"),', '    "privacy": ("observe", ""),'),
        ],
    ),
    (
        # The mutation the last checkpoint exists for: a design decided once, handed back
        # unchanged when the facts move.
        "answers a changed brief with the design it already had",
        [
            (
                "    selection = select_primitive(brief)\n    graph = architecture(brief, selection)\n    return {",
                "    from fixtures.generate import brief as _fixed\n"
                '    brief = _fixed("joint-statistic")\n'
                "    selection = select_primitive(brief)\n"
                "    graph = architecture(brief, selection)\n"
                "    return {",
            )
        ],
    ),
)


def _load(source: str) -> types.ModuleType:
    module = types.ModuleType("mutant")
    exec(compile(source, "<mutant>", "exec"), module.__dict__)  # noqa: S102 - author tool
    return module


def main() -> int:
    baseline = check_design.run(_load(REFERENCE), SEED)
    if baseline:
        print(f"FAIL reference implementation does not pass the hidden tests: {baseline[:3]}")
        return 1
    print("PASS reference implementation passes the hidden tests")

    survivors: list[str] = []
    for name, substitutions in MUTATIONS:
        missing = [needle for needle, _ in substitutions if needle not in REFERENCE]
        if missing:
            print(f"SURVIVED {name} (the mutation no longer applies to the reference)")
            survivors.append(name)
            continue
        mutated = REFERENCE
        for needle, replacement in substitutions:
            mutated = mutated.replace(needle, replacement)
        try:
            failures = check_design.run(_load(mutated), SEED)
        except Exception as error:  # noqa: BLE001 - a mutation that crashes is caught
            failures = [f"raised {type(error).__name__}"]
        if failures:
            print(f"KILLED {name} ({failures[0]})")
        else:
            survivors.append(name)
            print(f"SURVIVED {name}")

    # The always-succeed verifier is the one defect that cannot be expressed as a broken
    # submission: it lives in the verifier. Assert end to end that a design which fails the
    # hidden tests is rejected, and that an unknown checkpoint is never credited.
    from verifier.server import evaluate  # noqa: PLC0415 - imported late, after sys.path

    if evaluate("selection", (ROOT / "starter" / "design.py").read_text(encoding="utf-8")):
        survivors.append("verifier accepts the unfinished starter")
        print("SURVIVED verifier accepts the unfinished starter")
    else:
        print("KILLED verifier accepts the unfinished starter")

    if evaluate("design-the-capstone", REFERENCE):
        survivors.append("verifier credits a checkpoint it does not implement")
        print("SURVIVED verifier credits a checkpoint it does not implement")
    else:
        print("KILLED verifier credits a checkpoint it does not implement")

    print()
    if survivors:
        print(f"{len(survivors)} mutation(s) survived. The hidden tests have a hole:")
        for name in survivors:
            print(f"  - {name}")
        return 1
    print(f"All {len(MUTATIONS) + 2} mutations killed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
