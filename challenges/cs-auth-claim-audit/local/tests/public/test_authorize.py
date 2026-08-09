"""Public tests: they show you the shape of the answer. They do not prove it.

These pass for an implementation the hidden tests reject. That is on purpose and it is
the point of the whole problem: a gateway that verifies signatures, refuses expired
tokens and refuses out-of-scope actions looks, from every test written against the
happy path, like a gateway that works.

Two of the tests below are marked `# author guard`. They do not test your code -- they
test that this deployment's fixtures still pose the question. Leave them alone.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SUBMISSION_DIR = os.environ.get("SUBMISSION_DIR")
sys.path.insert(0, str(ROOT))
sys.path.insert(0, SUBMISSION_DIR or str(ROOT / "starter"))

from authorize import authorize  # noqa: E402
from fixtures.generate import (  # noqa: E402
    ACTIONS,
    decision_log,
    forge_unsigned,
    health_token,
    keyring,
    primary_kid,
    public_request,
    validity_window,
)
from verifier.server import (  # noqa: E402
    inspect_payload,
    prepare_submissions,
    run_public_tests,
    starter_payload,
)

SEED = os.environ.get("FLAG_SEED", "local-dev-seed")
WORKBENCH_TEST_SEED = "public-workbench-test"


def _decide(seed: str, **overrides: object) -> dict[str, object]:
    request = public_request(seed)
    resource = overrides.get("resource", request["resource"])
    assert isinstance(resource, dict)
    return authorize(
        str(overrides.get("token", request["token"])),
        str(overrides.get("action", request["action"])),
        resource,
        int(overrides.get("now", request["now"])),  # type: ignore[arg-type]
        keyring(seed),
    )


def test_the_shown_request_is_allowed() -> None:
    assert _decide(SEED) == {"allowed": True, "reason": "ok"}


def test_a_decision_is_always_two_fields() -> None:
    decision = _decide(SEED)
    assert set(decision) == {"allowed", "reason"}
    assert isinstance(decision["allowed"], bool)
    assert isinstance(decision["reason"], str)


def test_a_token_that_is_not_three_segments_is_malformed() -> None:
    for token in ("", "abc", "a.b", "a.b.c.d"):
        assert _decide(SEED, token=token) == {"allowed": False, "reason": "malformed"}


def test_a_tampered_payload_is_refused() -> None:
    head, body, mac = str(public_request(SEED)["token"]).split(".")
    flipped = "A" if body[2] != "A" else "B"
    decision = _decide(SEED, token=f"{head}.{body[:2]}{flipped}{body[3:]}.{mac}")
    assert decision["allowed"] is False


def test_a_key_id_the_gateway_does_not_hold_is_refused() -> None:
    request = public_request(SEED)
    claims = request["claims"]
    assert isinstance(claims, dict)
    token = forge_unsigned({"alg": "hs256", "kid": "k-not-held"}, claims)
    assert _decide(SEED, token=token) == {"allowed": False, "reason": "unknown_key"}


def test_after_expiry_the_token_is_refused() -> None:
    claims = public_request(SEED)["claims"]
    assert isinstance(claims, dict)
    assert _decide(SEED, now=int(claims["exp"]) + 60) == {"allowed": False, "reason": "expired"}


def test_an_action_outside_the_scope_is_refused() -> None:
    scope = public_request(SEED)["claims"]
    assert isinstance(scope, dict)
    granted = scope["scope"]
    assert isinstance(granted, list)
    absent = next(action for action in ACTIONS if action not in granted)
    assert _decide(SEED, action=absent) == {"allowed": False, "reason": "scope_missing"}


def test_never_raises_on_junk() -> None:
    for token in ("...", "!!!.???.***", "a" * 400, "\x00.\x00.\x00"):
        decision = _decide(SEED, token=token)
        assert decision["allowed"] is False


# --- author guards: these check the fixtures, not your code -------------------------


def test_the_shown_window_is_half_open_and_not_a_round_number() -> None:  # author guard
    # `window` asks for the first and last acceptable instant. If `nbf` and `exp - 1`
    # coincided, or the span were a single instant, the checkpoint would not
    # distinguish someone who worked out the convention from someone who guessed.
    for index in range(200):
        seed = f"window-guard-{index}"
        first, last = validity_window(seed)
        claims = public_request(seed)["claims"]
        assert isinstance(claims, dict)
        assert first == claims["nbf"]
        assert last == int(claims["exp"]) - 1
        assert last - first >= 100, f"seed {index}: the window is too narrow to reason about"


def test_the_decision_log_still_poses_a_question() -> None:  # author guard
    # The audit checkpoint asks which *allowed* rows are wrong. If every allowed row
    # were wrong, the answer would be "all of them" and the reading would be skipped;
    # if none were, there would be nothing to find.
    for index in range(200):
        seed = f"audit-guard-{index}"
        entries, wrong = decision_log(seed)
        allowed = [i for i, entry in enumerate(entries) if entry["gatewayDecision"] == "allow"]
        assert len(wrong) >= 2, f"seed {index}: too few wrongly-allowed rows"
        assert len(allowed) > len(wrong), f"seed {index}: every allowed row is wrong"
        assert wrong == sorted(wrong)


def test_the_audit_answer_is_not_the_same_for_every_deployment() -> None:  # author guard
    # An earlier fixture used a fixed sequence of row kinds, so the answer came out as
    # the same list of indices for every seed and could be copied from another run.
    answers = {tuple(decision_log(f"audit-spread-{index}")[1]) for index in range(120)}
    assert len(answers) > 60, "the audit answer barely varies between deployments"


def test_the_gateway_in_the_log_looks_like_it_works() -> None:  # author guard
    # The premise of the problem is that the broken gateway refuses the obvious things.
    # If it started allowing expired or out-of-scope requests, the log would announce
    # its own defect and the audit would be a reading-comprehension exercise.
    seed = "audit-guard-0"
    entries, _ = decision_log(seed)
    denied = [entry for entry in entries if entry["gatewayDecision"] == "deny"]
    assert denied, "the log contains no refusals at all"
    keys = keyring(seed)
    for entry in denied:
        resource = entry["resource"]
        assert isinstance(resource, dict)
        decision = authorize(
            str(entry["token"]), str(entry["action"]), resource, int(entry["now"]), keys  # type: ignore[arg-type]
        )
        assert decision["allowed"] is False, "the log refuses a request that should be allowed"


# --- workbench: the Portal editor's own seam ----------------------------------------


def test_workbench_inspect_shows_evidence_without_answers() -> None:
    payload = inspect_payload(WORKBENCH_TEST_SEED)
    assert payload["environment"]["healthToken"] == health_token(WORKBENCH_TEST_SEED)
    # The claims of the shown token are evidence. The window is the answer.
    assert set(payload["window"]) == {"claims", "token"}
    # The log rows are evidence. Which of them are wrong is the answer.
    rows = payload["audit"]["entries"]
    assert isinstance(rows, list) and rows
    for row in rows:
        assert set(row) == {"index", "token", "action", "resource", "now", "gatewayDecision"}
    assert "wrong" not in payload["audit"]
    assert primary_kid(WORKBENCH_TEST_SEED) in payload["audit"]["keys"]


def test_workbench_starter_returns_the_editable_file() -> None:
    payload = starter_payload()
    assert set(payload) == {"authorize.py"}
    assert "def authorize" in payload["authorize.py"]


def test_workbench_public_tests_pass_the_shipped_starter() -> None:
    # This is the uncomfortable one. The starter is incomplete and these tests do not
    # notice. If this ever starts failing, the starter no longer
    # demonstrates the misconception the problem is about.
    result = run_public_tests(WORKBENCH_TEST_SEED, starter_payload())
    assert result["passed"] is True, result["output"]


def test_workbench_public_tests_report_invalid_browser_source() -> None:
    result = run_public_tests(WORKBENCH_TEST_SEED, {"authorize.py": "def authorize(:\n"})
    assert result["passed"] is False
    assert result["output"]


def test_workbench_prepare_returns_the_producible_portal_values() -> None:
    result = prepare_submissions(WORKBENCH_TEST_SEED, starter_payload())
    assert result["ok"] is True
    submissions = result["submissions"]
    # window and audit are worked out by the learner, never produced here.
    assert set(submissions) == {"environment", "verify", "isolate", "generalize"}
    assert submissions["environment"] == health_token(WORKBENCH_TEST_SEED)
    assert "def authorize" in submissions["generalize"]


def test_workbench_prepare_rejects_an_empty_source() -> None:
    result = prepare_submissions(WORKBENCH_TEST_SEED, {"authorize.py": "   "})
    assert result["ok"] is False


def test_portal_editor_replaces_static_assets() -> None:
    assert not (ROOT / "workbench").exists()
    server = (ROOT / "verifier" / "server.py").read_text(encoding="utf-8")
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
    print("These pass for the starter, but they do not cover the whole contract.")
    print("Passing them is not evidence. Read what they never ask about.")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
