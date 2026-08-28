"""POST /verify — the scoring seam. Compose-internal only, stdlib only.

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
  - Responses carry `checkpointId`, `correct` and, on a failed code checkpoint, a
    `message` summarizing the checker's property-level failures (Issue 630). Never
    the hidden test names, the expected values, or reference output.
  - Malformed input produces a failed checkpoint, never a crashed process.

Issue 543/537: this used to be the same process that also served the Participant
Portal's config, inspect, starter, public-test and prepare endpoints, in the single
Docker stage a learner's own `make build` produced -- so `padded_length` and
`broken_pad_zeros_only`, the answers to the `padded-length` and `collision`
checkpoints, were importable from inside the learner's own container, straight out of
`fixtures/generate.py`. That Portal-facing surface now lives in `participant/server.py`,
in a separate image (see ../Dockerfile) that this process's own container never builds;
this file, and the `fixtures/` it imports, are reachable only over the Compose-internal
network (see ../docker-compose.yml), never from the participant container's filesystem.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
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
    LENGTH_FIELD_BYTES,
    broken_pad_zeros_only,
    collision_message,
    length_field_case,
    length_quiz,
    padded_length,
    public_payload,
    text_case,
)

ROOT = Path(__file__).resolve().parents[1]
PROBLEM_ID = "sha256-bytes-padding"
SEED = os.environ.get("FLAG_SEED", "local-dev-seed")

MAX_BODY_BYTES = 256 * 1024
RUN_TIMEOUT_SECONDS = 10
MAX_ADDRESS_SPACE_BYTES = 512 * 1024 * 1024
MAX_PROCESSES = 64
MAX_OUTPUT_BYTES = 64 * 1024
#: Cap for the verdict's optional human-readable failure summary. Kept under the
#: platform's 2000-character message limit with room to spare.
MAX_MESSAGE_CHARS = 1900
#: Wall clock for reading a request body, so a stalled client cannot pin the server.
REQUEST_TIMEOUT_SECONDS = 15

CHECKPOINTS = ("byte-length", "padded-length", "length-field", "pad", "words", "collision")

#: The hidden entry point each code checkpoint runs. Keeping this explicit lets delivery
#: adapters identify code submissions without executing or guessing from verifier logic.
CODE_CHECKPOINTS = {"pad": "run_pad", "words": "run_words"}

#: The checkpoints graded on a pasted value rather than on the learner's file. These
#: must arrive sealed by the Workbench's prepare route (see `_unwrap_submission`); the
#: code checkpoints keep accepting raw source, which is their historical Portal format.
MANUAL_CHECKPOINTS = frozenset(CHECKPOINTS) - frozenset(CODE_CHECKPOINTS)

#: Bounds the `collision` submission. A counterexample fits in one block; anything longer
#: is someone pasting a file, not answering.
MAX_COLLISION_BYTES = 2 * 64


# Darwin aliases RLIMIT_AS onto RLIMIT_RSS and refuses to set it, while still
# reporting RLIM_INFINITY for it. Setting it anyway raises inside `preexec_fn`,
# which aborts the exec — so on a macOS checkout the address-space cap turned
# every submission run into "could not run at all", including the reference.
#
# The lab itself is python:3.12-slim on Linux, where this cap does apply. Skipping
# it on Darwin therefore does not weaken what participants actually run; it makes
# `make reference-test` and `bun run validate` work on a macOS checkout, where the
# alternative was no verification at all. The timeout, process cap, file-size cap,
# `-I` isolation, and throwaway workspace all still apply on every platform.
_ADDRESS_SPACE_CAPPABLE = sys.platform.startswith("linux")


def _limits() -> None:
    """Applied inside the child, before exec. Caps memory, processes, and file size."""
    if _ADDRESS_SPACE_CAPPABLE:
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
        try:
            return int(value.strip(), 10)
        except ValueError:
            return None
    return None


def _normalized_int_list(value: object) -> list[int] | None:
    """Accept `[1, 2]`, `"1,2"`, or `"1 2"`. One separator rule, so a stray space is not a fail."""
    if isinstance(value, list):
        parsed = [_normalized_int(item) for item in value]
        if any(item is None for item in parsed):
            return None
        return [item for item in parsed if item is not None]
    if isinstance(value, str):
        pieces = [piece for piece in value.replace(",", " ").split() if piece]
        if not pieces:
            return None
        return _normalized_int_list(pieces)
    return None


def _normalized_hex(value: object) -> bytes | None:
    """Accept hex with or without `0x`, spaces, or mixed case. Reject anything else."""
    if not isinstance(value, str):
        return None
    text = value.strip().lower().replace("0x", "").replace(":", " ").replace(",", " ")
    compact = "".join(text.split())
    if not compact or len(compact) % 2 != 0:
        return None
    try:
        return bytes.fromhex(compact)
    except ValueError:
        return None


def _check_byte_length(submission: object) -> bool:
    """The UTF-8 byte length of the string `make inspect` shows — not its character count."""
    value = _normalized_int(submission)
    return value is not None and value == text_case(SEED).byte_length


def _check_padded_length(submission: object) -> bool:
    """One padded length per quiz row, in the order `make inspect` prints them."""
    values = _normalized_int_list(submission)
    if values is None:
        return False
    return values == [padded_length(length) for length in length_quiz(SEED)]


def _check_length_field(submission: object) -> bool:
    """The trailing 8 bytes for one message length, as hex. Bits, not bytes; big-endian."""
    submitted = _normalized_hex(submission)
    if submitted is None or len(submitted) != LENGTH_FIELD_BYTES:
        return False
    return submitted == (length_field_case(SEED) * 8).to_bytes(LENGTH_FIELD_BYTES, "big")


def _check_collision(submission: object) -> bool:
    """A second message that zero-only padding cannot tell apart from the given one."""
    candidate = _normalized_hex(submission)
    if candidate is None or not candidate or len(candidate) > MAX_COLLISION_BYTES:
        return False
    original = collision_message(SEED)
    if candidate == original:
        return False
    return broken_pad_zeros_only(candidate) == broken_pad_zeros_only(original)


RUNNER = """
import json, os, sys
from pathlib import Path
sys.path.insert(0, {root!r})
sys.path.insert(0, {workspace!r})
from tests.hidden.check_padding import {entry}
# Issue 591: fixtures/ and tests/hidden/ stay on disk in this image for grading (Issue 543
# option B2 only stopped shipping them to the participant image), so without this the
# submission's own import statement could reach them directly.
_hidden_modules = {{
    name: sys.modules.pop(name)
    for name in tuple(sys.modules)
    if name in ("tests", "fixtures") or name.startswith(("tests.", "fixtures."))
}}
while {root!r} in sys.path:
    sys.path.remove({root!r})
try:
    from padding import {symbol}
except Exception as error:
    print(json.dumps({{"failures": ["submission could not be imported: " + type(error).__name__]}}))
    sys.stdout.flush()
    os._exit(0)
sys.path.insert(0, {root!r})
sys.modules.update(_hidden_modules)
print(json.dumps({{"failures": {entry}({symbol}, {seed!r})}}))
sys.stdout.flush()
os._exit(0)
"""


def _failure_message(failures: list[object]) -> str | None:
    """Join the hidden checker's failure list into one participant-facing message.

    Only checker-authored strings are kept: anything else that ends up in the list
    is dropped rather than serialized, so a checker bug cannot push raw values
    through the message field.
    """
    text = "; ".join(item for item in failures if isinstance(item, str))
    return text[:MAX_MESSAGE_CHARS] if text else None


def _run_hidden(submission: object, entry: str, symbol: str) -> tuple[bool, str | None]:
    """Run one hidden suite against the learner's file in a throwaway workspace."""
    if not isinstance(submission, str) or not submission.strip():
        return False, None
    if len(submission) > MAX_BODY_BYTES:
        return False, None
    with tempfile.TemporaryDirectory() as workspace:
        (Path(workspace) / "padding.py").write_text(submission, encoding="utf-8")
        script = RUNNER.format(
            root=str(ROOT), workspace=workspace, seed=SEED, entry=entry, symbol=symbol
        )
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
            return False, None
    if completed.returncode != 0:
        return False, None
    stdout = captured[-MAX_OUTPUT_BYTES:]
    for line in reversed(stdout.splitlines()):
        try:
            payload = json.loads(line)
        except json.JSONDecodeError:
            continue
        failures = payload.get("failures")
        if not isinstance(failures, list):
            return False, None
        if failures:
            return False, _failure_message(failures)
        return True, None
    return False, None


def evaluate(checkpoint_id: str, submission: object) -> bool:
    """Boolean verdict for callers that need only pass/fail (mutation.py does)."""
    correct, _message = evaluate_with_message(checkpoint_id, submission)
    return correct


def evaluate_with_message(
    checkpoint_id: str, submission: object
) -> tuple[bool, str | None]:
    if checkpoint_id == "byte-length":
        return _check_byte_length(submission), None
    if checkpoint_id == "padded-length":
        return _check_padded_length(submission), None
    if checkpoint_id == "length-field":
        return _check_length_field(submission), None
    if checkpoint_id == "pad":
        return _run_hidden(submission, "run_pad", "pad_message")
    if checkpoint_id == "words":
        return _run_hidden(submission, "run_words", "block_words")
    if checkpoint_id == "collision":
        return _check_collision(submission), None
    return False, None

def _b64decode(value: str) -> bytes:
    padding = "=" * (-len(value) % 4)
    return base64.urlsafe_b64decode(value + padding)


def _unwrap_submission(checkpoint_id: str, submission: object) -> object:
    """Undo the Workbench's `tcw1.` seal and check it against this deployment.

    A direct-answer submission is HMAC-bound to `PROBLEM_ID` and `SEED` by
    `participant/workbench.py`'s `PortalEditorSupport._seal_manual` -- the same
    derivation, duplicated here rather than imported, because that module lives only in
    the participant image (see ../Dockerfile). Repeating it here rather than trusting an
    already-unwrapped value from the Workbench is what keeps the seal meaningful: a
    caller who skips the Workbench and posts a bare padded-length list straight at this
    process is rejected the same way. Same shape as ac26-w2-linear-shares' verifier, for
    the same reason.
    """
    if not isinstance(submission, str) or not submission.startswith("tcw1."):
        return None if checkpoint_id in MANUAL_CHECKPOINTS else submission
    try:
        prefix, encoded_payload, encoded_signature = submission.split(".", 2)
        if prefix != "tcw1":
            return None
        payload = _b64decode(encoded_payload)
        signature = _b64decode(encoded_signature)
        key = hashlib.sha256((PROBLEM_ID + "\0" + SEED).encode("utf-8")).digest()
        expected_signature = hmac.new(key, payload, hashlib.sha256).digest()[:16]
        if not hmac.compare_digest(signature, expected_signature):
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
    """Serve the /verify contract and this deployment's public evidence.

    The Portal editor API is deliberately absent: it lives in `participant/server.py`,
    which runs in the image a learner builds. Everything here runs in the image that
    carries `fixtures/`, and is never published to the host.
    """

    timeout = REQUEST_TIMEOUT_SECONDS

    def do_GET(self) -> None:  # noqa: N802 - BaseHTTPRequestHandler's API
        path = urlsplit(self.path).path
        if path == "/healthz":
            self._respond(200, {"ok": True})
            return
        if path == "/public":
            self._respond(200, public_payload(SEED))
            return
        self._respond(404, {"error": "not found"})

    def do_POST(self) -> None:  # noqa: N802 - BaseHTTPRequestHandler's API
        path = urlsplit(self.path).path.rstrip("/") or "/"
        if path != "/verify":
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
        except Exception:  # noqa: BLE001 - a broken checkpoint must fail closed
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
        """Do not echo source submissions into the access log."""

    def _respond(self, status: int, payload: dict[str, object]) -> None:
        self._respond_bytes(
            status,
            json.dumps(payload, ensure_ascii=False).encode("utf-8"),
            "application/json; charset=utf-8",
        )

    def _respond_bytes(self, status: int, content: bytes, content_type: str) -> None:
        self.send_response(status)
        self.send_header("content-type", content_type)
        self.send_header("content-length", str(len(content)))
        self.send_header("cache-control", "no-store")
        self.send_header("x-content-type-options", "nosniff")
        self.send_header(
            "content-security-policy",
            "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; "
            "img-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; "
            "form-action 'self'",
        )
        self.end_headers()
        self.wfile.write(content)

def main() -> None:
    port = int(os.environ.get("VERIFY_PORT", "18092"))
    # Bind every interface *inside the container*, not the container's loopback: the
    # Workbench reaches this process over the Compose-internal `lab` network, so a
    # server listening only on 127.0.0.1 inside the container would accept nothing from
    # it and the platform could never score the problem.
    #
    # This service publishes no host port at all (see docker-compose.yml), and the `lab`
    # network is `internal: true` -- nothing off this Compose project can reach it.
    HTTPServer(("0.0.0.0", port), Handler).serve_forever()  # noqa: S104 - see above


if __name__ == "__main__":
    main()
