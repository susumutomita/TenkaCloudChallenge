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

Issue 537/538: this used to be the same process that also served the Participant
Portal's config, inspect, starter, public-test and prepare endpoints, in the single
Docker stage a learner's own `make build` produced -- so `rotate`/`mux`'s expected
values (`fixtures.generate.rotate_case` / `mux_case`) and `dependency`'s
(`first_affected_index`, defined right below) were all one import away from a learner's
own container. That Portal-facing surface now lives in `participant/server.py`, in a
separate image (see ../Dockerfile) that this process's own container never builds; this
file, and the `fixtures/` it imports, are reachable only over the Compose-internal
network (see ../docker-compose.yml), never from the participant container's filesystem.

`GET /public` below is what the participant image reads instead of importing
`fixtures.generate`.
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

from fixtures.generate import MASK, WORD_BITS, dependency_case, mux_case, public_payload, rotate_case

ROOT = Path(__file__).resolve().parents[1]
PROBLEM_ID = "sha256-schedule-logic"
SEED = os.environ.get("FLAG_SEED", "local-dev-seed")

MAX_BODY_BYTES = 256 * 1024
RUN_TIMEOUT_SECONDS = 20
MAX_ADDRESS_SPACE_BYTES = 512 * 1024 * 1024
MAX_PROCESSES = 64
MAX_OUTPUT_BYTES = 64 * 1024
#: Cap for the verdict's optional human-readable failure summary. Kept under the
#: platform's 2000-character message limit with room to spare.
MAX_MESSAGE_CHARS = 1900
#: Wall clock for reading a request body, so a stalled client cannot pin the server.
REQUEST_TIMEOUT_SECONDS = 15

CHECKPOINTS = ("rotate", "mux", "dependency", "sigma", "logic", "schedule")

#: The hidden entry point each code checkpoint runs.
CODE_CHECKPOINTS = {"sigma": "run_sigma", "logic": "run_logic", "schedule": "run_schedule"}
#: The checkpoints graded on a pasted value rather than on the learner's file. These
#: must arrive sealed by the Workbench's prepare route (see `_unwrap_submission`); the
#: code checkpoints keep accepting raw source, which is their historical Portal format.
MANUAL_CHECKPOINTS = frozenset(CHECKPOINTS) - frozenset(CODE_CHECKPOINTS)

WORDS_PER_BLOCK = 16
SCHEDULE_WORDS = 64


# Darwin aliases RLIMIT_AS onto RLIMIT_RSS and refuses to set it, while still
# reporting RLIM_INFINITY for it. Setting it anyway raises inside `preexec_fn`,
# which aborts the exec — so on a macOS checkout the address-space cap turned
# every submission run into "could not run at all", including the reference.
#
# The lab itself is python:3.13-slim on Linux, where this cap does apply. Skipping
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


def _hex_word(text: str) -> int | None:
    compact = text.strip().lower().removeprefix("0x")
    if not compact or len(compact) > 8:
        return None
    if any(character not in "0123456789abcdef" for character in compact):
        return None
    return int(compact, 16)


def _normalized_words(value: object, count: int) -> list[int] | None:
    """Parse exactly `count` 32-bit words written in hex.

    Hex only, because these are bit patterns and every fixture is printed that way. A `0x`
    prefix, upper case, and comma or space separators are all accepted; more than eight hex
    digits in a word is not, since that is no longer a word.
    """
    if isinstance(value, list):
        pieces = [item for item in value if isinstance(item, str)]
        if len(pieces) != len(value):
            return None
    elif isinstance(value, str):
        pieces = [piece for piece in value.replace(",", " ").split() if piece]
    else:
        return None
    if len(pieces) != count:
        return None
    words = [_hex_word(piece) for piece in pieces]
    return None if any(word is None for word in words) else [word for word in words if word is not None]


def _check_rotate(submission: object) -> bool:
    """Rotate right by one amount, shift right by another. Two words, in that order."""
    case = rotate_case(SEED)
    words = _normalized_words(submission, 2)
    if words is None:
        return False
    amount = case.rotate_by % WORD_BITS
    rotated = ((case.word >> amount) | (case.word << (WORD_BITS - amount))) & MASK
    return words == [rotated, case.word >> case.shift_by]


def _check_mux(submission: object) -> bool:
    """Ch(e, f, g) for the fixture triple."""
    case = mux_case(SEED)
    words = _normalized_words(submission, 1)
    if words is None:
        return False
    return words[0] == (case.e & case.f) ^ (~case.e & MASK & case.g)


def _rotr(value: int, amount: int) -> int:
    return ((value >> amount) | (value << (WORD_BITS - amount))) & MASK


def reference_schedule(words: list[int]) -> list[int]:
    """The verifier's own expansion, so `dependency` never depends on the learner's."""
    schedule = list(words)
    for index in range(WORDS_PER_BLOCK, SCHEDULE_WORDS):
        left = schedule[index - 15]
        right = schedule[index - 2]
        sigma0 = _rotr(left, 7) ^ _rotr(left, 18) ^ (left >> 3)
        sigma1 = _rotr(right, 17) ^ _rotr(right, 19) ^ (right >> 10)
        schedule.append((schedule[index - 16] + sigma0 + schedule[index - 7] + sigma1) & MASK)
    return schedule


def first_affected_index() -> int:
    """The lowest computed schedule index that changes when the fixture's bit is flipped.

    Computed rather than taken from a formula, so this can never disagree with what the
    expansion actually does. The reasoning a learner is expected to follow gives the same
    answer: W[i] reads indices i-16, i-15, i-7 and i-2, and only indices at or above 16 are
    computed, so it is the smallest of k+16, k+15, k+7 and k+2 that reaches 16. A single
    flipped bit cannot cancel on the way, because each sigma sends a one-bit difference to
    two or three distinct positions whose xor is never zero.
    """
    case = dependency_case(SEED)
    original = list(case.words)
    flipped = list(case.words)
    flipped[case.index] ^= 1 << case.bit
    before = reference_schedule(original)
    after = reference_schedule(flipped)
    return next(
        index for index in range(WORDS_PER_BLOCK, SCHEDULE_WORDS) if before[index] != after[index]
    )


def _check_dependency(submission: object) -> bool:
    value = _normalized_int(submission)
    return value is not None and value == first_affected_index()


RUNNER = """
import json, os, sys
from pathlib import Path
sys.path.insert(0, {root!r})
sys.path.insert(0, {workspace!r})
from tests.hidden.check_schedule import {entry}
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
    import schedule
except Exception as error:
    print(json.dumps({{"failures": ["submission could not be imported: " + type(error).__name__]}}))
    sys.stdout.flush()
    os._exit(0)
sys.path.insert(0, {root!r})
sys.modules.update(_hidden_modules)
print(json.dumps({{"failures": {entry}(schedule, {seed!r})}}))
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


def _run_hidden(submission: object, entry: str) -> tuple[bool, str | None]:
    """Run one hidden suite against the learner's file in a throwaway workspace."""
    if not isinstance(submission, str) or not submission.strip():
        return False, None
    if len(submission) > MAX_BODY_BYTES:
        return False, None
    with tempfile.TemporaryDirectory() as workspace:
        (Path(workspace) / "schedule.py").write_text(submission, encoding="utf-8")
        script = RUNNER.format(root=str(ROOT), workspace=workspace, seed=SEED, entry=entry)
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
    if checkpoint_id == "rotate":
        return _check_rotate(submission), None
    if checkpoint_id == "mux":
        return _check_mux(submission), None
    if checkpoint_id == "dependency":
        return _check_dependency(submission), None
    entry = CODE_CHECKPOINTS.get(checkpoint_id)
    if entry is not None:
        return _run_hidden(submission, entry)
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
    caller who skips the Workbench and posts a bare `rotate`/`mux`/`dependency` answer
    straight at this process is rejected the same way. Same shape as
    ac26-w2-linear-shares's verifier, for the same reason.
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
