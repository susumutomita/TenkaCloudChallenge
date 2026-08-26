"""Public tests: shape, and one round trip per operation on a single setting.

They do not check the composed expression, and they never contrast a right answer
with the plausible wrong one. The hidden verifier does both.
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "starter"))

import linear  # noqa: E402

SEED = os.environ.get("FLAG_SEED", "local-dev-seed")


def _load_public_evidence() -> dict[str, object]:
    """This deployment's setting, shares and operation names -- the same things
    `show.py` and the Portal print.

    Issue 543/537: this file used to import `fixtures.generate` directly. That module
    also derives what the `no-communication` checkpoint is graded against, as plain
    module data, so it does not ship in the `participant` Docker stage at all any more
    (see ../../Dockerfile). This
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
    # scripts/ac26-w2-linear-shares.test.ts) and the verifier/author Docker stages, and
    # never inside a built `participant` image -- so this branch existing does not
    # reopen Issue 543/537's leak.
    from fixtures.generate import public_payload

    return public_payload(SEED)


PUBLIC = _load_public_evidence()
CFG = PUBLIC["setting"]
OPERATIONS = PUBLIC["operations"]


def reconstruct(shares: list[int], p: int) -> int:
    """Add the shares up modulo p. The whole point of an additive sharing -- and no
    longer imported from `fixtures.generate`, which does not ship here (see above)."""
    return sum(shares) % p


def _sx() -> list[int]:
    return list(PUBLIC["sharesOfX"])


def _sy() -> list[int]:
    return list(PUBLIC["sharesOfY"])


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
