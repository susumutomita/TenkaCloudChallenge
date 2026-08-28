"""Mutation suite: break the reference on purpose, assert the hidden tests notice."""

from __future__ import annotations

import sys
import types
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from tests.hidden.check_policy import run

SEED = "mutation-suite-seed"
REFERENCE = (Path(__file__).resolve().parent / "reference" / "policy.py").read_text("utf-8")

MUTATIONS: list[tuple[str, str]] = [
    (
        "intended circuit ships with only half the is-zero gadget",
        REFERENCE.replace(
            '    {"id": "c-iszero-b", "kind": "iszero_b", "value": "revoked", "out": "ok"},\n', ""
        ),
    ),
    (
        "audit counts constraints instead of identifying them",
        REFERENCE.replace(
            '''    present = {str(c["id"]) for c in circuit}
    return sorted(str(c["id"]) for c in INTENDED if str(c["id"]) not in present)''',
            '    return [] if len(circuit) == len(INTENDED) else ["c-iszero-a"]',
        ),
    ),
    (
        "forgery is hard-coded for one of the two possible drops",
        REFERENCE.replace(
            '''    if "c-iszero-b" in missing:
        # A alone cannot stop ok = 1 on a revoked credential: pick inv = 0.
        return {"revoked": revoked, "inv": 0, "ok": 1, "issuer_ok": issuer_ok, "granted": issuer_ok}
    # B never reads inv. Keep the revoked credential's policy outcome honest but
    # replace its seeded inverse with zero; the surviving circuit accepts a value
    # that the missing A constraint rejects.
    return {"revoked": revoked, "inv": 0, "ok": 0, "issuer_ok": issuer_ok, "granted": 0}''',
            '    return {"revoked": revoked, "inv": 0, "ok": 1, "issuer_ok": issuer_ok, "granted": issuer_ok}',
        ),
    ),
    (
        "forgery satisfies the intended circuit too, so it claims nothing false",
        REFERENCE.replace(
            '''    if "c-iszero-b" in missing:
        # A alone cannot stop ok = 1 on a revoked credential: pick inv = 0.
        return {"revoked": revoked, "inv": 0, "ok": 1, "issuer_ok": issuer_ok, "granted": issuer_ok}
    # B never reads inv. Keep the revoked credential's policy outcome honest but
    # replace its seeded inverse with zero; the surviving circuit accepts a value
    # that the missing A constraint rejects.
    return {"revoked": revoked, "inv": 0, "ok": 0, "issuer_ok": issuer_ok, "granted": 0}''',
            '''    inv = pow(revoked, -1, p) if revoked else 0
    return {"revoked": revoked, "inv": inv, "ok": 0, "issuer_ok": issuer_ok, "granted": 0}''',
        ),
    ),
    (
        "repair adds every constraint twice instead of the minimum",
        REFERENCE.replace(
            '''    present = {str(c["id"]) for c in circuit}
    return [dict(c) for c in circuit] + [
        dict(c) for c in INTENDED if str(c["id"]) not in present
    ]''',
            '    return [dict(c) for c in circuit] + [dict(c) for c in INTENDED]',
        ),
    ),
    (
        "repair returns the circuit untouched",
        REFERENCE.replace(
            '''    present = {str(c["id"]) for c in circuit}
    return [dict(c) for c in circuit] + [
        dict(c) for c in INTENDED if str(c["id"]) not in present
    ]''',
            "    return [dict(c) for c in circuit]",
        ),
    ),
]


def _load(source: str) -> types.ModuleType:
    module = types.ModuleType("mut_policy")
    exec(compile(source, "<mutation>", "exec"), module.__dict__)  # noqa: S102 - our own fixtures
    return module


def main() -> int:
    if run(_load(REFERENCE), SEED):
        print("FAIL reference implementation does not pass the hidden tests")
        return 1
    print("PASS reference implementation passes the hidden tests")

    survivors: list[str] = []
    for name, source in MUTATIONS:
        failures = run(_load(source), SEED)
        if failures:
            print(f"KILLED {name} ({failures[0]})")
        else:
            survivors.append(name)
            print(f"SURVIVED {name}")

    from verifier.server import evaluate  # noqa: PLC0415 - imported after sys.path

    if evaluate("root-cause", '{"missingConstraintId": "c-grant", "manipulatedSignals": []}')[0]:
        survivors.append("verifier accepts a wrong root cause")
        print("SURVIVED verifier accepts a wrong root cause")
    else:
        print("KILLED verifier accepts a wrong root cause")

    print()
    if survivors:
        print(f"{len(survivors)} mutation(s) survived:")
        for name in survivors:
            print(f"  - {name}")
        return 1
    print(f"All {len(MUTATIONS) + 1} mutations killed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
