"""Public tests: answer shape and the browser-only participant contract.

They confirm classify() returns the three keys and that your generators return
integers. They cannot tell you whether the unsound verifier accepts your out-of-range witness --
that is what the hidden verifier does, deliberately.
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

from classify import PROPERTIES, classify  # noqa: E402
from counterexamples import (  # noqa: E402
    extract_witness,
    incompleteness_witness,
    unsoundness_witness,
)

SEED = os.environ.get("FLAG_SEED", "local-dev-seed")


def _load_public_evidence() -> dict[str, object]:
    """This deployment's public evidence -- the statement, what each verifier checks,
    and a leaky transcript, the same things `show.py` and the Portal both print.

    Issue 543/537: this file used to import `fixtures.generate` directly. `fixtures/`
    does not ship in the `participant` Docker stage at all any more (see
    ../../Dockerfile) -- keeping the seed-keyed generators reachable here is what let a
    learner skip straight past `privacy-leak` (and `incompleteness`, whose boundary
    instance was never even shown) with nothing but their own container's `FLAG_SEED`.
    This deployment's own verifier is the only source for this evidence now:
    `PUBLIC_EVIDENCE_JSON` when `participant/server.py` has already fetched it (the
    Portal path, and the sandboxed run `make test` also uses), or `VERIFIER_PUBLIC_URL`
    fetched directly when neither is true.
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
    # scripts/ac26-bridge-properties.test.ts) or the verifier/author Docker stage, and
    # never true inside a built `participant` image -- so this branch existing does not
    # reopen Issue 543/537's leak.
    from fixtures.generate import public_payload

    return public_payload(SEED)


PUBLIC = _load_public_evidence()


def test_classify_answers_every_protocol() -> None:
    for protocol_id in PUBLIC["verifiers"]:
        answer = classify(protocol_id)
        assert set(answer) == set(PROPERTIES), f"{protocol_id}: expected keys {PROPERTIES}"


def test_classify_returns_booleans() -> None:
    for protocol_id in PUBLIC["verifiers"]:
        for prop, value in classify(protocol_id).items():
            assert isinstance(value, bool), f"{protocol_id}.{prop} is not a boolean"


def test_generators_return_integers() -> None:
    statement = PUBLIC["statement"]
    assert isinstance(incompleteness_witness(statement), int)
    assert isinstance(unsoundness_witness(statement), int)


def test_extractor_returns_an_integer() -> None:
    assert isinstance(extract_witness(PUBLIC["transcript"]), int)


def test_workbench_inspect_explains_properties_and_seeded_evidence() -> None:
    from participant.server import inspect_payload

    payload = inspect_payload()
    assert set(payload["definitions"]) == {"complete", "sound", "private"}
    assert set(payload["verifiers"]) == set(PUBLIC["verifiers"])
    assert set(payload["statement"]) == {"a", "b", "c", "p", "lo", "hi"}
    assert "boundaryStatement" not in payload
    assert payload["transcript"]["protocol"] == PUBLIC["privacyProtocol"]


def test_workbench_starter_returns_both_editable_files() -> None:
    from participant.server import starter_payload

    payload = starter_payload()
    assert set(payload) == {"classify.py", "counterexamples.py"}
    assert "def classify" in payload["classify.py"]
    assert "def incompleteness_witness" in payload["counterexamples.py"]


def test_workbench_public_tests_run_browser_sources() -> None:
    from participant.server import run_public_tests, starter_payload

    result = run_public_tests(starter_payload())
    assert result["passed"] is True
    assert "public tests: all passed" in result["output"]


def test_workbench_public_tests_report_invalid_browser_source() -> None:
    from participant.server import run_public_tests, starter_payload

    sources = starter_payload()
    sources["classify.py"] = "def classify(:\n"
    result = run_public_tests(sources)
    assert result["passed"] is False
    assert result["output"]


def test_workbench_prepare_returns_all_portal_checkpoints() -> None:
    from participant.server import prepare_submissions, starter_payload

    result = prepare_submissions(starter_payload())
    assert result["ok"] is True
    submissions = result["submissions"]
    assert set(submissions) == {
        "incompleteness",
        "unsoundness",
        "privacy-leak",
        "property-matrix",
        "transfer",
    }
    # Portal の workbench-client は submissions の値を全部 string で要求する
    # (PrepareSchema: z.record(z.string(), z.string()))。raw int を返していたので
    # この 3 つは提出のたびに 502 invalid_workbench_response になっていた。
    # ここが int を要求していたせいで、その欠陥が public test で守られていた。
    #
    # 「string であること」だけでなく「10 進整数として読めること」まで見る。
    # 型だけ通せば str(None) の "None" も通ってしまい、参加者から見て前より
    # 分かりにくい失敗になる。
    for checkpoint in ("incompleteness", "unsoundness", "privacy-leak"):
        value = submissions[checkpoint]
        assert isinstance(value, str), checkpoint
        int(value)
    assert isinstance(json.loads(submissions["property-matrix"]), dict)
    assert set(json.loads(submissions["transfer"])) == {"classify.py", "counterexamples.py"}


def test_portal_editor_replaces_static_assets() -> None:
    assert not (ROOT / "workbench").exists()
    server = (ROOT / "participant" / "server.py").read_text(encoding="utf-8")
    for endpoint in ("/api/config", "/api/starter", "/api/inspect", "/api/test", "/api/prepare"):
        assert endpoint in server


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
    print("These only check the shape of your answers. The starter passes all of")
    print("them while classifying every protocol wrongly and demonstrating nothing.")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
