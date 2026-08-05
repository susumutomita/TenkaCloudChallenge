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

from fixtures.generate import (
    LENGTH_FIELD_BYTES,
    broken_pad_zeros_only,
    collision_message,
    length_field_case,
    length_quiz,
    padded_length,
    text_case,
)

ROOT = Path(__file__).resolve().parents[1]
SEED = os.environ.get("FLAG_SEED", "local-dev-seed")

MAX_BODY_BYTES = 256 * 1024
RUN_TIMEOUT_SECONDS = 10
MAX_ADDRESS_SPACE_BYTES = 512 * 1024 * 1024
MAX_PROCESSES = 64
MAX_OUTPUT_BYTES = 64 * 1024
#: Wall clock for reading a request body, so a stalled client cannot pin the server.
REQUEST_TIMEOUT_SECONDS = 15

CHECKPOINTS = ("byte-length", "padded-length", "length-field", "pad", "words", "collision")

#: The hidden entry point each code checkpoint runs. Keeping this explicit lets delivery
#: adapters identify code submissions without executing or guessing from verifier logic.
CODE_CHECKPOINTS = {"pad": "run_pad", "words": "run_words"}

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
try:
    from padding import {symbol}
except Exception as error:
    print(json.dumps({{"failures": ["submission could not be imported: " + type(error).__name__]}}))
    sys.stdout.flush()
    os._exit(0)
print(json.dumps({{"failures": {entry}({symbol}, {seed!r})}}))
sys.stdout.flush()
os._exit(0)
"""


def _run_hidden(submission: object, entry: str, symbol: str) -> bool:
    """Run one hidden suite against the learner's file in a throwaway workspace."""
    if not isinstance(submission, str) or not submission.strip():
        return False
    if len(submission) > MAX_BODY_BYTES:
        return False
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
    if checkpoint_id == "byte-length":
        return _check_byte_length(submission)
    if checkpoint_id == "padded-length":
        return _check_padded_length(submission)
    if checkpoint_id == "length-field":
        return _check_length_field(submission)
    if checkpoint_id == "pad":
        return _run_hidden(submission, "run_pad", "pad_message")
    if checkpoint_id == "words":
        return _run_hidden(submission, "run_words", "block_words")
    if checkpoint_id == "collision":
        return _check_collision(submission)
    return False

# BEGIN GENERATED BROWSER WORKBENCH
from verifier.workbench import WorkbenchSupport

_WORKBENCH = WorkbenchSupport(
    root=ROOT,
    seed=SEED,
    problem_id='sha256-bytes-padding',
    problem_name='SHA-256 その 1: バイト列とパディング',
    description='SHA-256 が最初に見るのは文字列ではなくバイト列。UTF-8 のバイト数、512 bit ブロックへのパディング、末尾 8 バイトのビット長、そして 32 bit ワードのバイト順を、手で数えて実装して確かめる。',
    submitted_files=('padding.py',),
    code_checkpoints=('pad', 'words'),
    checkpoints=('byte-length', 'padded-length', 'length-field', 'pad', 'words', 'collision'),
    checkpoint_labels={'byte-length': '文字数ではなくバイト数を数える', 'padded-length': 'パディング後の長さを 6 通り予測する', 'length-field': '末尾 8 バイトを組み立てる', 'pad': 'pad_message を仕様どおり実装する', 'words': 'ブロックを 32 bit ワード 16 個として読む', 'collision': '1 bit マーカーが無い場合の反例を作る'},
    problem_name_en='SHA-256 part 1: bytes and padding',
    description_en='What SHA-256 actually reads is not a string but a byte sequence. Count the UTF-8 bytes, pad to whole 512-bit blocks, build the trailing bit-length field, and get the 32-bit word byte order right.',
    checkpoint_labels_en={'byte-length': 'Count bytes, not characters', 'padded-length': 'Predict six padded lengths', 'length-field': 'Build the trailing 8 bytes', 'pad': 'Implement pad_message to the specification', 'words': 'Read the block as sixteen 32-bit words', 'collision': 'Build a counterexample for padding with no marker'},
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
