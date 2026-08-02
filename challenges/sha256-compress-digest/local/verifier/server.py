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

import hashlib
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
    DIGEST_BITS,
    avalanche_case,
    property_quiz,
    quiz_answer,
    storage_quiz,
)

ROOT = Path(__file__).resolve().parents[1]
SEED = os.environ.get("FLAG_SEED", "local-dev-seed")

MAX_BODY_BYTES = 256 * 1024
RUN_TIMEOUT_SECONDS = 30
MAX_ADDRESS_SPACE_BYTES = 512 * 1024 * 1024
MAX_PROCESSES = 64
MAX_OUTPUT_BYTES = 64 * 1024
#: Wall clock for reading a request body, so a stalled client cannot pin the server.
REQUEST_TIMEOUT_SECONDS = 15

CHECKPOINTS = (
    "round",
    "compress",
    "feedforward",
    "digest",
    "avalanche",
    "properties",
    "storage",
)

#: The hidden entry point each code checkpoint runs.
CODE_CHECKPOINTS = {
    "round": "run_round",
    "compress": "run_compress",
    "feedforward": "run_feedforward",
    "digest": "run_digest",
}


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


def _normalized_verdicts(value: object, count: int) -> str | None:
    """Parse a true/false answer string.

    Accepts T/F, t/f, Y/N, 1/0, and any separators between them, because a learner who
    writes `T, F, T` has answered the question and should not lose points to a comma.
    """
    if isinstance(value, list):
        pieces = [item for item in value if isinstance(item, str)]
        if len(pieces) != len(value):
            return None
        text = "".join(pieces)
    elif isinstance(value, str):
        text = value
    else:
        return None
    mapping = {"t": "T", "f": "F", "y": "T", "n": "F", "1": "T", "0": "F"}
    verdicts = [mapping[character] for character in text.lower() if character in mapping]
    # A stray letter that is not a verdict means the submission was not understood.
    meaningful = [character for character in text.lower() if character.isalnum()]
    if len(verdicts) != len(meaningful) or len(verdicts) != count:
        return None
    return "".join(verdicts)


def avalanche_distance() -> int:
    """How many of the 256 digest bits differ between the fixture's two messages."""
    case = avalanche_case(SEED)
    left = hashlib.sha256(case.message).digest()
    right = hashlib.sha256(case.flipped).digest()
    return sum(bin(a ^ b).count("1") for a, b in zip(left, right))


def _check_avalanche(submission: object) -> bool:
    value = _normalized_int(submission)
    if value is None or not 0 <= value <= DIGEST_BITS:
        return False
    return value == avalanche_distance()


def _check_properties(submission: object) -> bool:
    quiz = property_quiz(SEED)
    answer = _normalized_verdicts(submission, len(quiz))
    return answer is not None and answer == quiz_answer(quiz)


def _check_storage(submission: object) -> bool:
    quiz = storage_quiz(SEED)
    answer = _normalized_verdicts(submission, len(quiz))
    return answer is not None and answer == quiz_answer(quiz)


RUNNER = """
import json, os, sys
from pathlib import Path
sys.path.insert(0, {root!r})
sys.path.insert(0, {workspace!r})
from tests.hidden.check_compress import {entry}
try:
    import compress
except Exception as error:
    print(json.dumps({{"failures": ["submission could not be imported: " + type(error).__name__]}}))
    sys.stdout.flush()
    os._exit(0)
print(json.dumps({{"failures": {entry}(compress, {seed!r})}}))
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
        (Path(workspace) / "compress.py").write_text(submission, encoding="utf-8")
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
    if checkpoint_id == "avalanche":
        return _check_avalanche(submission)
    if checkpoint_id == "properties":
        return _check_properties(submission)
    if checkpoint_id == "storage":
        return _check_storage(submission)
    entry = CODE_CHECKPOINTS.get(checkpoint_id)
    if entry is not None:
        return _run_hidden(submission, entry)
    return False

# BEGIN GENERATED BROWSER WORKBENCH
from verifier.workbench import WorkbenchSupport

_WORKBENCH = WorkbenchSupport(
    root=ROOT,
    seed=SEED,
    problem_id='sha256-compress-digest',
    problem_name='SHA-256 その 3: 圧縮関数と digest、そしてパスワード保存',
    description='1 round の T1 / T2、64 round、digest、そして「64 round は可逆で、最後の足し戻しだけが一方向性を作っている」ことを反例で確かめる。最後にハッシュ関数の性質とパスワード保存を問う。',
    submitted_files=('compress.py',),
    code_checkpoints=('round', 'compress', 'feedforward', 'digest'),
    checkpoints=('round', 'compress', 'feedforward', 'digest', 'avalanche', 'properties', 'storage'),
    checkpoint_labels={'round': '1 round を実装する', 'compress': '64 round と足し戻しを実装する', 'feedforward': '64 round を逆にたどる', 'digest': 'SHA-256 を完成させる', 'avalanche': '1 bit の変化がどこまで広がるかを測る', 'properties': 'ハッシュ関数について何が言えるか', 'storage': 'パスワードをどう保存するか'},
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
