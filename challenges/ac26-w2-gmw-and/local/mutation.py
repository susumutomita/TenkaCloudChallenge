"""Measure how often final-output tests miss a broken GMW construction.

Seven of eight mutations keep the complete AND truth table correct. The audit kills
them because they reconstruct an input, cross a party boundary, skip/reuse an OT
session, reuse a mask, or return a fixed plaintext sharing.
"""

from __future__ import annotations

import sys
import types
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))

from tests.hidden import check_gmw  # noqa: E402

REFERENCE = (ROOT / "reference" / "gmw.py").read_text(encoding="utf-8")
SEED = "mutation-suite-seed"

BODY = """    x0 = ot_secrets.local(x_shares, 0)
    y0 = ot_secrets.local(y_shares, 0)
    x1 = ot_secrets.local(x_shares, 1)
    y1 = ot_secrets.local(y_shares, 1)
    r01 = ot_secrets.local(masks, 0)
    r10 = ot_secrets.local(masks, 1)

    cross_01_for_party_1 = ot_secrets.transfer(
        0, 0, 1, (r01, r01 ^ x0), y1
    )
    cross_10_for_party_0 = ot_secrets.transfer(
        1, 1, 0, (r10, r10 ^ x1), y0
    )

    z0 = (x0 & y0) ^ r01 ^ cross_10_for_party_0
    z1 = (x1 & y1) ^ cross_01_for_party_1 ^ r10
    return (z0, z1)"""

MUTATIONS: tuple[tuple[str, list[tuple[str, str]]], ...] = (
    (
        "reconstructs both inputs and reshares the plaintext AND",
        [
            (
                BODY,
                """    x = x_shares[0] ^ x_shares[1]
    y = y_shares[0] ^ y_shares[1]
    bit = x & y
    r = masks[0]
    return (r, r ^ bit)""",
            )
        ],
    ),
    (
        "uses the runtime's forbidden open shortcut",
        [
            (
                BODY,
                """    x = ot_secrets.open(x_shares)
    y = ot_secrets.open(y_shares)
    r = ot_secrets.local(masks, 0)
    return (r, r ^ (x & y))""",
            )
        ],
    ),
    (
        "computes both cross terms directly without OT",
        [
            (
                BODY,
                """    x0 = ot_secrets.local(x_shares, 0)
    y0 = ot_secrets.local(y_shares, 0)
    x1 = ot_secrets.local(x_shares, 1)
    y1 = ot_secrets.local(y_shares, 1)
    r = ot_secrets.local(masks, 0)
    bit = (x0 & y0) ^ (x0 & y1) ^ (x1 & y0) ^ (x1 & y1)
    return (r, r ^ bit)""",
            )
        ],
    ),
    (
        "uses one OT and computes the other cross term directly",
        [
            (
                """    cross_10_for_party_0 = ot_secrets.transfer(
        1, 1, 0, (r10, r10 ^ x1), y0
    )""",
                "    cross_10_for_party_0 = r10 ^ (x1 & y0)",
            )
        ],
    ),
    (
        "reuses OT session zero for the second cross term",
        [
            (
                """    cross_10_for_party_0 = ot_secrets.transfer(
        1, 1, 0, (r10, r10 ^ x1), y0
    )""",
                """    cross_10_for_party_0 = ot_secrets.transfer(
        0, 1, 0, (r10, r10 ^ x1), y0
    )""",
            )
        ],
    ),
    (
        "reuses party zero's mask for both cross terms",
        [
            (
                "    r10 = ot_secrets.local(masks, 1)",
                "    r10 = ot_secrets.local(masks, 0)",
            )
        ],
    ),
    (
        "reconstructs the output into a fixed public slot",
        [
            (
                "    return (z0, z1)",
                "    return (0, z0 ^ z1)",
            )
        ],
    ),
    (
        "drops party one's local product",
        [
            (
                "    z1 = (x1 & y1) ^ cross_01_for_party_1 ^ r10",
                "    z1 = cross_01_for_party_1 ^ r10",
            )
        ],
    ),
)

FINAL_OUTPUT_BLIND = 7


def _load(source: str):
    module = types.ModuleType("mut_gmw")
    exec(compile(source, "<mutation>", "exec"), module.__dict__)  # noqa: S102
    return module


def main() -> int:
    reference = _load(REFERENCE)
    baseline = check_gmw.run(reference, SEED)
    if baseline:
        print(f"FAIL reference implementation does not pass: {baseline[0]}")
        return 1
    print("PASS reference implementation passes the hidden checks")

    survivors = 0
    blind = 0
    for name, substitutions in MUTATIONS:
        missing = [needle for needle, _ in substitutions if needle not in REFERENCE]
        if missing:
            print(f"SURVIVED {name} (mutation no longer applies)")
            survivors += 1
            continue
        source = REFERENCE
        for needle, replacement in substitutions:
            source = source.replace(needle, replacement)
        try:
            module = _load(source)
            failures = check_gmw.run(module, SEED)
            final_only = not check_gmw.check_delivery(module, SEED)
        except Exception as error:  # noqa: BLE001
            failures = [f"raised {type(error).__name__}"]
            final_only = False
        blind += int(final_only)
        if failures:
            marker = " [final-output-blind]" if final_only else ""
            print(f"KILLED{marker} {name} ({failures[0]})")
        else:
            print(f"SURVIVED {name}")
            survivors += 1

    from verifier.server import evaluate  # noqa: PLC0415

    inert = "\n".join(
        [
            "def and_shared_bits(x_shares, y_shares, masks, ot_secrets):",
            "    x = x_shares[0] ^ x_shares[1]",
            "    y = y_shares[0] ^ y_shares[1]",
            "    return (masks[0], masks[0] ^ (x & y))",
        ]
    )
    if evaluate("privacy-audit", inert):
        print("SURVIVED verifier credits the reconstruct-and-reshare shortcut")
        survivors += 1
    else:
        print("KILLED verifier credits the reconstruct-and-reshare shortcut")

    print(f"FINAL-OUTPUT-BLIND {blind} of {len(MUTATIONS)}")
    if blind != FINAL_OUTPUT_BLIND:
        print(
            f"Expected {FINAL_OUTPUT_BLIND} final-output-blind mutations; "
            "update the tests and documentation together."
        )
        return 1
    if survivors:
        print(f"{survivors} mutation(s) survived.")
        return 1
    print(f"All {len(MUTATIONS) + 1} mutations killed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
