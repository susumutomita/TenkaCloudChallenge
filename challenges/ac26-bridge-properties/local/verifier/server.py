"""Internal grading authority. Learner source never executes beside this checker.

The parent derives synthetic exercise cases from the deployment seed, sends only
function inputs and source to an isolated child, and checks the returned JSON values
itself. Empty failure output or a successful child exit is not a verdict. Error
feedback names documented properties without echoing unseen cases or expected values.
"""

from __future__ import annotations

import json
import os
import sys
from http.server import BaseHTTPRequestHandler, HTTPServer
from types import SimpleNamespace
from pathlib import Path
from urllib.parse import urlsplit

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from participant.execution import run_functions
from participant.isolation import protect_supervisor
from tests.hidden.check_properties import run as check_properties

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


def _call(function, argument):
    return {"function": function, "argument": argument}


def prepare_submissions(seed: str, files: object) -> dict[str, object]:
    """Prepare values from learner outputs; never execute source beside fixtures/checkers."""
    sources = _submission_sources(files)
    if sources is None:
        return {"ok": False, "output": "Both editable Python files are required."}
    inst = instance(seed)
    boundary = boundary_instance(seed)
    _, transcript = verify(protocol_for(seed, "leaky"), inst, inst.witness)
    aliases = protocol_ids(seed)
    calls = [_call("incompleteness_witness", boundary.as_public()),
             _call("unsoundness_witness", inst.as_public()),
             _call("extract_witness", transcript)]
    calls.extend(_call("classify", alias) for alias in aliases)
    result = run_functions(sources, calls)
    values = result and result.get("values")
    if (not isinstance(values, list) or len(values) != len(calls)
            or any(type(value) is not int for value in values[:3])
            or any(not isinstance(value, dict) for value in values[3:])):
        # Captured output may contain unseen input values. Never relay it from prepare.
        return {"ok": False, "output": "Functions must return integers and classification dictionaries; check the editor code."}
    submissions = {"incompleteness": str(values[0]), "unsoundness": str(values[1]),
                   "privacy-leak": str(values[2]),
                   "property-matrix": json.dumps(dict(zip(aliases, values[3:])), separators=(",", ":")),
                   "transfer": json.dumps(sources, separators=(",", ":"))}
    return {"ok": True, "submissions": submissions}


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
    seed = f"{SEED}:transfer"
    calls = [_call("classify", alias) for alias in protocol_ids(SEED)]
    for index in range(3):
        calls.append(_call("incompleteness_witness", boundary_instance(seed, f"inc-{index}").as_public()))
        calls.append(_call("unsoundness_witness", instance(seed, f"uns-{index}").as_public()))
    for index in range(3):
        inst = instance(seed, f"extract-{index}")
        _, transcript = verify(protocol_for(seed, "leaky"), inst, inst.witness)
        calls.append(_call("extract_witness", transcript))
    result = run_functions(sources, calls)
    values = result and result.get("values")
    if not isinstance(values, list) or len(values) != len(calls):
        return False, "The functions did not return the required values within the execution limits."
    # The grader runs in this trusted parent, using only JSON data returned by the
    # child. A fabricated 'failures: []' or exit status is never grading evidence.
    outputs = {(call["function"], json.dumps(call["argument"], sort_keys=True)): value
               for call, value in zip(calls, values)}
    def answer(function):
        return lambda argument: outputs[(function, json.dumps(argument, sort_keys=True))]
    module = SimpleNamespace(**{name: answer(name) for name in
                               ("incompleteness_witness", "unsoundness_witness", "extract_witness")})
    failures = check_properties(answer("classify"), module, seed, matrix_seed=SEED)
    return not failures, _failure_detail(failures)


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
    protect_supervisor()
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
