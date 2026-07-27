"""POST /verify — the scoring seam. Loopback only, stdlib only.

Same security contract as the AC26 template (docs/curricula/advanced-cryptography-2026/
TEMPLATE.md): required and echoed `checkpointId`, throwaway workspace, wall-clock
timeout, memory / process / output caps, no shell, nothing leaked back but a property
name, and malformed input can never kill the process.

The grading rule specific to this problem: a label is never accepted on its own. Every
`False` in the property matrix has a matching counterexample checkpoint, and the
transfer checkpoint re-runs the learner's own generators against instances they have
never seen.
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

from fixtures.generate import (
    PROTOCOL_IDS,
    TRUTH,
    boundary_instance,
    health_token,
    in_range,
    instance,
    is_true_statement,
    verify,
)

ROOT = Path(__file__).resolve().parents[1]
SEED = os.environ.get("FLAG_SEED", "local-dev-seed")

MAX_BODY_BYTES = 256 * 1024
RUN_TIMEOUT_SECONDS = 15
MAX_ADDRESS_SPACE_BYTES = 512 * 1024 * 1024
MAX_PROCESSES = 64
MAX_OUTPUT_BYTES = 64 * 1024
#: Wall clock for reading a request body, so a stalled client cannot pin the server.
REQUEST_TIMEOUT_SECONDS = 15

CHECKPOINTS = ("incompleteness", "unsoundness", "privacy-leak", "property-matrix", "transfer")
PROPERTIES = ("complete", "sound", "private")


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


def _normalized_int(value: object) -> int | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, str):
        try:
            return int(value.strip(), 10)
        except ValueError:
            return None
    return None


def _check_incompleteness(submission: object) -> bool:
    """A valid witness that P1 nevertheless rejects."""
    w = _normalized_int(submission)
    if w is None:
        return False
    inst = boundary_instance(SEED)
    return is_true_statement(inst, w) and not verify("p1", inst, w)[0]


def _check_unsoundness(submission: object) -> bool:
    """An out-of-range witness that P2 nevertheless accepts."""
    w = _normalized_int(submission)
    if w is None:
        return False
    inst = instance(SEED)
    return (not in_range(inst, w)) and verify("p2", inst, w)[0]


def _check_privacy_leak(submission: object) -> bool:
    """The witness, recovered from the P3 transcript the learner was shown."""
    w = _normalized_int(submission)
    if w is None:
        return False
    return w == instance(SEED).witness


def _check_property_matrix(submission: object) -> bool:
    """The full 3x3 matrix. Partial credit lives in the other checkpoints, not here."""
    matrix = submission
    if isinstance(matrix, str):
        try:
            matrix = json.loads(matrix)
        except json.JSONDecodeError:
            return False
    if not isinstance(matrix, dict):
        return False
    for protocol_id in PROTOCOL_IDS:
        answer = matrix.get(protocol_id)
        if not isinstance(answer, dict):
            return False
        for prop in PROPERTIES:
            if answer.get(prop) is not TRUTH[protocol_id][prop]:
                return False
    return True


RUNNER = """
import json, os, sys
sys.path.insert(0, {root!r})
sys.path.insert(0, {workspace!r})
from tests.hidden.check_properties import run
try:
    from classify import classify
    import counterexamples
except Exception as error:
    print(json.dumps({{"failures": ["submission could not be imported: " + type(error).__name__]}}))
    sys.stdout.flush()
    os._exit(0)
print(json.dumps({{"failures": run(classify, counterexamples, {seed!r})}}))
sys.stdout.flush()
os._exit(0)
"""


def _check_transfer(submission: object) -> bool:
    """Run the learner's own classify + generators against unseen instances."""
    files = submission
    if isinstance(files, str):
        try:
            files = json.loads(files)
        except json.JSONDecodeError:
            return False
    if not isinstance(files, dict):
        return False
    sources = {name: files.get(name) for name in ("classify.py", "counterexamples.py")}
    if any(not isinstance(text, str) or not text.strip() for text in sources.values()):
        return False
    if sum(len(text) for text in sources.values() if isinstance(text, str)) > MAX_BODY_BYTES:
        return False

    with tempfile.TemporaryDirectory() as workspace:
        for name, text in sources.items():
            if isinstance(text, str):
                (Path(workspace) / name).write_text(text, encoding="utf-8")
        script = RUNNER.format(root=str(ROOT), workspace=workspace, seed=f"{SEED}:transfer")
        try:
            # stdout goes to a real file, not a pipe. RLIMIT_FSIZE only bounds writes to
            # files, so with `capture_output=True` a submission that printed gigabytes
            # would have them buffered in THIS process before the tail slice threw them
            # away. Writing to a file inside the workspace makes the cap actually bind:
            # the child is killed by SIGXFSZ at the limit instead.
            transcript = Path(workspace) / "stdout"
            with transcript.open("w", encoding="utf-8") as sink:
                completed = subprocess.run(  # noqa: S603 - argument list, shell=False
                    [sys.executable, "-I", "-c", script],
                    stdout=sink,
                    stderr=subprocess.DEVNULL,
                    text=True,
                    timeout=RUN_TIMEOUT_SECONDS,
                    preexec_fn=_limits,
                    cwd=workspace,
                    env={"PATH": "/usr/local/bin:/usr/bin:/bin"},
                    check=False,
                )
            captured = transcript.read_text(encoding="utf-8", errors="replace")
        except (subprocess.TimeoutExpired, OSError, ValueError):
            return False
    if completed.returncode != 0:
        return False
    for line in reversed(captured[-MAX_OUTPUT_BYTES:].splitlines()):
        try:
            payload = json.loads(line)
        except json.JSONDecodeError:
            continue
        failures = payload.get("failures")
        return isinstance(failures, list) and len(failures) == 0
    return False


def evaluate(checkpoint_id: str, submission: object) -> bool:
    if checkpoint_id == "incompleteness":
        return _check_incompleteness(submission)
    if checkpoint_id == "unsoundness":
        return _check_unsoundness(submission)
    if checkpoint_id == "privacy-leak":
        return _check_privacy_leak(submission)
    if checkpoint_id == "property-matrix":
        return _check_property_matrix(submission)
    if checkpoint_id == "transfer":
        return _check_transfer(submission)
    return False


class Handler(BaseHTTPRequestHandler):
    #: `StreamRequestHandler.setup` applies this to the socket before `rfile` is created,
    #: so it bounds `rfile.read` inside `do_POST` -- which a client that sends a
    #: content-length and then stops sending would otherwise block on forever, pinning
    #: this single-threaded server. Setting it here rather than in an overridden `setup`
    #: is deliberate: `self.connection` does not exist until the base `setup` has run.
    timeout = REQUEST_TIMEOUT_SECONDS

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
            correct = evaluate(checkpoint_id, body.get("submission"))
        except Exception:  # noqa: BLE001 - a broken checkpoint must not kill the verifier
            correct = False
        self._respond(200, {"checkpointId": checkpoint_id, "correct": correct})

    def log_message(self, *_args: object) -> None:
        """Silence the default access log; it would echo submissions."""

    def _respond(self, status: int, payload: dict[str, object]) -> None:
        encoded = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)


def main() -> None:
    port = int(os.environ.get("VERIFY_PORT", "18092"))
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
