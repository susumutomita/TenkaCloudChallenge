"""Compose-internal hidden verifier for transaction visibility.

Only this image receives hidden properties and expected-answer derivation. Participant
submissions execute in a temporary directory with bounded time, memory, processes,
file size, and captured output. Every grading failure returns ``correct: false``.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import resource
import secrets
import subprocess
import sys
import tempfile
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from urllib.parse import urlsplit

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fixtures.generate import audit_fixture, counterexample_fixture
from verifier.expected import audit_expected, counterexample_expected

ROOT = Path(__file__).resolve().parents[1]
PROBLEM_ID = "cs-transaction-visibility-audit"
SEED = os.environ.get("FLAG_SEED", "local-dev-seed")

MAX_BODY_BYTES = 256 * 1024
RUN_TIMEOUT_SECONDS = 10
MAX_ADDRESS_SPACE_BYTES = 512 * 1024 * 1024
MAX_PROCESSES = 64
MAX_OUTPUT_BYTES = 64 * 1024
#: Cap for the verdict's optional human-readable failure summary. Kept under the
#: platform's 2000-character message limit with room to spare.
MAX_MESSAGE_CHARS = 1900
REQUEST_TIMEOUT_SECONDS = 15

CODE_CHECKPOINTS = {
    "snapshot": ("check_snapshot",),
    "transfer": ("check_transfer",),
}
MANUAL_CHECKPOINTS = ("audit", "counterexample")
CHECKPOINTS = (*MANUAL_CHECKPOINTS, *CODE_CHECKPOINTS)
_ADDRESS_SPACE_CAPPABLE = sys.platform.startswith("linux")


def _limits() -> None:
    if _ADDRESS_SPACE_CAPPABLE:
        resource.setrlimit(resource.RLIMIT_AS, (MAX_ADDRESS_SPACE_BYTES, MAX_ADDRESS_SPACE_BYTES))
    resource.setrlimit(resource.RLIMIT_NPROC, (MAX_PROCESSES, MAX_PROCESSES))
    resource.setrlimit(resource.RLIMIT_FSIZE, (MAX_OUTPUT_BYTES, MAX_OUTPUT_BYTES))


def _json_object(submission: object) -> dict[str, object] | None:
    value = submission
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except json.JSONDecodeError:
            return None
    return value if isinstance(value, dict) else None


def _check_audit(submission: object) -> bool:
    answer = _json_object(submission)
    if answer is None or set(answer) != {"reportId", "observedRevisions"}:
        return False
    if not isinstance(answer["reportId"], str):
        return False
    revisions = answer["observedRevisions"]
    if (
        not isinstance(revisions, list)
        or len(revisions) != 2
        or any(type(revision) is not int for revision in revisions)
    ):
        return False
    return answer == audit_expected(SEED)


def _check_counterexample(submission: object) -> bool:
    answer = _json_object(submission)
    if answer is None or set(answer) != {"beforeCommit", "commit", "afterCommit"}:
        return False
    if not isinstance(answer["commit"], str):
        return False
    for key in ("beforeCommit", "afterCommit"):
        ids = answer[key]
        if not isinstance(ids, list) or len(ids) != 2 or any(not isinstance(i, str) for i in ids):
            return False
    return answer == counterexample_expected(SEED)


RUNNER = """
import json, os, sys
hard_exit = os._exit
trusted_stdout = sys.stdout
trusted_write = sys.stdout.buffer.write
sys.path.insert(0, {root!r})
from tests.hidden import check_report
checkers = tuple(getattr(check_report, phase) for phase in {phases!r})

# Keep private callable references, then remove the checker package and path before
# importing participant code. The submission must not replace a hidden check through
# Python's shared module cache.
#
# Issue 591: this used to scrub only "tests" -- but check_report already resolved
# `from fixtures.generate import ...` while loading, which leaves fixtures and
# fixtures.generate cached in sys.modules. Python's import statement checks that cache
# before sys.path, so a submission's own `import fixtures` returned the cached module
# regardless of the path removal below. Evicting fixtures too closes that.
for module_name in tuple(sys.modules):
    if module_name == "tests" or module_name.startswith("tests.") or module_name == "fixtures" or module_name.startswith("fixtures."):
        sys.modules.pop(module_name, None)
while {root!r} in sys.path:
    sys.path.remove({root!r})
sys.path.insert(0, {workspace!r})

try:
    import report
except Exception as error:
    # submission could not be imported: emit only private, nonce-bound records.
    os._exit = hard_exit
    sys.stdout = trusted_stdout
    trusted_write(
        {detail_record!r}
        + ("submission could not be imported: " + type(error).__name__).encode("utf-8")
        + b"\\n"
    )
    trusted_write({fail_record!r})
    sys.stdout.flush()
    os._exit(0)

failures = []
if not hasattr(report, "build_report"):
    failures.append("submission does not define build_report()")
else:
    for checker in checkers:
        failures.extend(checker(report, {seed!r}))

# Participant imports may replace json.dumps, print, sys.stdout, or os._exit. Restore
# trusted C-backed handles and emit fixed nonce-bound records after grading. The failure
# summary travels on its own nonce-bound line: a submission that prints a look-alike
# cannot forge it without the nonce, and the verdict itself stays on the verdict record.
os._exit = hard_exit
sys.stdout = trusted_stdout
if failures:
    detail = "; ".join(item for item in failures if isinstance(item, str))
    detail = " ".join(detail.split())[:{max_message_chars}]
    if detail:
        trusted_write({detail_record!r} + detail.encode("utf-8", "replace") + b"\\n")
trusted_write({pass_record!r} if not failures else {fail_record!r})
sys.stdout.flush()
os._exit(0)
"""


def _run_submission(
    submission: object, phases: tuple[str, ...], seed: str
) -> tuple[bool, str | None]:
    source = submission
    if isinstance(source, dict):
        source = source.get("report.py")
    if not isinstance(source, str) or not source.strip():
        return False, None
    if len(source.encode("utf-8")) > MAX_BODY_BYTES:
        return False, None

    with tempfile.TemporaryDirectory() as workspace:
        verdict_token = secrets.token_hex(32)
        pass_line = f"TC-VERDICT:{verdict_token}:PASS"
        fail_line = f"TC-VERDICT:{verdict_token}:FAIL"
        detail_prefix = f"TC-DETAIL:{verdict_token}:"
        Path(workspace, "report.py").write_text(source, encoding="utf-8")
        script = RUNNER.format(
            root=str(ROOT),
            workspace=workspace,
            phases=list(phases),
            seed=seed,
            pass_record=(pass_line + "\n").encode("utf-8"),
            fail_record=(fail_line + "\n").encode("utf-8"),
            detail_record=detail_prefix.encode("utf-8"),
            max_message_chars=MAX_MESSAGE_CHARS,
        )
        transcript = Path(workspace) / "stdout"
        try:
            with transcript.open("w", encoding="utf-8") as sink:
                completed = subprocess.run(  # noqa: S603 - fixed argv, shell=False
                    [sys.executable, "-I", "-c", script],
                    cwd=workspace,
                    env={"PATH": "/usr/local/bin:/usr/bin:/bin"},
                    stdout=sink,
                    stderr=subprocess.STDOUT,
                    text=True,
                    timeout=RUN_TIMEOUT_SECONDS,
                    preexec_fn=_limits,
                    check=False,
                )
            output = transcript.read_text(encoding="utf-8", errors="replace")
        except (subprocess.TimeoutExpired, OSError, ValueError):
            return False, None
    if completed.returncode != 0:
        return False, None
    lines = output[-MAX_OUTPUT_BYTES:].splitlines()
    if bool(lines) and lines[-1] == pass_line:
        return True, None
    # The failure summary is trusted only on its own nonce-bound record: the nonce
    # never reaches the submission, so a printed look-alike cannot land here.
    message: str | None = None
    for line in lines:
        if line.startswith(detail_prefix):
            message = line[len(detail_prefix) :][:MAX_MESSAGE_CHARS] or None
    return False, message


def evaluate(checkpoint_id: str, submission: object) -> bool:
    """Boolean verdict for callers that need only pass/fail."""
    correct, _message = evaluate_with_message(checkpoint_id, submission)
    return correct


def evaluate_with_message(
    checkpoint_id: str, submission: object
) -> tuple[bool, str | None]:
    if checkpoint_id == "audit":
        return _check_audit(submission), None
    if checkpoint_id == "counterexample":
        return _check_counterexample(submission), None
    phases = CODE_CHECKPOINTS.get(checkpoint_id)
    if phases is None:
        return False, None
    phase_seed = f"{SEED}:transfer" if checkpoint_id == "transfer" else SEED
    return _run_submission(submission, phases, phase_seed)


def _unwrap_submission(checkpoint_id: str, submission: object) -> object:
    if not isinstance(submission, str) or not submission.startswith("tcw1."):
        return None if checkpoint_id in MANUAL_CHECKPOINTS else submission
    try:
        prefix, encoded_payload, encoded_signature = submission.split(".", 2)
        if prefix != "tcw1":
            return None
        payload = base64.urlsafe_b64decode(encoded_payload + "=" * (-len(encoded_payload) % 4))
        signature = base64.urlsafe_b64decode(
            encoded_signature + "=" * (-len(encoded_signature) % 4)
        )
        key = hashlib.sha256((PROBLEM_ID + "\0" + SEED).encode("utf-8")).digest()
        expected = hmac.new(key, payload, hashlib.sha256).digest()[:16]
        if not hmac.compare_digest(signature, expected):
            return None
        decoded = json.loads(payload.decode("utf-8"))
    except (ValueError, UnicodeDecodeError, json.JSONDecodeError):
        return None
    if not isinstance(decoded, dict):
        return None
    if decoded.get("v") != 1 or decoded.get("checkpointId") != checkpoint_id:
        return None
    return decoded.get("answer")


class Handler(BaseHTTPRequestHandler):
    timeout = REQUEST_TIMEOUT_SECONDS

    def do_GET(self) -> None:  # noqa: N802 - stdlib handler API
        if urlsplit(self.path).path == "/healthz":
            self._respond(200, {"ok": True})
            return
        self._respond(404, {"error": "not found"})

    def do_POST(self) -> None:  # noqa: N802 - stdlib handler API
        if urlsplit(self.path).path.rstrip("/") != "/verify":
            self._respond(404, {"error": "not found"})
            return
        body = self._read_json_body()
        if body is None:
            return
        checkpoint_id = body.get("checkpointId")
        if not isinstance(checkpoint_id, str) or checkpoint_id not in CHECKPOINTS:
            self._respond(
                200,
                {
                    "checkpointId": checkpoint_id if isinstance(checkpoint_id, str) else "",
                    "correct": False,
                },
            )
            return
        submission = _unwrap_submission(checkpoint_id, body.get("submission"))
        try:
            correct, message = evaluate_with_message(checkpoint_id, submission)
        except Exception:  # noqa: BLE001 - every grader failure must fail closed
            correct, message = False, None
        verdict: dict[str, object] = {"checkpointId": checkpoint_id, "correct": correct}
        if not correct and message:
            verdict["message"] = message
        self._respond(200, verdict)

    def _read_json_body(self) -> dict[str, object] | None:
        try:
            length = int(self.headers.get("content-length", "0"))
        except ValueError:
            self._respond(400, {"error": "bad content-length"})
            return None
        if length <= 0 or length > MAX_BODY_BYTES:
            self._respond(400, {"error": "bad content-length"})
            return None
        try:
            body = json.loads(self.rfile.read(length).decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            self._respond(400, {"error": "bad json"})
            return None
        except (TimeoutError, OSError):
            self._respond(400, {"error": "incomplete body"})
            return None
        if not isinstance(body, dict):
            self._respond(400, {"error": "bad json"})
            return None
        return body

    def log_message(self, *_args: object) -> None:
        """Do not echo submissions into the access log."""

    def _respond(self, status: int, payload: dict[str, object]) -> None:
        content = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("content-type", "application/json; charset=utf-8")
        self.send_header("content-length", str(len(content)))
        self.send_header("cache-control", "no-store")
        self.send_header("x-content-type-options", "nosniff")
        self.end_headers()
        self.wfile.write(content)


def main() -> None:
    port = int(os.environ.get("VERIFY_PORT", "18321"))
    # Bind every interface *inside the container*, not the container's loopback. A published
    # port is forwarded to the container's bridge address, so a server listening only on
    # 127.0.0.1 inside the container accepts nothing from outside it — the connection is
    # opened and closed without a response, and the platform can never score the problem.
    #
    # The loopback restriction that matters is on the host, and it lives in
    # docker-compose.yml, which publishes `127.0.0.1:<port>:<port>`. Nothing outside this
    # machine can reach the verifier either way.
    HTTPServer(("0.0.0.0", port), Handler).serve_forever()  # noqa: S104 - see above


if __name__ == "__main__":
    main()
