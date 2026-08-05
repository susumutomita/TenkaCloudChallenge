"""Public tests: the round trip on one setting. That is all.

They never ask whether a partial set of shares hides anything, which is the only
property that makes secret sharing worth doing. The hidden verifier does.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "starter"))

from fixtures.generate import (  # noqa: E402
    rerandomization_randomness,
    setting,
    share_randomness,
)
import sharing  # noqa: E402

SEED = os.environ.get("FLAG_SEED", "local-dev-seed")


def _shares() -> list[int]:
    cfg = setting(SEED)
    return sharing.share(
        cfg["secret"],
        cfg["n"],
        cfg["p"],
        share_randomness(SEED, "public", cfg["n"] - 1, cfg["p"], cfg["secret"]),
    )


def test_share_returns_one_value_per_party() -> None:
    cfg = setting(SEED)
    assert len(_shares()) == cfg["n"]


def test_shares_are_field_elements() -> None:
    cfg = setting(SEED)
    for value in _shares():
        assert isinstance(value, int) and 0 <= value < cfg["p"]


def test_the_full_set_reconstructs_the_secret() -> None:
    cfg = setting(SEED)
    assert sharing.reconstruct(_shares(), cfg["p"]) == cfg["secret"] % cfg["p"]


def test_rerandomize_returns_one_value_per_party() -> None:
    cfg = setting(SEED)
    fresh = sharing.rerandomize(
        _shares(),
        cfg["p"],
        rerandomization_randomness(SEED, "rr", cfg["n"] - 1, cfg["p"]),
    )
    assert len(fresh) == cfg["n"]


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
    print("Nothing above asks whether n-1 shares hide the secret. Passing is not enough.")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
