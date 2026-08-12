"""Public tests: one OT session opens, one AND adds up. That is all.

They never ask what the sender could learn from the request, whether the branch you
did not choose stays closed, or which share patterns a shortcut breaks on -- and
those three questions are the whole problem. The hidden verifier asks them.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "starter"))

from fixtures.generate import gmw_setting, ot_setting  # noqa: E402
import gmw  # noqa: E402

SEED = os.environ.get("FLAG_SEED", "local-dev-seed")


def test_request_is_a_group_element() -> None:
    cfg = ot_setting(SEED)
    p, q, g = cfg["p"], cfg["q"], cfg["g"]
    request = gmw.ot_request(pow(g, cfg["a"], p), 0, cfg["b"], p, q, g)
    assert isinstance(request, int) and 1 <= request < p
    assert pow(request, q, p) == 1


def test_the_chosen_branch_opens() -> None:
    cfg = ot_setting(SEED)
    p, q, g = cfg["p"], cfg["q"], cfg["g"]
    a_pub = pow(g, cfg["a"], p)
    choice = cfg["choice"]
    request = gmw.ot_request(a_pub, choice, cfg["b"], p, q, g)
    cts = gmw.ot_encrypt(cfg["a"], request, cfg["m0"], cfg["m1"], p, q, g)
    assert len(cts) == 2
    plain = gmw.ot_decrypt(cfg["b"], choice, a_pub, list(cts), p, q, g)
    assert plain == (cfg["m0"], cfg["m1"])[choice]


def test_the_and_adds_up_on_a_mixed_pattern() -> None:
    # x = x0 ^ x1 = 1 and y = y0 ^ y1 = 1, split so that both cross terms are live.
    cfg = gmw_setting(SEED)
    z0, z1 = gmw.gmw_and(
        1, 0, 0, 1,
        cfg["mask0"], cfg["mask1"],
        cfg["a01"], cfg["b01"], cfg["a10"], cfg["b10"],
        cfg["p"], cfg["q"], cfg["g"],
    )
    assert z0 in (0, 1) and z1 in (0, 1)
    assert (z0 ^ z1) == 1


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
    print("Nothing above asks what the request reveals, or whether the other branch")
    print("stays closed. Passing is not enough.")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
