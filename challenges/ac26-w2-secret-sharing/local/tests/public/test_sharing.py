"""Public tests: the round trip on one setting, plus the shape of the line split. That is all.

They never ask whether a partial set of shares hides anything, nor whether one point
of the line does -- the only properties that make secret sharing worth doing. The
hidden verifier does.
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "starter"))

import sharing  # noqa: E402

SEED = os.environ.get("FLAG_SEED", "local-dev-seed")


def _load_public_evidence() -> dict:
    """This deployment's modulus, party count and drawn randomness -- what `show.py`
    prints, plus the secret this file has always had to hand `share()` to check a round
    trip at all.

    Issue 537/538 (Issue 543 option B2): this file used to import `fixtures.generate`
    directly. That module's `reference_shares` builds a correct split of this
    deployment's secret, and it shipped in the same image as
    `tests/hidden/check_sharing.py`, so it does not ship in the `participant` Docker
    stage at all any more (see ../../Dockerfile). This deployment's own verifier is the
    only source for the public half now: `PUBLIC_EVIDENCE_JSON` when the Portal has
    already fetched it, or `VERIFIER_PUBLIC_URL` fetched directly when it has not.
    """
    injected = os.environ.get("PUBLIC_EVIDENCE_JSON")
    if injected:
        return json.loads(injected)
    verifier_public_url = os.environ.get("VERIFIER_PUBLIC_URL")
    if verifier_public_url:
        from urllib.request import urlopen

        with urlopen(verifier_public_url, timeout=10) as response:  # noqa: S310
            return json.loads(response.read().decode("utf-8"))
    # Neither is set: this only resolves when `fixtures/` is actually on disk, which is
    # true for a checkout (this file run directly, e.g. by
    # scripts/ac26-w2-secret-sharing.test.ts) and the verifier/author Docker stages, and
    # never inside a built `participant` image -- so this branch does not reopen the
    # leak above.
    from fixtures.generate import public_payload

    return public_payload(SEED)


PUBLIC = _load_public_evidence()


def _shares() -> list[int]:
    par = PUBLIC["params"]
    return sharing.share(
        PUBLIC["secret"],
        par["n"],
        par["p"],
        PUBLIC["shareRandomness"],
    )


def _line_points() -> list:
    return sharing.share_line(PUBLIC["secret"], PUBLIC["params"]["p"], PUBLIC["lineRandomness"])


def test_share_returns_one_value_per_party() -> None:
    assert len(_shares()) == PUBLIC["params"]["n"]


def test_shares_are_field_elements() -> None:
    p = PUBLIC["params"]["p"]
    for value in _shares():
        assert isinstance(value, int) and 0 <= value < p


def test_the_full_set_reconstructs_the_secret() -> None:
    p = PUBLIC["params"]["p"]
    assert sharing.reconstruct(_shares(), p) == PUBLIC["secret"] % p


def test_rerandomize_returns_one_value_per_party() -> None:
    par = PUBLIC["params"]
    fresh = sharing.rerandomize(
        _shares(),
        par["p"],
        PUBLIC["rerandomizationRandomness"],
    )
    assert len(fresh) == par["n"]


def test_share_line_returns_three_points_at_x_1_2_3() -> None:
    p = PUBLIC["params"]["p"]
    points = _line_points()
    assert isinstance(points, list) and len(points) == 3, "expected three [x, y] points"
    for party, point in zip((1, 2, 3), points):
        assert isinstance(point, (list, tuple)) and len(point) == 2, "each point is [x, y]"
        x, y = point
        assert x == party, "party 1, 2, 3 hold the points at x = 1, 2, 3, in that order"
        assert isinstance(y, int) and 0 <= y < p, "y must be inside [0, modulus)"


def test_two_points_of_the_line_walk_back_to_the_secret() -> None:
    p = PUBLIC["params"]["p"]
    points = _line_points()
    assert isinstance(points, list) and len(points) == 3, "expected three [x, y] points"
    recovered = sharing.reconstruct_line([list(points[0]), list(points[1])], p)
    assert recovered == PUBLIC["secret"] % p, "parties 1 and 2 together should walk back to the secret"


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
    print("Nothing above asks whether n-1 shares hide the secret, whether the other pairs of")
    print("points walk back to it, or whether one point alone hides it. Passing is not enough.")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
