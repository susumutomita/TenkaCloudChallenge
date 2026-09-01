"""Public tests: they show you the shape of the answer. They do not prove it.

Read them, then read `misconception.public-tests-are-complete` in the README. These
tests pass for at least one implementation that the hidden tests reject.
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SUBMISSION_DIR = os.environ.get("SUBMISSION_DIR")
sys.path.insert(0, str(ROOT))
sys.path.insert(0, SUBMISSION_DIR or str(ROOT / "starter"))

from counter import advance  # noqa: E402

SEED = os.environ.get("FLAG_SEED", "local-dev-seed")


def _load_public_evidence() -> dict[str, object]:
    """This deployment's public evidence -- the case, the walkback, and the corrupted
    trace `show.py` and the Portal both print.

    Issue 543/537: this file used to import `fixtures.generate` directly. `fixtures/`
    does not ship in the `participant` Docker stage at all any more (see
    ../../Dockerfile) -- keeping the seed-keyed generator reachable here is what let a
    learner skip straight past `first-broken` with nothing but their own container's
    `FLAG_SEED`, even after the checkpoint's own answer moved into
    `verifier/expected.py`. This deployment's own verifier is the only source for this
    evidence now: `PUBLIC_EVIDENCE_JSON` when `participant/server.py` has already
    fetched it (the Portal path, and the sandboxed run `make test` also uses), or
    `VERIFIER_PUBLIC_URL` fetched directly when neither is true.
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
    # scripts/ac26-bridge-experiment.test.ts) or the verifier/author Docker stage, and
    # never true inside a built `participant` image -- so this branch existing does not
    # reopen Issue 543/537's leak.
    from fixtures.generate import public_payload

    return public_payload(SEED)


PUBLIC = _load_public_evidence()
CASE = PUBLIC["predict"]


def _assert_contract_shape_and_range(case: dict[str, int]) -> None:
    numbers = advance(case["start"], case["step"], case["rounds"], case["modulus"])
    assert len(numbers) == case["rounds"], "the list must have exactly one number per round"
    for value in numbers:
        assert 0 <= value < case["modulus"], "every number must be 0 or more and below modulus"


def test_the_list_has_one_number_per_round() -> None:
    assert len(advance(**CASE)) == CASE["rounds"], "the list must have exactly one number per round"


def test_zero_rounds_is_empty() -> None:
    assert advance(CASE["start"], CASE["step"], 0, CASE["modulus"]) == [], "rounds == 0 must give an empty list"


def test_every_entry_is_in_range() -> None:
    _assert_contract_shape_and_range(CASE)


def test_negative_step_stays_in_range() -> None:
    _assert_contract_shape_and_range({**CASE, "start": 0, "step": -CASE["step"]})


def test_start_larger_than_modulus_stays_in_range() -> None:
    _assert_contract_shape_and_range({**CASE, "start": CASE["start"] + CASE["modulus"] * 3})


def test_step_larger_than_modulus_stays_in_range() -> None:
    _assert_contract_shape_and_range({**CASE, "step": CASE["step"] + CASE["modulus"] * 3})


def test_first_entry_is_start_plus_step() -> None:
    numbers = advance(**CASE)
    assert numbers[0] == (CASE["start"] + CASE["step"]) % CASE["modulus"], "the first number must be start + step, reduced into the ring"


# Three invariants used to live here as sweeps over hundreds of seeds unrelated to this
# deployment's own FLAG_SEED: "the corrupted trace always has exactly one entry outside
# [0, modulus)", "predict never answers itself", and "the walkback case really walks
# back". All three needed `fixtures.generate` with an arbitrary seed, which this file
# cannot do any more (Issue 543/537 -- see `_load_public_evidence` above) and never
# needed to: they are properties of the fixture generator, not of a learner's
# submission, and they already run at repository/CI scope in
# scripts/ac26-bridge-experiment.test.ts, over more seeds than they did here.


def test_workbench_starter_returns_the_editable_file() -> None:
    from participant.server import starter_payload

    payload = starter_payload()
    assert set(payload) == {"counter.py"}
    assert "def advance" in payload["counter.py"]


def test_workbench_public_tests_reject_a_single_subtraction_solution() -> None:
    from participant.server import run_public_tests

    source = """def advance(start, step, rounds, modulus):
    trace = []
    value = start
    for _ in range(rounds):
        value = value + step
        if value >= modulus:
            value -= modulus
        trace.append(value)
    return trace
"""
    result = run_public_tests({"counter.py": source})
    assert result["passed"] is False
    assert "FAIL test_negative_step_stays_in_range" in result["output"]
    assert "FAIL test_start_larger_than_modulus_stays_in_range" in result["output"]
    assert "FAIL test_step_larger_than_modulus_stays_in_range" in result["output"]


def test_workbench_public_tests_report_invalid_browser_source() -> None:
    from participant.server import run_public_tests

    result = run_public_tests({"counter.py": "def advance(:\n"})
    assert result["passed"] is False
    assert result["output"]


def test_workbench_prepare_returns_the_producible_portal_values() -> None:
    from participant.server import prepare_submissions, starter_payload

    result = prepare_submissions(starter_payload())
    assert result["ok"] is True
    submissions = result["submissions"]
    # predict and first-broken are worked out by the learner, never produced here.
    assert set(submissions) == {"environment", "generalize"}
    assert submissions["environment"] == PUBLIC["environment"]["healthToken"]
    assert "def advance" in submissions["generalize"]


def test_workbench_prepare_rejects_an_empty_source() -> None:
    from participant.server import prepare_submissions

    result = prepare_submissions({"counter.py": "   "})
    assert result["ok"] is False


def test_workbench_portal_editor_replaces_static_assets() -> None:
    assert not (ROOT / "workbench").exists()
    server = (ROOT / "participant" / "server.py").read_text(encoding="utf-8")
    for endpoint in ("/api/config", "/api/starter", "/api/inspect", "/api/test", "/api/prepare"):
        assert endpoint in server


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
        if os.environ.get("BROWSER_PUBLIC_TESTS") == "1" and name.startswith("test_workbench_"):
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
    print()
    if selected == 0:
        print(f"no public test matched --only {only!r}")
        return 1
    print("public tests:", "all passed" if failures == 0 else f"{failures} failed")
    print()
    print("Passing these does not mean you are done. They check one visible example")
    print("and a few contract boundaries, but not every unseen combination.")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
