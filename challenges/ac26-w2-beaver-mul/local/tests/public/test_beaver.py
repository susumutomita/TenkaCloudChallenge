"""Public tests: shape, and the masking round trip on one setting.

They never check what `combine` reconstructs to. Read that sentence again before
deciding you are done.
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "starter"))

import beaver  # noqa: E402

SEED = os.environ.get("FLAG_SEED", "local-dev-seed")


def _load_public_evidence() -> dict:
    """This deployment's modulus, party count, triple shares and shares of x -- what
    `show.py` prints, plus the two values this file has always compared `mask` against.

    Issue 537/538 (Issue 543 option B2): this file used to import `fixtures.generate`
    directly. That module's `setting()` returns x, y, a, b and c in the clear, and it
    shipped in the same image as `tests/hidden/check_beaver.py`, so it does not ship in
    the `participant` Docker stage at all any more (see ../../Dockerfile). This
    deployment's own verifier is the only source for the public half now:
    `PUBLIC_EVIDENCE_JSON` when the Portal has already fetched it, or
    `VERIFIER_PUBLIC_URL` fetched directly when it has not.
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
    # scripts/ac26-w2-beaver-mul.test.ts) and the verifier/author Docker stages, and
    # never inside a built `participant` image -- so this branch does not reopen the
    # leak above.
    from fixtures.generate import public_payload

    return public_payload(SEED)


PUBLIC = _load_public_evidence()
TRIPLE = PUBLIC["triple"]


def _sx() -> list[int]:
    return list(PUBLIC["xShares"])


def test_mask_reconstructs_to_value_minus_mask() -> None:
    p = PUBLIC["params"]["p"]
    out = beaver.mask(_sx(), TRIPLE["a"], p)
    assert sum(out) % p == (PUBLIC["x"] - PUBLIC["a"]) % p


def test_open_value_returns_the_shared_value() -> None:
    p = PUBLIC["params"]["p"]
    assert beaver.open_value(_sx(), p) == PUBLIC["x"] % p


def test_combine_returns_one_value_per_party() -> None:
    par = PUBLIC["params"]
    out = beaver.combine(TRIPLE["c"], TRIPLE["a"], TRIPLE["b"], 1, 1, par["p"])
    assert len(out) == par["n"]


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
