"""Public tests: they show you the shape of the answer. They do not prove it.

They run one setting with one randomness and check the sum comes out. They never enumerate
the probability space, never sweep coalitions, never check that the transcript reconstructs
its own output, and never hand your suite a protocol it has not seen.

A protocol that opens every raw share passes every test in this file.
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from participant.lab import honest_sum, sample_randomness, setting_from_payload  # noqa: E402
from starter.capstone import (  # noqa: E402
    detects,
    evidence,
    experiment_privacy,
    measure,
    run,
    scope,
    share,
    threshold,
    view,
)

SEED = os.environ.get("FLAG_SEED", "local-dev-seed")


def _load_public_evidence() -> dict:
    """This deployment's setting and vocabulary -- what `show.py` prints, and what this file
    has always run its one honest round trip on.

    Issue 537/538 (Issue 543 option B2): this file used to import `fixtures.generate`
    directly. That module carries `hidden_settings` -- the six settings every checkpoint is
    graded on -- and it shipped in the same image as `tests/hidden/check_capstone.py`, which
    states phase by phase what each of those checkpoints accepts. So it does not ship in the
    `participant` Docker stage at all any more (see ../../Dockerfile). This deployment's own
    verifier is the only source for the public half now: `PUBLIC_EVIDENCE_JSON` when the
    Portal has already fetched it, or `VERIFIER_PUBLIC_URL` fetched directly when it has not.
    """
    injected = os.environ.get("PUBLIC_EVIDENCE_JSON")
    if injected:
        return json.loads(injected)
    verifier_public_url = os.environ.get("VERIFIER_PUBLIC_URL")
    if verifier_public_url:
        from urllib.request import urlopen

        with urlopen(verifier_public_url, timeout=10) as response:  # noqa: S310
            return json.loads(response.read().decode("utf-8"))
    # Neither is set: this only resolves when `fixtures/` is actually on disk, which is true
    # for a checkout (this file run directly, e.g. by scripts/ac26-w7-capstone-demo.test.ts)
    # and the verifier/author Docker stages, and never inside a built `participant` image --
    # so this branch does not reopen the leak above.
    from fixtures.generate import public_payload

    return public_payload(SEED)


PUBLIC_EVIDENCE = _load_public_evidence()
CLAIMABLE = tuple(PUBLIC_EVIDENCE["vocabulary"]["claimable"])


def _setting():
    return setting_from_payload(PUBLIC_EVIDENCE["setting"])


def _transcript():
    setting = _setting()
    return setting, run(setting, sample_randomness(SEED, setting))


def test_shares_add_back_to_the_value() -> None:
    setting = _setting()
    parts = share(4 % setting.modulus, setting.parties, setting.modulus, (1, 2))
    assert len(parts) == setting.parties
    assert sum(parts) % setting.modulus == 4 % setting.modulus


def test_the_sum_comes_out() -> None:
    setting, transcript = _transcript()
    assert transcript["output"] == honest_sum(setting)


def test_the_transcript_has_messages_and_opened_values() -> None:
    setting, transcript = _transcript()
    assert transcript["messages"]
    assert len(transcript["public"]) == setting.parties


def test_a_view_carries_the_output() -> None:
    _setting_, transcript = _transcript()
    assert view(transcript, (0,))["output"] == transcript["output"]


def test_the_threshold_is_stated() -> None:
    assert threshold(_setting().parties) >= 1


def test_the_scope_uses_the_known_vocabulary() -> None:
    manifest = scope(_setting())
    assert set(manifest.get("claims", [])) <= set(CLAIMABLE)


def test_the_privacy_experiment_reports_a_verdict() -> None:
    assert "passed" in experiment_privacy()


def test_your_suite_accepts_your_own_protocol() -> None:
    assert detects(run) is False


def test_the_measurement_counts_something() -> None:
    assert measure(_setting(), SEED)["messages"] >= 1


def test_the_bundle_covers_the_claims() -> None:
    setting = _setting()
    bundle = evidence(setting, SEED)
    for name in scope(setting).get("claims", []):
        assert name in bundle


def main() -> int:
    # `--only <substring>` backs `make test-one ID=...`: iterate on one behaviour
    # without re-reading the whole run.
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
        except Exception as error:  # noqa: BLE001 - a crash is a failure, reported as one
            failures += 1
            print(f"FAIL {name}: raised {type(error).__name__}")
    print()
    if selected == 0:
        print(f"no public test matched --only {only!r}")
        return 1
    print("public tests:", "all passed" if failures == 0 else f"{failures} failed")
    print()
    print("None of these enumerated the randomness, swept the coalitions, or checked that")
    print("the transcript reconstructs its own output. All three are graded.")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
