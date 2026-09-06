"""Internal grading authority with a separate untrusted function worker.

The existing bounded grading process runs the hidden checker and exact range search.
It never imports learner modules: it asks an isolated worker for JSON values and
checks them itself. The worker has neither seed nor checker nor expected answers.
Its stdout is a separate value channel, so printed failures are not a verdict.
"""

from __future__ import annotations

import json
import os
import resource
import signal
import subprocess
import sys
import tempfile
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from urllib.parse import urlsplit

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fixtures.generate import broken_diagnosis, public_payload
from participant.isolation import protect_supervisor

ROOT = Path(__file__).resolve().parents[1]
SEED = os.environ.get("FLAG_SEED", "local-dev-seed")

MAX_BODY_BYTES = 256 * 1024
RUN_TIMEOUT_SECONDS = 20
MAX_ADDRESS_SPACE_BYTES = 512 * 1024 * 1024
MAX_PROCESSES = 64
MAX_OUTPUT_BYTES = 64 * 1024
#: Wall clock for reading a request body, so a stalled client cannot pin the server.
REQUEST_TIMEOUT_SECONDS = 15
#: Cap for the failed-code-checkpoint `message`, under the platform's 2000-char schema.
MAX_MESSAGE_CHARS = 1900

SUBMITTED_FILES = ("field.py", "circuit.py", "gadgets.py")
# checkpoint id -> the hidden-suite phase it is graded on
CODE_CHECKPOINTS = {
    "residuals": ("check_normalize", "check_residuals", "check_order_independence", "check_missing_signal"),
    "boolean": ("check_boolean",),
    "membership": ("check_membership",),
    "range": ("check_range",),
}
CHECKPOINTS = ("residuals", "first-broken", "boolean", "membership", "range")

# Darwin aliases RLIMIT_AS onto RLIMIT_RSS and refuses to set it, while still
# reporting RLIM_INFINITY for it. Setting it anyway raises inside `preexec_fn` and
# aborts the exec, so on a macOS checkout every submission run failed — including
# the reference. The lab runs on Linux, where the cap does apply, so skipping it on
# Darwin does not change what participants run. See the same note in
# ac26-bridge-experiment's verifier.
_ADDRESS_SPACE_CAPPABLE = sys.platform.startswith("linux")


def _limits() -> None:
    if _ADDRESS_SPACE_CAPPABLE:
        resource.setrlimit(resource.RLIMIT_AS, (MAX_ADDRESS_SPACE_BYTES, MAX_ADDRESS_SPACE_BYTES))
    resource.setrlimit(resource.RLIMIT_NPROC, (MAX_PROCESSES, MAX_PROCESSES))
    resource.setrlimit(resource.RLIMIT_FSIZE, (MAX_OUTPUT_BYTES, MAX_OUTPUT_BYTES))


def _check_first_broken(submission: object) -> bool:
    """The learner's reading of the first non-zero trace row."""
    answer = submission
    if isinstance(answer, str):
        try:
            answer = json.loads(answer)
        except json.JSONDecodeError:
            return False
    if not isinstance(answer, dict) or set(answer) != {"constraintId", "residual"}:
        return False
    residual = answer.get("residual")
    if isinstance(residual, bool) or not isinstance(residual, int):
        return False
    return answer == broken_diagnosis(SEED)


def _submission_sources(files: object) -> dict[str, str] | None:
    if not isinstance(files, dict):
        return None
    sources = {name: files.get(name) for name in SUBMITTED_FILES}
    if any(not isinstance(text, str) or not text.strip() for text in sources.values()):
        return None
    normalized = {name: text for name, text in sources.items() if isinstance(text, str)}
    if sum(len(text) for text in normalized.values()) > MAX_BODY_BYTES:
        return None
    return normalized


def _run_submission_script(
    sources: dict[str, str], script: str, seed: str, **extra: object
) -> tuple[int, str] | None:
    """Run Portal-edited Python with the verifier's existing resource limits."""
    with tempfile.TemporaryDirectory() as workspace:
        for name, text in sources.items():
            (Path(workspace) / name).write_text(text, encoding="utf-8")
        transcript = Path(workspace) / "stdout"
        process = None
        try:
            with transcript.open("w", encoding="utf-8") as sink:
                process = subprocess.Popen(
                    [sys.executable, "-I", "-c", script.format(root=str(ROOT), workspace=workspace, seed=seed, **extra)],
                    stdout=sink, stderr=subprocess.STDOUT, text=True,
                    preexec_fn=_limits, cwd=workspace,
                    env={"PATH": "/usr/local/bin:/usr/bin:/bin", "PYTHONDONTWRITEBYTECODE": "1"},
                    start_new_session=True,
                )
                process.wait(timeout=RUN_TIMEOUT_SECONDS)
            captured = transcript.read_text(encoding="utf-8", errors="replace")
        except (subprocess.TimeoutExpired, OSError, ValueError):
            return None
        finally:
            if process is not None:
                try:
                    os.killpg(process.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
                process.wait()
        return process.returncode, captured[-MAX_OUTPUT_BYTES:]


RUNNER = """
import json, os, sys
sys.path.insert(0, {root!r})
from participant.execution import LearnerSession
from participant.isolation import protect_supervisor
from tests.hidden import check_circuit
protect_supervisor()
sources = {{name: open({workspace!r}+"/"+name, encoding="utf-8").read()
            for name in ("field.py", "circuit.py", "gadgets.py")}}
failures = []
try:
    with LearnerSession(sources, separate_session=False) as learner:
        field, circuit, gadgets = learner.modules()
        for name in {phases!r}:
            checker = getattr(check_circuit, name)
            if name == "check_normalize":
                failures.extend(checker(field, {seed!r}))
            elif name in ("check_boolean", "check_membership", "check_range"):
                failures.extend(checker(gadgets, {seed!r}))
            else:
                failures.extend(checker(circuit, field, {seed!r}))
except Exception:
    failures.append("The submitted functions could not return the required values within the execution limits.")
print(json.dumps({{"failures": failures}}), flush=True)
os._exit(0)
"""


def _failure_detail(failures: list[object]) -> str:
    """Join the checker's property-level failure strings for the response `message`.

    The checker's strings name broken properties the starter docstrings already
    state, never expected values (AGENTS.md §15). Non-string entries are dropped
    rather than serialized.
    """
    return "; ".join(dict.fromkeys(item for item in failures if isinstance(item, str)))[:MAX_MESSAGE_CHARS]


def _run_submission(submission: object, phases: tuple[str, ...], seed: str) -> tuple[bool, str]:
    """Verdict plus, on failure, the checker's failure summary for `message`."""
    files = submission
    if isinstance(files, str):
        try:
            files = json.loads(files)
        except json.JSONDecodeError:
            return False, ""
    sources = _submission_sources(files)
    if sources is None:
        return False, ""
    result = _run_submission_script(sources, RUNNER, seed, phases=list(phases))
    if result is None or result[0] != 0:
        return False, ""
    for line in reversed(result[1].splitlines()):
        try:
            payload = json.loads(line)
        except json.JSONDecodeError:
            continue
        failures = payload.get("failures")
        if not isinstance(failures, list):
            return False, ""
        return len(failures) == 0, _failure_detail(failures)
    return False, ""


def evaluate(checkpoint_id: str, submission: object) -> tuple[bool, str]:
    """Verdict plus, for a failed code checkpoint, a property-level failure summary.

    The direct-answer checkpoint never carries detail: a reason would narrow its
    expected value (AGENTS.md §15).
    """
    if checkpoint_id == "first-broken":
        return _check_first_broken(submission), ""
    if checkpoint_id in CODE_CHECKPOINTS:
        # Every code checkpoint grades on the hidden labels (h0-h2): fields, circuit
        # orderings, allowed sets and range widths the visible instance never shows.
        return _run_submission(submission, CODE_CHECKPOINTS[checkpoint_id], SEED)
    return False, ""


class Handler(BaseHTTPRequestHandler):
    #: `StreamRequestHandler.setup` applies this to the socket before `rfile` is created,
    #: so it bounds `rfile.read` inside `do_POST` -- which a client that sends a
    #: content-length and then stops sending would otherwise block on forever, pinning
    #: this single-threaded server. Setting it here rather than in an overridden `setup`
    #: is deliberate: `self.connection` does not exist until the base `setup` has run.
    timeout = REQUEST_TIMEOUT_SECONDS

    def do_GET(self) -> None:  # noqa: N802 - BaseHTTPRequestHandler's name
        path = urlsplit(self.path).path
        if path == "/healthz":
            self._respond(200, {"ok": True})
            return
        if path == "/public":
            self._respond(200, public_payload(SEED))
            return
        self._respond(404, {"error": "not found"})

    def do_POST(self) -> None:  # noqa: N802 - BaseHTTPRequestHandler's name
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
        except (UnicodeDecodeError, json.JSONDecodeError):
            self._respond(400, {"error": "bad json"})
            return
        except (TimeoutError, OSError):
            # A stalled body read, not a malformed one. Same fail-closed outcome.
            self._respond(400, {"error": "incomplete body"})
            return
        if not isinstance(body, dict):
            self._respond(400, {"error": "bad json"})
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
        try:
            correct, detail = evaluate(checkpoint_id, body.get("submission"))
        except Exception:  # noqa: BLE001 - a broken checkpoint must not kill the verifier
            correct, detail = False, ""
        payload: dict[str, object] = {"checkpointId": checkpoint_id, "correct": correct}
        if not correct and detail:
            payload["message"] = detail
        self._respond(200, payload)

    def log_message(self, *_args: object) -> None:
        """Silence the default access log; it would echo submissions."""

    def _respond(self, status: int, payload: dict[str, object]) -> None:
        encoded = json.dumps(payload).encode("utf-8")
        self._respond_bytes(status, encoded, "application/json")

    def _respond_bytes(self, status: int, encoded: bytes, content_type: str) -> None:
        self.send_response(status)
        self.send_header("content-type", content_type)
        self.send_header("content-length", str(len(encoded)))
        self.send_header("cache-control", "no-store")
        self.send_header("x-content-type-options", "nosniff")
        self.send_header(
            "content-security-policy",
            "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; "
            "img-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; "
            "form-action 'self'",
        )
        self.end_headers()
        self.wfile.write(encoded)


def main() -> None:
    protect_supervisor()
    port = int(os.environ.get("VERIFY_PORT", "18094"))
    # Bind every interface *inside the container*, not the container's loopback. The
    # Workbench reaches this process as `verifier:<port>` over the Compose network, which
    # resolves to this container's bridge address -- a server listening only on
    # 127.0.0.1 inside the container would accept nothing from it, and the platform
    # could never score the problem.
    #
    # Since Issue 543/537 this service publishes no host port at all (see
    # docker-compose.yml): it sits on the `lab` network, which is `internal: true` and so
    # carries no gateway. Nothing but the Workbench container can reach it.
    HTTPServer(("0.0.0.0", port), Handler).serve_forever()  # noqa: S104 - see above


if __name__ == "__main__":
    main()
