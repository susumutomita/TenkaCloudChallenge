"""Public tests: they show you the shape of the answer. They do not prove it.

These pass for an implementation the hidden tests reject. That is on purpose and it is
the point of the whole problem: a gateway that verifies signatures, refuses expired
tokens and refuses out-of-scope actions looks, from every test written against the
happy path, like a gateway that works.

Three fixture-invariant checks used to live here as "author guard" tests, sweeping
seeds unrelated to this deployment's own FLAG_SEED ("the window is wide enough", "the
audit answer is neither empty nor the whole log", "the answer varies across
deployments"). They needed `fixtures.generate` for an arbitrary seed, which this file
cannot do any more (Issue 543/537 -- `fixtures/` does not ship in the `participant`
Docker stage; see `_load_public_evidence` below) and never needed to: they are
properties of the fixture generator, not of a learner's submission, and now run at
repository/CI scope in `scripts/cs-auth-claim-audit.test.ts`.
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

from authorize import authorize  # noqa: E402

SEED = os.environ.get("FLAG_SEED", "local-dev-seed")

#: Every action the gateway knows. Not seed-derived and not a secret -- it is fixed
#: catalog vocabulary a token's `scope` claim draws from -- so duplicating it here
#: rather than importing `fixtures.generate.ACTIONS` costs nothing (see the module
#: docstring for why that import is gone).
ACTIONS = ("read:doc", "write:doc", "delete:doc", "read:billing", "write:billing")


def _forge_unsigned(header: dict[str, object], payload: dict[str, object]) -> str:
    """Mint a token whose third segment is a plain digest -- no key involved.

    Not seed-derived either: a copy of `fixtures.generate.forge_unsigned`, kept here
    for the same reason `ACTIONS` is. What an attacker sends when the gateway
    dispatches on `header["alg"]`; the segment is a real SHA-256 of the signing input,
    not obviously wrong.
    """
    import base64
    import hashlib

    def b64(raw: bytes) -> str:
        return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")

    head = b64(json.dumps(header, separators=(",", ":"), sort_keys=True).encode())
    body = b64(json.dumps(payload, separators=(",", ":"), sort_keys=True).encode())
    return f"{head}.{body}.{b64(hashlib.sha256(f'{head}.{body}'.encode()).digest())}"


def _load_public_evidence() -> dict[str, object]:
    """This deployment's public evidence -- the token, its claims, the gateway's
    signing keys, and the decision log `show.py` and the Portal both print.

    Issue 543/537: this file used to import `fixtures.generate` directly. `fixtures/`
    does not ship in the `participant` Docker stage at all any more (see
    ../../Dockerfile) -- keeping the seed-keyed generator reachable here is what let a
    learner skip straight past `window` and `audit` with nothing but their own
    container's `FLAG_SEED`, even after both checkpoints' own answers moved out to
    `fixtures.generate.validity_window` and `verifier/expected.py`. This deployment's
    own verifier is the only source for this evidence now: `PUBLIC_EVIDENCE_JSON` when
    `participant/server.py` has already fetched it (the Portal path, and the sandboxed
    run `make test` also uses), or `VERIFIER_PUBLIC_URL` fetched directly when neither
    is true.
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
    # scripts/cs-auth-claim-audit.test.ts) or the verifier/author Docker stage, and
    # never true inside a built `participant` image -- so this branch existing does not
    # reopen Issue 543/537's leak.
    from fixtures.generate import public_payload

    return public_payload(SEED)


PUBLIC = _load_public_evidence()


def _decide(**overrides: object) -> dict[str, object]:
    handled = PUBLIC["window"]["handled"]
    resource = overrides.get("resource", handled["resource"])
    assert isinstance(resource, dict)
    return authorize(
        str(overrides.get("token", PUBLIC["window"]["token"])),
        str(overrides.get("action", handled["action"])),
        resource,
        int(overrides.get("now", handled["now"])),  # type: ignore[arg-type]
        PUBLIC["audit"]["keys"],
    )


def test_the_shown_request_is_allowed() -> None:
    assert _decide() == {"allowed": True, "reason": "ok"}


def test_a_decision_is_always_two_fields() -> None:
    decision = _decide()
    assert set(decision) == {"allowed", "reason"}
    assert isinstance(decision["allowed"], bool)
    assert isinstance(decision["reason"], str)


def test_a_token_that_is_not_three_segments_is_malformed() -> None:
    for token in ("", "abc", "a.b", "a.b.c.d"):
        assert _decide(token=token) == {"allowed": False, "reason": "malformed"}


def test_a_tampered_payload_is_refused() -> None:
    head, body, mac = str(PUBLIC["window"]["token"]).split(".")
    flipped = "A" if body[2] != "A" else "B"
    decision = _decide(token=f"{head}.{body[:2]}{flipped}{body[3:]}.{mac}")
    assert decision["allowed"] is False


def test_a_key_id_the_gateway_does_not_hold_is_refused() -> None:
    claims = PUBLIC["window"]["claims"]
    token = _forge_unsigned({"alg": "hs256", "kid": "k-not-held"}, claims)
    assert _decide(token=token) == {"allowed": False, "reason": "unknown_key"}


def test_after_expiry_the_token_is_refused() -> None:
    claims = PUBLIC["window"]["claims"]
    assert _decide(now=int(claims["exp"]) + 60) == {"allowed": False, "reason": "expired"}


def test_an_action_outside_the_scope_is_refused() -> None:
    granted = PUBLIC["window"]["claims"]["scope"]
    absent = next(action for action in ACTIONS if action not in granted)
    assert _decide(action=absent) == {"allowed": False, "reason": "scope_missing"}


def test_never_raises_on_junk() -> None:
    for token in ("...", "!!!.???.***", "a" * 400, "\x00.\x00.\x00"):
        decision = _decide(token=token)
        assert decision["allowed"] is False


# --- workbench: the Portal editor's own seam ----------------------------------------


def test_workbench_inspect_shows_evidence_without_answers() -> None:
    from participant.server import inspect_payload

    payload = inspect_payload()
    assert payload["environment"]["healthToken"] == PUBLIC["environment"]["healthToken"]
    # A whitelist, not a sample: every field of the shown request is evidence, and the
    # window itself is the answer, so a new key here has to be justified deliberately.
    assert set(payload["window"]) == {
        "question",
        "answerFormat",
        "i18n",
        "token",
        "header",
        "claims",
        "mac",
        "handled",
    }
    # The evidence is useless without the question, and the Portal used to get one
    # without the other. Both checkpoints state theirs, in both languages.
    for block in ("window", "audit"):
        assert payload[block]["question"]
        assert payload[block]["i18n"]["en"]["question"]
    # The log rows are evidence. Which of them are wrong is the answer.
    rows = payload["audit"]["entries"]
    assert isinstance(rows, list) and rows
    for row in rows:
        assert set(row) == {"index", "token", "action", "resource", "now", "gatewayDecision"}
    assert "wrong" not in payload["audit"]
    # The key that signed the shown token is among the keys the auditor was handed --
    # otherwise the audit could never even verify the one request it is told is genuine.
    assert payload["window"]["header"]["kid"] in payload["audit"]["keys"]


def test_workbench_starter_returns_the_editable_file() -> None:
    from participant.server import starter_payload

    payload = starter_payload()
    assert set(payload) == {"authorize.py"}
    assert "def authorize" in payload["authorize.py"]


def test_workbench_public_tests_pass_the_shipped_starter() -> None:
    from participant.server import run_public_tests, starter_payload

    # This is the uncomfortable one. The starter is incomplete and these tests do not
    # notice. If this ever starts failing, the starter no longer
    # demonstrates the misconception the problem is about.
    result = run_public_tests(starter_payload())
    assert result["passed"] is True, result["output"]


def test_workbench_public_tests_report_invalid_browser_source() -> None:
    from participant.server import run_public_tests

    result = run_public_tests({"authorize.py": "def authorize(:\n"})
    assert result["passed"] is False
    assert result["output"]


def test_workbench_prepare_returns_the_producible_portal_values() -> None:
    from participant.server import prepare_submissions, starter_payload

    result = prepare_submissions(starter_payload())
    assert result["ok"] is True
    submissions = result["submissions"]
    # window and audit are worked out by the learner, never produced here.
    assert set(submissions) == {"environment", "verify", "isolate", "generalize"}
    assert submissions["environment"] == PUBLIC["environment"]["healthToken"]
    assert "def authorize" in submissions["generalize"]


def test_workbench_prepare_rejects_an_empty_source() -> None:
    from participant.server import prepare_submissions

    result = prepare_submissions({"authorize.py": "   "})
    assert result["ok"] is False


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
    print("These pass for the starter, but they do not cover the whole contract.")
    print("Passing them is not evidence. Read what they never ask about.")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
