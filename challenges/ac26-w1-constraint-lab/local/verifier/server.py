"""POST /verify — the scoring seam. Loopback only, stdlib only.

Same security contract as the AC26 template: required and echoed `checkpointId`,
throwaway workspace, wall-clock timeout, memory / process / output caps, no shell,
nothing leaked back but a property name, and malformed input can never kill the
process.

Four of the five checkpoints run the learner's own three files against hidden
fields, circuits and orderings; the fifth is a direct answer about a trace.
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
    allowed_set,
    broken_diagnosis,
    broken_witness,
    circuit,
    field_modulus,
    health_token,
    honest_witness,
)

ROOT = Path(__file__).resolve().parents[1]
SEED = os.environ.get("FLAG_SEED", "local-dev-seed")

MAX_BODY_BYTES = 256 * 1024
RUN_TIMEOUT_SECONDS = 20
MAX_ADDRESS_SPACE_BYTES = 512 * 1024 * 1024
MAX_PROCESSES = 64
MAX_OUTPUT_BYTES = 64 * 1024
#: Wall clock for reading a request body, so a stalled client cannot pin the server.
REQUEST_TIMEOUT_SECONDS = 15

SUBMITTED_FILES = ("field.py", "circuit.py", "gadgets.py")
# checkpoint id -> the hidden-suite phase it is graded on
CODE_CHECKPOINTS = {
    "residuals": ("check_normalize", "check_residuals", "check_order_independence", "check_missing_signal"),
    "boolean": ("check_boolean",),
    "membership": ("check_membership",),
    "transfer": (),  # empty tuple means "the whole suite"
}
CHECKPOINTS = ("residuals", "first-broken", "boolean", "membership", "transfer")
#: The four checkpoints whose portal submission is the learner's three files as JSON.
FILE_CHECKPOINTS = ("residuals", "boolean", "membership", "transfer")
CODE_CHECKPOINTS_FOR_PORTAL = frozenset(FILE_CHECKPOINTS)
CHECKPOINT_LABELS = {
    "residuals": "residual を計算して trace を出す",
    "first-broken": "最初の違反箇所と residual を言う",
    "boolean": "signal を 0 か 1 だけに縛る",
    "membership": "許可された値だけを通す",
    "transfer": "見たことのない回路でも成立させる",
}

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


def starter_payload() -> dict[str, str]:
    """Return the three editable files shipped to the Portal editor."""
    return {
        name: (ROOT / "starter" / name).read_text(encoding="utf-8") for name in SUBMITTED_FILES
    }


def config_payload() -> dict[str, object]:
    """Declare the generic editor contract consumed by the Participant Portal."""
    return {
        "id": "ac26-w1-constraint-lab",
        "name": "0 になるべき式の集まり",
        "description": "constraint の residual と最初の破綻を読み、gadget を完成させる。",
        "submittedFiles": list(SUBMITTED_FILES),
        "checkpoints": [
            {
                "id": checkpoint,
                "label": CHECKPOINT_LABELS[checkpoint],
                "kind": "code" if checkpoint in CODE_CHECKPOINTS_FOR_PORTAL else "answer",
            }
            for checkpoint in CHECKPOINTS
        ],
        # 英語は Portal 側の locale が選ぶ (共有 workbench.py の config_payload と同じ契約)。
        # 文言の正本は metadata.json — scripts/generate-course-workbenches.py --check が
        # 乖離を落とす (#381)。 この payload は手書きなので、 直すときはここを編集する。
        "i18n": {
            "en": {
                "name": 'A set of things that must be zero',
                "description": 'The new policy engine expresses access decisions as an arithmetic circuit instead of if-statements. The monitor only prints pass or fail. Make the residuals visible so a witness can be diagnosed.',
                "checkpointLabels": {'residuals': 'Compute residuals and emit a trace', 'first-broken': 'Name the first violation and its residual', 'boolean': 'Bind a signal to 0 or 1 only', 'membership': 'Admit only the allowed values', 'transfer': 'Hold up on circuits you have not seen'},
            }
        },
    }


def inspect_payload(seed: str) -> dict[str, object]:
    """Build the seeded evidence shown by the browser's inspect command.

    Same facts as `show.py`. The id of the first violated constraint stays out of
    the payload: it is the answer to the `first-broken` checkpoint.
    """
    witness, _expected = broken_witness(seed)
    return {
        "field": {
            "p": field_modulus(seed),
            "allowedSet": allowed_set(seed),
        },
        "circuit": circuit(seed),
        "honestWitness": honest_witness(seed),
        "brokenWitness": witness,
        "healthToken": health_token(seed),
    }


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
        try:
            # stdout goes to a real file, not a pipe. RLIMIT_FSIZE only bounds writes to
            # files, so with `capture_output=True` a submission that printed gigabytes
            # would have them buffered in THIS process before the tail slice threw them
            # away. Writing to a file inside the workspace makes the cap actually bind:
            # the child is killed by SIGXFSZ at the limit instead.
            with transcript.open("w", encoding="utf-8") as sink:
                completed = subprocess.run(  # noqa: S603 - argument list, shell=False
                    [
                        sys.executable,
                        "-I",
                        "-c",
                        script.format(root=str(ROOT), workspace=workspace, seed=seed, **extra),
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


PUBLIC_TEST_SCRIPT = """
import os, runpy
os.environ["FLAG_SEED"] = {seed!r}
os.environ["SUBMISSION_DIR"] = {workspace!r}
os.environ["BROWSER_PUBLIC_TESTS"] = "1"
runpy.run_path({root!r} + "/tests/public/test_circuit.py", run_name="__main__")
"""


def run_public_tests(seed: str, files: object) -> dict[str, object]:
    """Run the same checks as `make test` against the Portal-edited sources."""
    sources = _submission_sources(files)
    if sources is None:
        return {"passed": False, "output": "All three editable Python files are required."}
    result = _run_submission_script(sources, PUBLIC_TEST_SCRIPT, seed)
    if result is None:
        return {"passed": False, "output": "Public tests timed out or could not start."}
    return {"passed": result[0] == 0, "output": result[1]}


def prepare_submissions(seed: str, files: object) -> dict[str, object]:
    """Format the JSON bundle the four code checkpoints take.

    `first-broken` is deliberately absent: it is read off the broken witness's
    trace by the learner. Producing it here would erase what that checkpoint
    measures. The seed does not enter the bundle; it stays in the signature so
    every Portal prepare API has the same shape.
    """
    del seed
    sources = _submission_sources(files)
    if sources is None:
        return {"ok": False, "output": "All three editable Python files are required."}
    bundle = json.dumps(sources, separators=(",", ":"))
    return {
        "ok": True,
        "submissions": {checkpoint: bundle for checkpoint in FILE_CHECKPOINTS},
    }


RUNNER = """
import json, os, sys
sys.path.insert(0, {root!r})
sys.path.insert(0, {workspace!r})
from tests.hidden import check_circuit
try:
    import field, circuit, gadgets
except Exception as error:
    print(json.dumps({{"failures": ["submission could not be imported: " + type(error).__name__]}}))
    sys.stdout.flush()
    os._exit(0)
phases = {phases!r}
if phases:
    failures = []
    for name in phases:
        checker = getattr(check_circuit, name)
        if name in ("check_normalize",):
            failures.extend(checker(field, {seed!r}))
        elif name in ("check_boolean", "check_membership"):
            failures.extend(checker(gadgets, circuit, field, {seed!r}))
        else:
            failures.extend(checker(circuit, field, {seed!r}))
else:
    failures = check_circuit.run(field, circuit, gadgets, {seed!r})
print(json.dumps({{"failures": failures}}))
sys.stdout.flush()
os._exit(0)
"""


def _run_submission(submission: object, phases: tuple[str, ...], seed: str) -> bool:
    files = submission
    if isinstance(files, str):
        try:
            files = json.loads(files)
        except json.JSONDecodeError:
            return False
    sources = _submission_sources(files)
    if sources is None:
        return False
    result = _run_submission_script(sources, RUNNER, seed, phases=list(phases))
    if result is None or result[0] != 0:
        return False
    for line in reversed(result[1].splitlines()):
        try:
            payload = json.loads(line)
        except json.JSONDecodeError:
            continue
        failures = payload.get("failures")
        return isinstance(failures, list) and len(failures) == 0
    return False


def evaluate(checkpoint_id: str, submission: object) -> bool:
    if checkpoint_id == "first-broken":
        return _check_first_broken(submission)
    if checkpoint_id in CODE_CHECKPOINTS:
        # The transfer checkpoint uses a different seed, so nothing tuned to the
        # visible instance carries over.
        seed = f"{SEED}:transfer" if checkpoint_id == "transfer" else SEED
        return _run_submission(submission, CODE_CHECKPOINTS[checkpoint_id], seed)
    return False


class Handler(BaseHTTPRequestHandler):
    #: `StreamRequestHandler.setup` applies this to the socket before `rfile` is created,
    #: so it bounds `rfile.read` inside `do_POST` -- which a client that sends a
    #: content-length and then stops sending would otherwise block on forever, pinning
    #: this single-threaded server. Setting it here rather than in an overridden `setup`
    #: is deliberate: `self.connection` does not exist until the base `setup` has run.
    timeout = REQUEST_TIMEOUT_SECONDS

    def do_GET(self) -> None:  # noqa: N802 - BaseHTTPRequestHandler's name
        path = urlsplit(self.path).path
        if path == "/api/config":
            self._respond(200, config_payload())
            return
        if path == "/api/inspect":
            self._respond(200, inspect_payload(SEED))
            return
        if path == "/api/starter":
            self._respond(200, starter_payload())
            return
        self._respond(404, {"error": "not found"})

    def do_POST(self) -> None:  # noqa: N802 - BaseHTTPRequestHandler's name
        path = urlsplit(self.path).path.rstrip("/") or "/"
        if path not in ("/verify", "/api/test", "/api/prepare"):
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

        if path == "/api/test":
            self._respond(200, run_public_tests(SEED, body.get("files")))
            return
        if path == "/api/prepare":
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
            correct = evaluate(checkpoint_id, body.get("submission"))
        except Exception:  # noqa: BLE001 - a broken checkpoint must not kill the verifier
            correct = False
        self._respond(200, {"checkpointId": checkpoint_id, "correct": correct})

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
