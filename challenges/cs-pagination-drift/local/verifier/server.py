"""Separated hidden verifier for the pagination lab."""

from __future__ import annotations

import json
import os
import resource
import secrets
import subprocess
import sys
import tempfile
from functools import partial
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from urllib.parse import urlsplit

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fixtures.generate import (
    health_token,
    missing_survivor_ids,
    pagination_trace,
    reported_listing,
)

ROOT = Path(__file__).resolve().parents[1]
SEED = os.environ.get("FLAG_SEED", "local-dev-seed")
MAX_BODY_BYTES = 256 * 1024
MAX_OUTPUT_BYTES = 64 * 1024
MAX_PROCESSES = 128
RUN_TIMEOUT_SECONDS = 15
REQUEST_TIMEOUT_SECONDS = 15
_ADDRESS_SPACE_CAPPABLE = sys.platform.startswith("linux")
CHECKPOINTS = ("environment", "observe", "audit", "paginate", "stability", "generalize")
CODE_CHECKPOINT_PHASES = {
    "paginate": "check_paginate",
    "stability": "check_stability",
    "generalize": "check_generalize",
}
CODE_CHECKPOINTS = frozenset(CODE_CHECKPOINT_PHASES)

# Metadata parity guard (#381) reads this authored verifier source. The participant
# renders the same strings from workbench/server.py; keeping the full English material
# here makes drift visible even though the two responsibilities are separate images.
PORTAL_ENGLISH_CONTRACT = {
    "name": "Every page is right. The listing is not",
    "description": "Audit a listing job that paged a moving table by offset, then hand out a cursor that names a row instead of a position.",
    "labels": {
        "environment": "environment - paste the Workbench pass phrase",
        "observe": "observe - name the listing and what happened between its pages",
        "audit": "audit - list the surviving rows no page ever served",
        "paginate": "paginate - refuse inputs this paginator never issued",
        "stability": "stability - keep every surviving row exactly once while the table moves",
        "generalize": "generalize - hold those properties on schedules nobody wrote down",
    },
}


def _uid_task_count() -> int:
    """Count Linux tasks charged to this real uid before the submission starts."""
    if not _ADDRESS_SPACE_CAPPABLE:
        return 0
    total = 0
    try:
        processes = os.scandir("/proc")
    except OSError:
        return 0
    with processes:
        for process in processes:
            if not process.name.isdigit():
                continue
            try:
                if process.stat(follow_symlinks=False).st_uid != os.getuid():
                    continue
                with os.scandir(f"{process.path}/task") as tasks:
                    total += sum(1 for task in tasks if task.name.isdigit())
            except OSError:
                # Processes can exit between the two /proc reads.
                continue
    return total


def _nproc_limit() -> int:
    """Give this submission bounded headroom without charging the host baseline."""
    baseline = _uid_task_count()
    desired = MAX_PROCESSES if baseline == 0 else baseline + MAX_PROCESSES
    _soft, hard = resource.getrlimit(resource.RLIMIT_NPROC)
    return desired if hard == resource.RLIM_INFINITY else min(desired, hard)


def _limits(nproc_limit: int) -> None:
    if _ADDRESS_SPACE_CAPPABLE:
        resource.setrlimit(resource.RLIMIT_AS, (512 * 1024 * 1024, 512 * 1024 * 1024))
    # RLIMIT_NPROC counts every process and thread owned by the real uid, not only this
    # child. The parent measures the uid baseline before fork and grants a MAX_PROCESSES
    # task budget that includes the runner child. Compose still applies its tighter,
    # cgroup-local pids_limit=96 to the whole verifier service.
    resource.setrlimit(resource.RLIMIT_NPROC, (nproc_limit, nproc_limit))
    resource.setrlimit(resource.RLIMIT_FSIZE, (MAX_OUTPUT_BYTES, MAX_OUTPUT_BYTES))


def _json_value(value: object) -> object:
    if isinstance(value, str):
        try:
            return json.loads(value)
        except json.JSONDecodeError:
            return value.strip()
    return value


def _check_environment(submission: object) -> bool:
    return isinstance(submission, str) and submission.strip() == health_token(SEED)


def _check_observe(submission: object) -> bool:
    expected = [reported_listing(SEED)["listingId"], "duplicate-rows"]
    return _json_value(submission) == expected


def _check_audit(submission: object) -> bool:
    value = _json_value(submission)
    if not isinstance(value, list) or any(type(item) is not int for item in value):
        return False
    # Derived from the recorded trace rather than stored, so the expected answer
    # follows the seed and stays correct if the trace construction ever changes.
    expected = missing_survivor_ids(SEED)
    return len(value) == len(set(value)) and sorted(value) == expected


RUNNER = """
import json, os, sys
hard_exit = os._exit
trusted_stdout = sys.stdout
trusted_write = sys.stdout.buffer.write
sys.path.insert(0, {root!r})
from tests.hidden import check_pagination
private_checker = getattr(check_pagination, {phase!r})
for module_name in tuple(sys.modules):
    if module_name == "tests" or module_name.startswith("tests.") or module_name == "fixtures" or module_name.startswith("fixtures."):
        sys.modules.pop(module_name, None)
while {root!r} in sys.path:
    sys.path.remove({root!r})
sys.path.insert(0, {workspace!r})

try:
    import pagination as submission_module
except Exception:
    # submission could not be imported: emit only the private, nonce-bound failure record.
    os._exit = hard_exit
    sys.stdout = trusted_stdout
    trusted_write({fail_record!r})
    sys.stdout.flush()
    os._exit(0)

if not hasattr(submission_module, "new_paginator"):
    failures = ["submission does not define new_paginator()"]
else:
    try:
        failures = private_checker(submission_module, {seed!r})
    except Exception:
        failures = ["submission could not be checked"]

# Participant imports may replace json.dumps, print, sys.stdout, or os._exit. Restore
# the trusted C-backed output/exit handles and write a fixed record instead of calling
# any participant-mutable serializer after grading.
os._exit = hard_exit
sys.stdout = trusted_stdout
trusted_write({pass_record!r} if not failures else {fail_record!r})
sys.stdout.flush()
os._exit(0)
"""


def _check_code(phase: str, submission: object) -> bool:
    if not isinstance(submission, str) or not submission.strip() or len(submission) > MAX_BODY_BYTES:
        return False
    with tempfile.TemporaryDirectory() as workspace:
        verdict_token = secrets.token_hex(32)
        pass_line = f"TC-VERDICT:{verdict_token}:PASS"
        fail_line = f"TC-VERDICT:{verdict_token}:FAIL"
        nproc_limit = _nproc_limit()
        Path(workspace, "pagination.py").write_text(submission, encoding="utf-8")
        transcript = Path(workspace, "stdout")
        try:
            with transcript.open("w", encoding="utf-8") as sink:
                completed = subprocess.run(
                    [
                        sys.executable,
                        "-I",
                        "-c",
                        RUNNER.format(
                            root=str(ROOT),
                            workspace=workspace,
                            phase=phase,
                            seed=SEED,
                            pass_record=(pass_line + "\n").encode("utf-8"),
                            fail_record=(fail_line + "\n").encode("utf-8"),
                        ),
                    ],
                    stdout=sink,
                    stderr=subprocess.STDOUT,
                    text=True,
                    timeout=RUN_TIMEOUT_SECONDS,
                    preexec_fn=partial(_limits, nproc_limit),
                    cwd=workspace,
                    # glibc otherwise creates a large malloc arena for each thread; keep
                    # the address-space headroom for participant data instead.
                    env={
                        "PATH": "/usr/local/bin:/usr/bin:/bin",
                        "MALLOC_ARENA_MAX": "2",
                    },
                    check=False,
                )
            output = transcript.read_text(encoding="utf-8", errors="replace")[-MAX_OUTPUT_BYTES:]
        except (OSError, ValueError, subprocess.TimeoutExpired):
            return False
    if completed.returncode != 0:
        return False
    lines = output.splitlines()
    return bool(lines) and lines[-1] == pass_line


def _check_paginate(submission: object) -> bool:
    return _check_code(CODE_CHECKPOINT_PHASES["paginate"], submission) and bool(SEED)


def _check_stability(submission: object) -> bool:
    return _check_code(CODE_CHECKPOINT_PHASES["stability"], submission) and bool(SEED)


def _check_generalize(submission: object) -> bool:
    return _check_code(CODE_CHECKPOINT_PHASES["generalize"], submission) and bool(SEED)


def evaluate(checkpoint_id: str, submission: object) -> bool:
    if checkpoint_id == "environment":
        return _check_environment(submission)
    if checkpoint_id == "observe":
        return _check_observe(submission)
    if checkpoint_id == "audit":
        return _check_audit(submission)
    checker = globals().get(f"_check_{checkpoint_id}")
    return bool(checker(submission)) if callable(checker) else False


class Handler(BaseHTTPRequestHandler):
    timeout = REQUEST_TIMEOUT_SECONDS

    def do_GET(self) -> None:  # noqa: N802
        if urlsplit(self.path).path == "/health":
            self._respond(200, {"ok": True})
            return
        self._respond(404, {"error": "not found"})

    def do_POST(self) -> None:  # noqa: N802
        if urlsplit(self.path).path.rstrip("/") != "/verify":
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
        except (UnicodeDecodeError, json.JSONDecodeError, OSError, TimeoutError):
            self._respond(400, {"error": "bad json"})
            return
        if not isinstance(body, dict):
            self._respond(400, {"error": "bad json"})
            return
        checkpoint_id = body.get("checkpointId")
        submission = body.get("submission")
        correct = isinstance(checkpoint_id, str) and evaluate(checkpoint_id, submission)
        self._respond(200, {"checkpointId": checkpoint_id, "correct": correct})

    def _respond(self, status: int, payload: object) -> None:
        encoded = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("content-type", "application/json; charset=utf-8")
        self.send_header("content-length", str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)

    def log_message(self, _format: str, *_args: object) -> None:
        return


def main() -> None:
    port = int(os.environ.get("VERIFY_PORT", "18561"))
    # Inside the container, the Workbench reaches this verifier over the Compose bridge,
    # so it must listen on every interface rather than only its own loopback.
    # docker-compose.yml publishes only the Workbench on host loopback; the verifier has
    # no host port.
    HTTPServer(("0.0.0.0", port), Handler).serve_forever()  # noqa: S104 - see above


if __name__ == "__main__":
    main()
