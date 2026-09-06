"""Public arithmetic examples and return shapes, evaluated by a trusted test parent.

The hidden verifier additionally checks other settings and composed operations.
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from participant.execution import LearnerError, LearnerSession  # noqa: E402

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


PUBLIC = {}
CFG = {}
OPERATIONS = []
linear = None


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


def test_add_constant_reconstructs_small_example() -> None:
    # 5+6+0 has remainder 4; after adding 2 the total must have remainder 6.
    out = linear.add_constant([5, 6, 0], 2, 7)
    assert isinstance(out, list) and len(out) == 3, 'return one value per participant'
    assert all(type(value) is int and 0 <= value < 7 for value in out), 'return remainders 0 through 6'
    assert reconstruct(out, 7) == 6, 'the total after adding 2 must have remainder 6'


def test_communication_rounds_answers_every_operation() -> None:
    for operation in OPERATIONS:
        result = linear.communication_rounds(operation)
        assert type(result) is int and result >= 0, "return a nonnegative integer"


def run_cases(module, public, only=''):
    global linear, PUBLIC, CFG, OPERATIONS
    linear, PUBLIC = module, public
    CFG, OPERATIONS = public['setting'], public['operations']
    transcript = []
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
            transcript.append(f"PASS {name}")
        except AssertionError as error:
            failures += 1
            transcript.append(f"FAIL {name}: {error or 'assertion failed'}")
        except Exception as error:  # noqa: BLE001
            failures += 1
            transcript.append(f"FAIL {name}: raised {type(error).__name__}")
    if selected == 0:
        return False, f'no public test matched --only {only!r}'
    transcript.append('public tests: ' + ('all passed' if failures == 0 else f'{failures} failed'))
    return failures == 0, '\n'.join(transcript)


def main() -> int:
    only = ''
    if '--only' in sys.argv:
        index = sys.argv.index('--only')
        only = sys.argv[index + 1] if index + 1 < len(sys.argv) else ''
    directory = Path(os.environ.get('SUBMISSION_DIR', str(ROOT / 'starter')))
    sources = {'linear.py': (directory / 'linear.py').read_text()}
    learner = LearnerSession(sources)
    try:
        public = _load_public_evidence()
        with learner:
            passed, output = run_cases(learner.module(), public, only)
        print(output)
        return 0 if passed else 1
    except (LearnerError, OSError, ValueError):
        print(learner.initialization_diagnostic or 'The submitted functions could not be evaluated.')
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
