"""Public tests: shape, and the masking round trip on one setting.

They never check what `combine` reconstructs to. Read that sentence again before
deciding you are done.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "starter"))

from fixtures.generate import reconstruct, setting, shares_of, triple_shares  # noqa: E402
import beaver  # noqa: E402

SEED = os.environ.get("FLAG_SEED", "local-dev-seed")
CFG = setting(SEED)
TRIPLE = triple_shares(SEED, "public")


def _sx() -> list[int]:
    return shares_of(SEED, "public-x", CFG["x"], CFG["n"], CFG["p"])


def test_mask_reconstructs_to_value_minus_mask() -> None:
    out = beaver.mask(_sx(), TRIPLE["a"], CFG["p"])
    assert reconstruct(out, CFG["p"]) == (CFG["x"] - CFG["a"]) % CFG["p"]


def test_open_value_returns_the_shared_value() -> None:
    assert beaver.open_value(_sx(), CFG["p"]) == CFG["x"] % CFG["p"]


def test_combine_returns_one_value_per_party() -> None:
    out = beaver.combine(TRIPLE["c"], TRIPLE["a"], TRIPLE["b"], 1, 1, CFG["p"])
    assert len(out) == CFG["n"]


def test_rounds_is_an_integer() -> None:
    assert isinstance(beaver.rounds(), int)


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
    print("Note what is absent: nothing here checks what combine reconstructs to.")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
