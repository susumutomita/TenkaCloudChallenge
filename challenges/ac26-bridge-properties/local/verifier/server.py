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
from urllib.parse import urlsplit

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fixtures.generate import (
    TRUTH,
    boundary_instance,
    health_token,
    in_range,
    instance,
    is_true_statement,
    protocol_for,
    protocol_ids,
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
SUBMISSION_FILES = ("classify.py", "counterexamples.py")
CODE_CHECKPOINTS = frozenset(("transfer",))
CHECKPOINT_LABELS = {
    "incompleteness": "正しい入力が弾かれる場面を作る",
    "unsoundness": "主張の範囲外を通してしまう例を作る",
    "privacy-leak": "transcript から秘密を取り出す",
    "property-matrix": "3 つの verifier を性質で分類する",
    "transfer": "見たことのない instance でも成立させる",
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


def starter_payload() -> dict[str, str]:
    """Return the two editable files shipped to the Portal editor."""
    return {
        name: (ROOT / "starter" / name).read_text(encoding="utf-8") for name in SUBMISSION_FILES
    }


def config_payload() -> dict[str, object]:
    """Declare the generic editor contract consumed by the Participant Portal."""
    return {
        "id": "ac26-bridge-properties",
        "name": "満たす性質、破る性質",
        "description": "反例を作り、completeness・soundness・privacy を区別する。",
        "submittedFiles": list(SUBMISSION_FILES),
        "checkpoints": [
            {
                "id": checkpoint,
                "label": CHECKPOINT_LABELS[checkpoint],
                "kind": "code" if checkpoint in CODE_CHECKPOINTS else "answer",
            }
            for checkpoint in CHECKPOINTS
        ],
        # 英語は Portal 側の locale が選ぶ (共有 workbench.py の config_payload と同じ契約)。
        # 文言の正本は metadata.json — scripts/generate-course-workbenches.py --check が
        # 乖離を落とす (#381)。 この payload は手書きなので、 直すときはここを編集する。
        "i18n": {
            "en": {
                "name": 'What it holds, what it breaks',
                "description": 'Three toy verifiers arrive for audit. All of them pass the happy-path tests. They are broken in different ways. Build counterexamples and classify what each one holds and what it breaks.',
                "checkpointLabels": {'incompleteness': 'Make a valid input get rejected', 'unsoundness': 'Get something outside the claim accepted', 'privacy-leak': 'Pull the secret out of a transcript', 'property-matrix': 'Classify the three verifiers by property', 'transfer': 'Hold up on instances you have not seen'},
            }
        },
    }


def inspect_payload(seed: str) -> dict[str, object]:
    """Build the theory and seeded evidence shown by the browser's inspect command."""
    inst = instance(seed)
    verifiers: dict[str, object] = {}
    for protocol_id in protocol_ids(seed):
        _accepted, transcript = verify(protocol_id, inst, inst.witness)
        verifiers[protocol_id] = transcript["checked"]
    privacy_protocol = protocol_for(seed, "leaky")
    _accepted, transcript = verify(privacy_protocol, inst, inst.witness)
    return {
        "definitions": {
            "complete": "正しい主張と正直な witness を、検証者が必ず受理する性質",
            "sound": "主張を満たさない witness を、検証者が受理しない性質",
            "private": "観察者が transcript だけから秘密の witness を復元できない性質",
        },
        "claim": "a*w + b == c (mod p) and lo <= w <= hi",
        "statement": inst.as_public(),
        "verifiers": verifiers,
        "privacyProtocol": privacy_protocol,
        "transcript": transcript,
    }


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


PUBLIC_TEST_SCRIPT = """
import os, runpy
os.environ["FLAG_SEED"] = {seed!r}
os.environ["SUBMISSION_DIR"] = {workspace!r}
os.environ["BROWSER_PUBLIC_TESTS"] = "1"
runpy.run_path({root!r} + "/tests/public/test_properties.py", run_name="__main__")
"""


def run_public_tests(seed: str, files: object) -> dict[str, object]:
    """Run the same shape checks as `make test` against Portal-edited sources."""
    sources = _submission_sources(files)
    if sources is None:
        return {"passed": False, "output": "Both editable Python files are required."}
    result = _run_submission_script(sources, PUBLIC_TEST_SCRIPT, seed)
    if result is None:
        return {"passed": False, "output": "Public tests timed out or could not start."}
    return {"passed": result[0] == 0, "output": result[1]}


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
    """Evaluate learner functions and format values for the five portal fields."""
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


def _check_transfer(submission: object) -> bool:
    """Run the learner's own classify + generators against unseen instances."""
    files = submission
    if isinstance(files, str):
        try:
            files = json.loads(files)
        except json.JSONDecodeError:
            return False
    sources = _submission_sources(files)
    if sources is None:
        return False
    result = _run_submission_script(sources, RUNNER, f"{SEED}:transfer")
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
