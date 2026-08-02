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

from fixtures.generate import MASK, WORD_BITS, dependency_case, mux_case, rotate_case

ROOT = Path(__file__).resolve().parents[1]
SEED = os.environ.get("FLAG_SEED", "local-dev-seed")

MAX_BODY_BYTES = 256 * 1024
RUN_TIMEOUT_SECONDS = 20
MAX_ADDRESS_SPACE_BYTES = 512 * 1024 * 1024
MAX_PROCESSES = 64
MAX_OUTPUT_BYTES = 64 * 1024
#: Wall clock for reading a request body, so a stalled client cannot pin the server.
REQUEST_TIMEOUT_SECONDS = 15

CHECKPOINTS = ("rotate", "mux", "dependency", "sigma", "logic", "schedule")

#: The hidden entry point each code checkpoint runs.
CODE_CHECKPOINTS = {"sigma": "run_sigma", "logic": "run_logic", "schedule": "run_schedule"}

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
try:
    import schedule
except Exception as error:
    print(json.dumps({{"failures": ["submission could not be imported: " + type(error).__name__]}}))
    sys.stdout.flush()
    os._exit(0)
print(json.dumps({{"failures": {entry}(schedule, {seed!r})}}))
sys.stdout.flush()
os._exit(0)
"""


def _run_hidden(submission: object, entry: str) -> bool:
    """Run one hidden suite against the learner's file in a throwaway workspace."""
    if not isinstance(submission, str) or not submission.strip():
        return False
    if len(submission) > MAX_BODY_BYTES:
        return False
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
            return False
    if completed.returncode != 0:
        return False
    stdout = captured[-MAX_OUTPUT_BYTES:]
    for line in reversed(stdout.splitlines()):
        try:
            payload = json.loads(line)
        except json.JSONDecodeError:
            continue
        failures = payload.get("failures")
        return isinstance(failures, list) and len(failures) == 0
    return False


def evaluate(checkpoint_id: str, submission: object) -> bool:
    if checkpoint_id == "rotate":
        return _check_rotate(submission)
    if checkpoint_id == "mux":
        return _check_mux(submission)
    if checkpoint_id == "dependency":
        return _check_dependency(submission)
    entry = CODE_CHECKPOINTS.get(checkpoint_id)
    if entry is not None:
        return _run_hidden(submission, entry)
    return False

# BEGIN GENERATED BROWSER WORKBENCH
from verifier.workbench import WorkbenchSupport

_WORKBENCH = WorkbenchSupport(
    root=ROOT,
    seed=SEED,
    problem_id='sha256-schedule-logic',
    problem_name='SHA-256 その 2: ビット演算とメッセージスケジュール',
    description='回転とシフトの違い、σ0 σ1 Σ0 Σ1 の 4 種類のずらし量、Ch が選択回路であること、Maj がパリティではないこと、そして 16 ワードを 64 ワードへ広げる漸化式。SHA-256 の配線を全部自分で書く。',
    submitted_files=('schedule.py',),
    code_checkpoints=('sigma', 'logic', 'schedule'),
    checkpoints=('rotate', 'mux', 'dependency', 'sigma', 'logic', 'schedule'),
    checkpoint_labels={'rotate': '回転とシフトを手で区別する', 'mux': 'Ch が選択回路であることを使う', 'dependency': '1 bit の変更がどこに最初に届くかを導く', 'sigma': 'rotr と 4 つの σ を実装する', 'logic': 'Ch と Maj を実装する', 'schedule': '16 ワードを 64 ワードへ広げる'},
    max_body_bytes=MAX_BODY_BYTES,
    run_timeout_seconds=RUN_TIMEOUT_SECONDS,
    max_output_bytes=MAX_OUTPUT_BYTES,
    limit_fn=_limits,
)
# END GENERATED BROWSER WORKBENCH

class Handler(BaseHTTPRequestHandler):
    """Serve the Browser Workbench and preserve the existing /verify contract."""

    timeout = REQUEST_TIMEOUT_SECONDS

    def do_GET(self) -> None:  # noqa: N802 - BaseHTTPRequestHandler's API
        from urllib.parse import urlsplit

        path = urlsplit(self.path).path
        if path == "/api/config":
            self._respond(200, _WORKBENCH.config_payload())
            return
        if path == "/api/inspect":
            self._respond(200, _WORKBENCH.inspect_payload())
            return
        if path == "/api/starter":
            self._respond(200, _WORKBENCH.starter_payload())
            return
        asset = _WORKBENCH.asset(path)
        if asset is None:
            self._respond(404, {"error": "not found"})
            return
        content, content_type = asset
        self._respond_bytes(200, content, content_type)

    def do_POST(self) -> None:  # noqa: N802 - BaseHTTPRequestHandler's API
        from urllib.parse import urlsplit

        path = urlsplit(self.path).path.rstrip("/") or "/"
        if path not in ("/verify", "/api/test", "/api/prepare"):
            self._respond(404, {"error": "not found"})
            return
        body = self._read_json_body()
        if body is None:
            return
        if path == "/api/test":
            self._respond(200, _WORKBENCH.run_public_tests(body.get("files")))
            return
        if path == "/api/prepare":
            self._respond(
                200,
                _WORKBENCH.prepare_submissions(body.get("files"), body.get("manual")),
            )
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
        submission = _WORKBENCH.unwrap_submission(checkpoint_id, body.get("submission"))
        try:
            correct = evaluate(checkpoint_id, submission)
        except Exception:  # noqa: BLE001 - a broken checkpoint must fail closed
            correct = False
        self._respond(200, {"checkpointId": checkpoint_id, "correct": correct})

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
    port = int(os.environ.get("VERIFY_PORT", "18091"))
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
