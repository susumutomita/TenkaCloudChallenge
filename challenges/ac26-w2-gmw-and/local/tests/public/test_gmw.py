"""Public test: the reconstructed truth table, and nothing about the protocol."""

from __future__ import annotations

import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SUBMISSION = Path(os.environ.get("SUBMISSION_DIR", str(ROOT / "starter")))
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(SUBMISSION))

import gmw  # noqa: E402
from fixtures.generate import IdealOt, gate_cases, output_values  # noqa: E402

SEED = os.environ.get("FLAG_SEED", "local-dev-seed")


def check_truth_table() -> str:
    for item in gate_cases(SEED, "public"):
        output = output_values(
            gmw.and_shared_bits(
                item.x_shares, item.y_shares, item.masks, IdealOt()
            )
        )
        if output is None:
            return "the gate did not return two bit shares"
        if output[0] ^ output[1] != (item.x & item.y):
            return f"the reconstructed AND is wrong for ({item.x}, {item.y})"
    return ""


CHECKS = (("truth-table", check_truth_table),)


def main(argv: list[str]) -> int:
    only = argv[argv.index("--only") + 1] if "--only" in argv else ""
    failures = 0
    for name, check in CHECKS:
        if only and only not in name:
            continue
        try:
            message = check()
        except Exception as error:  # noqa: BLE001
            message = f"raised {type(error).__name__}"
        if message:
            print(f"FAIL {name}: {message}")
            failures += 1
        else:
            print(f"ok   {name}")
    if failures:
        print(f"\npublic tests: {failures} failed")
    else:
        print("\npublic tests: all passed")
        print("The truth table says nothing about openings, party boundaries, or OT use.")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
