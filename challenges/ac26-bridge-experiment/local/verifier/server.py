"""POST /verify — the scoring seam. Loopback only, stdlib only.

Security contract (docs/curricula/advanced-cryptography-2026/TEMPLATE.md §/verify):
  - `checkpointId` is required and is echoed back verbatim. The platform fails closed
    on a missing or mismatched echo, so it can never credit another checkpoint.
  - Submissions are copied into a fresh temporary workspace. The source tree is never
    written to.
  - Learner code runs in a subprocess with a wall-clock timeout, a memory cap, and a
    capped output size. A hang, a fork bomb, or a gigabyte of prints fails the
    checkpoint instead of the verifier.
  - No learner input is ever concatenated into a shell command; the subprocess is
    invoked with an argument list and `shell=False`.
  - Responses carry `correct` and, at most, a property name. Never the hidden test
    names, the expected values, or reference output.
  - Malformed input produces a failed checkpoint, never a crashed process.
"""

from __future__ import annotations

import json
import os
import resource
import subprocess
import sys
import tempfile
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fixtures.generate import corrupted_trace, health_token, public_case

ROOT = Path(__file__).resolve().parents[1]
SEED = os.environ.get("FLAG_SEED", "local-dev-seed")

MAX_BODY_BYTES = 256 * 1024
RUN_TIMEOUT_SECONDS = 10
MAX_ADDRESS_SPACE_BYTES = 512 * 1024 * 1024
MAX_PROCESSES = 64
MAX_OUTPUT_BYTES = 64 * 1024

CHECKPOINTS = ("environment", "predict", "inspect", "generalize")


def _limits() -> None:
    """Applied inside the child, before exec. Caps memory, processes, and file size."""
    resource.setrlimit(resource.RLIMIT_AS, (MAX_ADDRESS_SPACE_BYTES, MAX_ADDRESS_SPACE_BYTES))
    resource.setrlimit(resource.RLIMIT_NPROC, (MAX_PROCESSES, MAX_PROCESSES))
    resource.setrlimit(resource.RLIMIT_FSIZE, (MAX_OUTPUT_BYTES, MAX_OUTPUT_BYTES))


def _normalized_int(value: object) -> int | None:
    """Accept an int or a decimal string; reject everything else. No eval, ever."""
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, str):
        text = value.strip()
        try:
            return int(text, 10)
        except ValueError:
            return None
    return None


def _check_environment(submission: object) -> bool:
    return isinstance(submission, str) and submission.strip() == health_token(SEED)


def _check_predict(submission: object) -> bool:
    case = public_case(SEED)
    value = _normalized_int(submission)
    if value is None:
        return False
    return value == (case.start + case.step * case.rounds) % case.modulus


def _check_inspect(submission: object) -> bool:
    _case, _trace, broke_at = corrupted_trace(SEED)
    value = _normalized_int(submission)
    if value is None:
        return False
    return value == broke_at


RUNNER = """
import json, sys
from pathlib import Path
sys.path.insert(0, {root!r})
sys.path.insert(0, {workspace!r})
from tests.hidden.check_counter import run
try:
    from counter import advance
except Exception as error:
    print(json.dumps({{"failures": ["submission could not be imported: " + type(error).__name__]}}))
    raise SystemExit(0)
print(json.dumps({{"failures": run(advance, {seed!r})}}))
"""


def _check_generalize(submission: object) -> bool:
    """Run the hidden suite against the learner's file in a throwaway workspace."""
    if not isinstance(submission, str) or not submission.strip():
        return False
    if len(submission) > MAX_BODY_BYTES:
        return False
    with tempfile.TemporaryDirectory() as workspace:
        (Path(workspace) / "counter.py").write_text(submission, encoding="utf-8")
        script = RUNNER.format(root=str(ROOT), workspace=workspace, seed=SEED)
        try:
            completed = subprocess.run(  # noqa: S603 - argument list, shell=False
                [sys.executable, "-I", "-c", script],
                capture_output=True,
                text=True,
                timeout=RUN_TIMEOUT_SECONDS,
                preexec_fn=_limits,
                cwd=workspace,
                env={"PATH": "/usr/local/bin:/usr/bin:/bin"},
                check=False,
            )
        except subprocess.TimeoutExpired:
            return False
        except OSError:
            return False
    if completed.returncode != 0:
        return False
    stdout = completed.stdout[-MAX_OUTPUT_BYTES:]
    for line in reversed(stdout.splitlines()):
        try:
            payload = json.loads(line)
        except json.JSONDecodeError:
            continue
        failures = payload.get("failures")
        return isinstance(failures, list) and len(failures) == 0
    return False


def evaluate(checkpoint_id: str, submission: object) -> bool:
    if checkpoint_id == "environment":
        return _check_environment(submission)
    if checkpoint_id == "predict":
        return _check_predict(submission)
    if checkpoint_id == "inspect":
        return _check_inspect(submission)
    if checkpoint_id == "generalize":
        return _check_generalize(submission)
    return False


class Handler(BaseHTTPRequestHandler):
    def do_POST(self) -> None:  # noqa: N802 - BaseHTTPRequestHandler's name
        if self.path.rstrip("/") != "/verify":
            self._respond(404, {"error": "not found"})
            return
        try:
            length = int(self.headers.get("content-length", "0"))
        except ValueError:
            self._respond(400, {"error": "bad content-length"})
            return
        if length <= 0 or length > MAX_BODY_BYTES:
            self._respond(400, {"error": "bad content-length"})
            return
        try:
            body = json.loads(self.rfile.read(length).decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            self._respond(400, {"error": "bad json"})
            return
        if not isinstance(body, dict):
            self._respond(400, {"error": "bad json"})
            return

        checkpoint_id = body.get("checkpointId")
        if not isinstance(checkpoint_id, str) or checkpoint_id not in CHECKPOINTS:
            # Unknown checkpoint is a failed verdict with the id echoed when it is at
            # least a string, so the platform's echo check still holds.
            self._respond(
                200,
                {
                    "checkpointId": checkpoint_id if isinstance(checkpoint_id, str) else "",
                    "correct": False,
                },
            )
            return

        try:
            correct = evaluate(checkpoint_id, body.get("submission"))
        except Exception:  # noqa: BLE001 - a broken checkpoint must not kill the verifier
            correct = False
        self._respond(200, {"checkpointId": checkpoint_id, "correct": correct})

    def log_message(self, *_args: object) -> None:
        """Silence the default stderr access log; it would echo submissions."""

    def _respond(self, status: int, payload: dict[str, object]) -> None:
        encoded = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)


def main() -> None:
    port = int(os.environ.get("VERIFY_PORT", "18091"))
    HTTPServer(("127.0.0.1", port), Handler).serve_forever()


if __name__ == "__main__":
    main()
