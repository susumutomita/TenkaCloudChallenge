"""POST /verify -- the scoring seam. Compose-internal only, stdlib only.

Same security contract as the AC26 template (docs/curricula/advanced-cryptography-2026/
TEMPLATE.md): required and echoed `checkpointId`, throwaway workspace, wall-clock
timeout, memory / process / output caps, no shell, nothing leaked back but property
names (a failed `transfer` additionally carries the checker's property-level failure
list as `message`, AGENTS.md §15), and malformed input can never kill the process.

The grading rule specific to this problem: a label is never accepted on its own. Every
`False` in the property matrix has a matching counterexample checkpoint, and the
transfer checkpoint re-runs the learner's own generators against instances they have
never seen.

Issue 543/537: this used to be the same process that also served the Participant
Portal's config, inspect, starter, public-test, and prepare endpoints, in the single
Docker stage a learner's own `make build` produced -- so `privacy-leak`'s expected
value (`instance(seed).witness`) was importable from inside the learner's own
container, and `incompleteness`'s undisclosed boundary instance was too. That
Portal-facing surface now lives in `participant/server.py`, in a separate image (see
../Dockerfile) that this process's own container never builds; this file is reachable
only over the Compose-internal network (see ../docker-compose.yml), never from the
participant container's filesystem.
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
from urllib.parse import urlsplit

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fixtures.generate import (
    TRUTH,
    boundary_instance,
    in_range,
    instance,
    is_true_statement,
    protocol_for,
    protocol_ids,
    public_payload,
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
#: Cap for the failed-code-checkpoint `message`, under the platform's 2000-char schema.
MAX_MESSAGE_CHARS = 1900

CHECKPOINTS = ("incompleteness", "unsoundness", "privacy-leak", "property-matrix", "transfer")
PROPERTIES = ("complete", "sound", "private")
SUBMISSION_FILES = ("classify.py", "counterexamples.py")
CODE_CHECKPOINTS = frozenset(("transfer",))

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


def _submission_sources(files: object) -> dict[str, str] | None:
    if not isinstance(files, dict):
        return None
    sources = {name: files.get(name) for name in SUBMISSION_FILES}
    if any(not isinstance(text, str) or not text.strip() for text in sources.values()):
        return None
    normalized = {name: text for name, text in sources.items() if isinstance(text, str)}
    if sum(len(text) for text in normalized.values()) > MAX_BODY_BYTES:
        return None
    return normalized


def _run_submission_script(
    sources: dict[str, str], script: str, seed: str
) -> tuple[int, str] | None:
    """Run Portal-edited Python with the verifier's existing resource limits."""
    with tempfile.TemporaryDirectory() as workspace:
        for name, text in sources.items():
            (Path(workspace) / name).write_text(text, encoding="utf-8")
        transcript = Path(workspace) / "stdout"
        try:
            with transcript.open("w", encoding="utf-8") as sink:
                completed = subprocess.run(  # noqa: S603 - argument list, shell=False
                    [
                        sys.executable,
                        "-I",
                        "-c",
                        script.format(root=str(ROOT), workspace=workspace, seed=seed),
                    ],
                    stdout=sink,
                    stderr=subprocess.STDOUT,
                    text=True,
                    timeout=RUN_TIMEOUT_SECONDS,
                    preexec_fn=_limits,
                    cwd=workspace,
                    env={"PATH": "/usr/local/bin:/usr/bin:/bin"},
                    check=False,
                )
            captured = transcript.read_text(encoding="utf-8", errors="replace")
        except (subprocess.TimeoutExpired, OSError, ValueError):
            return None
    return completed.returncode, captured[-MAX_OUTPUT_BYTES:]


PREPARE_SCRIPT = """
import json, sys
sys.path.insert(0, {root!r})
sys.path.insert(0, {workspace!r})
from fixtures.generate import boundary_instance, instance, protocol_for, protocol_ids, verify
from classify import classify
import counterexamples
seed = {seed!r}
inst = instance(seed)
boundary = boundary_instance(seed)
_accepted, transcript = verify(protocol_for(seed, "leaky"), inst, inst.witness)
sources = {{name: open(name, encoding="utf-8").read() for name in ("classify.py", "counterexamples.py")}}
submissions = {{
    "incompleteness": str(counterexamples.incompleteness_witness(boundary.as_public())),
    "unsoundness": str(counterexamples.unsoundness_witness(inst.as_public())),
    "privacy-leak": str(counterexamples.extract_witness(transcript)),
    "property-matrix": json.dumps({{protocol_id: classify(protocol_id) for protocol_id in protocol_ids(seed)}}, separators=(",", ":")),
    "transfer": json.dumps(sources, separators=(",", ":")),
}}
print(json.dumps({{"submissions": submissions}}, separators=(",", ":")))
"""


def prepare_submissions(seed: str, files: object) -> dict[str, object]:
    """Evaluate learner functions and format values for the five portal fields.

    Runs the submitted `classify.py` / `counterexamples.py` against `boundary_instance`
    -- deliberately never disclosed elsewhere (see `fixtures.generate.public_payload`)
    -- which is why this has to happen here rather than in `participant/server.py`:
    that process does not carry `fixtures/` at all (Issue 543/537).
    """
    sources = _submission_sources(files)
    if sources is None:
        return {"ok": False, "output": "Both editable Python files are required."}
    result = _run_submission_script(sources, PREPARE_SCRIPT, seed)
    if result is None:
        return {"ok": False, "output": "Submission preparation timed out or could not start."}
    returncode, captured = result
    if returncode == 0:
        for line in reversed(captured.splitlines()):
            try:
                payload = json.loads(line)
            except json.JSONDecodeError:
                continue
            submissions = payload.get("submissions")
            if isinstance(submissions, dict):
                return {"ok": True, "submissions": submissions}
    return {"ok": False, "output": captured or "Submission preparation failed."}


def _check_incompleteness(submission: object) -> bool:
    """A valid witness that P1 nevertheless rejects."""
    w = _normalized_int(submission)
    if w is None:
        return False
    inst = boundary_instance(SEED)
    return is_true_statement(inst, w) and not verify(protocol_for(SEED, "incomplete"), inst, w)[0]


def _check_unsoundness(submission: object) -> bool:
    """An out-of-range witness that P2 nevertheless accepts."""
    w = _normalized_int(submission)
    if w is None:
        return False
    inst = instance(SEED)
    return (not in_range(inst, w)) and verify(protocol_for(SEED, "unsound"), inst, w)[0]


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
    expected_protocols = protocol_ids(SEED)
    if set(matrix) != set(expected_protocols):
        return False
    for protocol_id in expected_protocols:
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


def _failure_detail(failures: list[object]) -> str:
    """Join the checker's property-level failure strings for the response `message`.

    The checker's strings name broken properties, never expected values (AGENTS.md
    §15). Non-string entries are dropped rather than serialized.
    """
    return "; ".join(dict.fromkeys(item for item in failures if isinstance(item, str)))[:MAX_MESSAGE_CHARS]


def _check_transfer(submission: object) -> tuple[bool, str]:
    """Run the learner's own classify + generators against unseen instances.

    Returns the verdict and, on failure, the checker's failure summary for the
    response `message`. An empty string means no detail is surfaced.
    """
    files = submission
    if isinstance(files, str):
        try:
            files = json.loads(files)
        except json.JSONDecodeError:
            return False, ""
    sources = _submission_sources(files)
    if sources is None:
        return False, ""
    result = _run_submission_script(sources, RUNNER, f"{SEED}:transfer")
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

    Direct-answer checkpoints never carry detail: a reason would narrow their
    expected value (AGENTS.md §15).
    """
    if checkpoint_id == "incompleteness":
        return _check_incompleteness(submission), ""
    if checkpoint_id == "unsoundness":
        return _check_unsoundness(submission), ""
    if checkpoint_id == "privacy-leak":
        return _check_privacy_leak(submission), ""
    if checkpoint_id == "property-matrix":
        return _check_property_matrix(submission), ""
    if checkpoint_id == "transfer":
        return _check_transfer(submission)
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
        path = urlsplit(self.path).path.rstrip("/") or "/"
        if path not in ("/verify", "/prepare"):
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

        if path == "/prepare":
            self._respond(200, prepare_submissions(SEED, body.get("files")))
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
    port = int(os.environ.get("VERIFY_PORT", "18093"))
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
