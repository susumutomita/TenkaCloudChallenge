"""Public tests: shape, and one round trip per operation on a single setting.

They do not check the composed expression, and they never contrast a right answer
with the plausible wrong one. The hidden verifier does both.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "starter"))

from fixtures.generate import OPERATIONS, reconstruct, setting, shares_of  # noqa: E402
import linear  # noqa: E402

SEED = os.environ.get("FLAG_SEED", "local-dev-seed")
CFG = setting(SEED)


def _sx() -> list[int]:
    return shares_of(SEED, "public-x", CFG["x"], CFG["n"], CFG["p"])


def _sy() -> list[int]:
    return shares_of(SEED, "public-y", CFG["y"], CFG["n"], CFG["p"])


def test_add_shares_reconstructs_to_the_sum() -> None:
    out = linear.add_shares(_sx(), _sy(), CFG["p"])
    assert reconstruct(out, CFG["p"]) == (CFG["x"] + CFG["y"]) % CFG["p"]


def test_mul_constant_reconstructs_to_the_product() -> None:
    out = linear.mul_constant(_sx(), CFG["c"], CFG["p"])
    assert reconstruct(out, CFG["p"]) == (CFG["x"] * CFG["c"]) % CFG["p"]


def test_add_constant_returns_one_value_per_party() -> None:
    assert len(linear.add_constant(_sx(), CFG["c"], CFG["p"])) == CFG["n"]


def test_communication_rounds_answers_every_operation() -> None:
    for operation in OPERATIONS:
        assert isinstance(linear.communication_rounds(operation), int)


def main() -> int:
    only = ""
    if "--only" in sys.argv:
        index = sys.argv.index("--only")
        only = sys.argv[index + 1] if index + 1 < len(sys.argv) else ""
    failures = 0
    selected = 0
    for name, fn in sorted(globals().items()):
        if not name.startswith("test_") or not callable(fn):
            continue
        if only and only not in name:
            continue
        selected += 1
        try:
            fn()
            print(f"PASS {name}")
        except AssertionError as error:
            failures += 1
            print(f"FAIL {name}: {error or 'assertion failed'}")
        except Exception as error:  # noqa: BLE001
            failures += 1
            print(f"FAIL {name}: raised {type(error).__name__}")
    print()
    if selected == 0:
        print(f"no public test matched --only {only!r}")
        return 1
    print("public tests:", "all passed" if failures == 0 else f"{failures} failed")
    print()
    print("Note what is missing above: nothing checks what add_constant reconstructs to.")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
