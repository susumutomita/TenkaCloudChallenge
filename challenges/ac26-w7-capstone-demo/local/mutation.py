"""Mutation suite: break the reference on purpose and assert the hidden tests notice.

A green run against a correct capstone proves nothing about whether the tests would catch a
wrong one. In this problem the wrong ones are the interesting group: most of them compute the
right sum, and several produce a transcript that looks entirely ordinary.

Run inside the image (or in CI):  python mutation.py
Exit code 0 means every mutation was killed.
"""

from __future__ import annotations

import sys
import types
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))

from tests.hidden import check_capstone  # noqa: E402

REFERENCE = (ROOT / "reference" / "capstone.py").read_text(encoding="utf-8")
SEED = "mutation-suite-seed"

#: (name, [(needle, replacement), ...]). Every needle must be present in the reference, so a
#: mutation that stopped applying is reported rather than silently passing.
#:
#: Two candidates were dropped as equivalent mutants, both confirmed by trying them:
#:
#: - Narrowing `experiment_privacy` to the single coalition `(0,)`. Against a *correct*
#:   protocol every coalition returns the same verdict, so no test can tell the narrowed
#:   experiment from the full sweep. What protects that ground instead is `check_privacy`,
#:   which runs its own sweep rather than trusting the submission's experiment, and
#:   `check_detect`, which hands the suite a protocol that leaks only to party 2.
#: - Dropping the `% modulus` from the drawn shares in `share`. The randomness contract
#:   fixes every draw in `[0, modulus)`, so the reduction is a no-op on every input the
#:   problem can produce. Killing it would mean inventing a robustness requirement the
#:   starter never states, which is a worse trade than one fewer mutation.
MUTATIONS: tuple[tuple[str, list[tuple[str, str]]], ...] = (
    (
        "draws every share instead of leaving one to balance",
        [
            (
                "    parts = [draw % modulus for draw in draws[: parties - 1]]\n"
                "    parts.append((value - sum(parts)) % modulus)",
                "    parts = [draw % modulus for draw in draws[: parties - 1]]\n"
                "    parts.append(value % modulus)",
            )
        ],
    ),
    (
        "marks something the build cannot do as claimed anyway",
        [('            "claimed": False,', '            "claimed": True,')],
    ),
    (
        # Right answer, ordinary-looking transcript, and every input recoverable.
        "opens each party's first share instead of the sum it is holding",
        [
            (
                '        {"kind": "partial", "from": party, "value": sum(parts) % modulus}\n'
                "        for party, parts in enumerate(held)",
                '        {"kind": "partial", "from": party, "value": parts[0] % modulus}\n'
                "        for party, parts in enumerate(held)",
            )
        ],
    ),
    (
        "gives every party the same randomness",
        [
            (
                "        start, end = setting.slice_for(party)\n"
                "        parts = share(value, setting.parties, modulus, randomness[start:end])",
                "        start, end = setting.slice_for(0)\n"
                "        parts = share(value, setting.parties, modulus, randomness[start:end])",
            )
        ],
    ),
    (
        "puts messages meant for other parties into a coalition's view",
        [
            (
                '            for message in transcript["messages"]\n'
                '            if message["to"] in members',
                '            for message in transcript["messages"]',
            )
        ],
    ),
    (
        "drops the opened values from the view",
        [('        "public": tuple(entry["value"] for entry in transcript["public"]),', '        "public": (),')],
    ),
    (
        "states the threshold one party too high",
        [("    return parties - 1", "    return parties")],
    ),
    (
        "names an input the coalition is too small to know",
        [
            (
                "    if len(set(coalition)) < threshold(setting.parties):\n        return None",
                "    pass",
            )
        ],
    ),
    (
        "claims a property the construction does not provide",
        [('        "claims": sorted(PROVIDED),', '        "claims": sorted(PROVIDED | NOT_PROVIDED),')],
    ),
    (
        "leaves what the build cannot do out of the manifest",
        [('        "non_goals": sorted(NOT_PROVIDED),', '        "non_goals": [],')],
    ),
    (
        "measures the round count from the description rather than the run",
        [('        "rounds": transcript["rounds"],', '        "rounds": 3,')],
    ),
    (
        "reports a message count nobody counted",
        [('        "messages": len(transcript["messages"]),', '        "messages": 4,')],
    ),
    (
        "measures without saying in what units",
        [
            (
                '        "unit": "messages are point-to-point field elements; opened values are broadcast",',
                '        "unit": "",',
            )
        ],
    ),
    (
        "reports a suite that never finds anything",
        [("def detects(protocol: Protocol) -> bool:", "def detects(protocol: Protocol) -> bool:\n    return False")],
    ),
    (
        "checks only the answer, never the transcript",
        [
            (
                "            if not _well_formed(transcript, setting):\n                return True",
                "            pass",
            )
        ],
    ),
    (
        "leaves the non-goals out of the evidence bundle",
        [("    for name in sorted(NOT_PROVIDED):", "    for name in []:")],
    ),
    (
        "records a claim with no experiment behind it",
        [('            "experiment": correctness["id"],', '            "experiment": "",')],
    ),
    (
        "records a claim whose experiment did not pass",
        [('            "verdict": correctness["passed"],', '            "verdict": None,')],
    ),
    (
        "samples the randomness instead of enumerating it",
        [
            (
                "                    repr(view(run(setting, randomness), coalition))\n"
                "                    for randomness in randomness_space(setting)",
                "                    repr(view(run(setting, randomness), coalition))\n"
                "                    for randomness in list(randomness_space(setting))[:50]",
            )
        ],
    ),
)


def _load(source: str) -> types.ModuleType:
    module = types.ModuleType("mutant")
    exec(compile(source, "<mutant>", "exec"), module.__dict__)  # noqa: S102 - author tool
    return module


def main() -> int:
    baseline = check_capstone.run(_load(REFERENCE), SEED)
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
            failures = check_capstone.run(_load(mutated), SEED)
        except Exception as error:  # noqa: BLE001 - a mutation that crashes is caught
            failures = [f"raised {type(error).__name__}"]
        if failures:
            print(f"KILLED {name} ({failures[0]})")
        else:
            survivors.append(name)
            print(f"SURVIVED {name}")

    # The always-succeed verifier is the one defect that cannot be expressed as a broken
    # submission: it lives in the verifier.
    from verifier.server import evaluate  # noqa: PLC0415 - imported late, after sys.path

    if evaluate("privacy", (ROOT / "starter" / "capstone.py").read_text(encoding="utf-8")):
        survivors.append("verifier accepts the unfinished starter")
        print("SURVIVED verifier accepts the unfinished starter")
    else:
        print("KILLED verifier accepts the unfinished starter")

    if evaluate("build-the-capstone", REFERENCE):
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
