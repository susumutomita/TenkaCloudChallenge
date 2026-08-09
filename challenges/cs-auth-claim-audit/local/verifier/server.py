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
from urllib.parse import urlsplit

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fixtures.generate import decision_log, health_token, keyring, public_request, validity_window

ROOT = Path(__file__).resolve().parents[1]
SEED = os.environ.get("FLAG_SEED", "local-dev-seed")

MAX_BODY_BYTES = 256 * 1024
RUN_TIMEOUT_SECONDS = 10
MAX_ADDRESS_SPACE_BYTES = 512 * 1024 * 1024
MAX_PROCESSES = 64
MAX_OUTPUT_BYTES = 64 * 1024
#: Wall clock for reading a request body, so a stalled client cannot pin the server.
REQUEST_TIMEOUT_SECONDS = 15

CHECKPOINTS = ("environment", "window", "audit", "verify", "isolate", "generalize")
SUBMISSION_FILES = ("authorize.py",)
#: Checkpoints scored by running the learner's file against a hidden phase, and which
#: phase each one buys. The direct-answer checkpoints are not in here.
CODE_CHECKPOINT_PHASES = {
    "verify": "check_verify",
    "isolate": "check_isolate",
    "generalize": "check_generalize",
}
CODE_CHECKPOINTS = frozenset(CODE_CHECKPOINT_PHASES)
CHECKPOINT_LABELS = {
    "environment": "environment — Portal editor が出す合言葉を、そのまま貼る",
    "window": "window — この token が通る最初と最後の now を [最初, 最後] で",
    "audit": "audit — gateway が allow したうち、通してはいけなかった行の番号を昇順で",
    "verify": "verify — この gateway が発行した token かどうかを判定できる authorize.py",
    "isolate": "isolate — token は本物として、この要求を通してよいかを判定できる authorize.py",
    "generalize": "generalize — 書き上げた authorize.py の中身を、全部",
}

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
        text = value.strip()
        try:
            return int(text, 10)
        except ValueError:
            return None
    return None


def starter_payload() -> dict[str, str]:
    """Return the editable file shipped to the Portal editor."""
    return {
        name: (ROOT / "starter" / name).read_text(encoding="utf-8") for name in SUBMISSION_FILES
    }


def config_payload() -> dict[str, object]:
    """Declare the generic editor contract consumed by the Participant Portal."""
    return {
        "id": "cs-auth-claim-audit",
        "name": "署名は通った。それは、その要求を通してよいという意味ではない",
        "description": "壊れた API gateway の決定ログを監査し、署名検証を通り抜けた要求を特定して、gateway を書き直す。",
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
                "name": 'The signature checked out. That is not the same as the request being allowed',
                "description": "A gateway refuses expired tokens, refuses forged ones, refuses actions outside a token's scope -- and has been letting one tenant read another tenant's documents for months. Audit its decision log, find the requests that got through, and write the gateway that would have stopped them.",
                "checkpointLabels": {'environment': 'environment - the pass phrase the Portal editor prints, pasted exactly', 'window': 'window - the first and last `now` this token is accepted at, as [first, last]', 'audit': 'audit - the indices the gateway allowed that it should have refused, ascending', 'verify': 'verify - an authorize.py that can tell whether this gateway issued the token', 'isolate': 'isolate - an authorize.py that decides, given a genuine token, whether the request may proceed', 'generalize': 'generalize - your finished authorize.py, all of it'},
            }
        },
    }


def inspect_payload(seed: str) -> dict[str, object]:
    """Build the seeded evidence shown by the browser's inspect command.

    Evidence, never answers. The shown token's claims are here because a learner
    cannot reason about a validity window they cannot read; the window itself is the
    `window` checkpoint. The decision log's rows are here for the same reason; which
    of the allowed rows are wrong is the `audit` checkpoint and is not on the wire.

    The gateway's signing keys are handed over deliberately. The learner is auditing
    this gateway, and an auditor who cannot recompute a MAC cannot separate a forged
    token from a genuine one -- withholding the keys would make the audit a guess.
    """
    request = public_request(seed)
    entries, _wrong = decision_log(seed)
    return {
        "environment": {
            "python": sys.version.split()[0],
            "healthToken": health_token(seed),
        },
        "window": {"token": request["token"], "claims": request["claims"]},
        "audit": {
            "keys": keyring(seed),
            "entries": [{"index": index, **entry} for index, entry in enumerate(entries)],
        },
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
runpy.run_path({root!r} + "/tests/public/test_authorize.py", run_name="__main__")
"""


def run_public_tests(seed: str, files: object) -> dict[str, object]:
    """Run the same checks as `make test` against the Portal-edited source."""
    sources = _submission_sources(files)
    if sources is None:
        return {"passed": False, "output": "authorize.py must be a non-empty Python file."}
    result = _run_submission_script(sources, PUBLIC_TEST_SCRIPT, seed)
    if result is None:
        return {"passed": False, "output": "Public tests timed out or could not start."}
    return {"passed": result[0] == 0, "output": result[1]}


def prepare_submissions(seed: str, files: object) -> dict[str, object]:
    """Format the portal values the workbench can produce from the editor.

    `window` and `audit` are deliberately absent. The first is read off the claims and
    turned into a half-open interval by hand; the second is the audit itself. Producing
    either here would erase exactly what those two checkpoints measure, and they are
    the two that carry the point of the problem.

    The three code checkpoints all submit the same file. They are separate checkpoints
    because they are scored against different hidden phases, not because they take
    different input.
    """
    sources = _submission_sources(files)
    if sources is None:
        return {"ok": False, "output": "authorize.py must be a non-empty Python file."}
    source = sources["authorize.py"]
    return {
        "ok": True,
        "submissions": {
            "environment": health_token(seed),
            "verify": source,
            "isolate": source,
            "generalize": source,
        },
    }


def _check_environment(submission: object) -> bool:
    return isinstance(submission, str) and submission.strip() == health_token(SEED)


def _normalized_int_list(submission: object) -> list[int] | None:
    """Accept a JSON array of integers, or the same thing as a string. No eval, ever."""
    value = submission
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except json.JSONDecodeError:
            return None
    if not isinstance(value, list):
        return None
    out: list[int] = []
    for item in value:
        number = _normalized_int(item)
        if number is None:
            return None
        out.append(number)
    return out


def _check_window(submission: object) -> bool:
    """The first and last `now` the shown token is accepted at.

    Both ends are required. Accepting a one-element answer would let "I found `exp`"
    score the same as "I worked out that `exp` is exclusive".
    """
    value = _normalized_int_list(submission)
    return value is not None and value == validity_window(SEED)


def _check_audit(submission: object) -> bool:
    """The decision-log rows the gateway allowed and should not have.

    Order-insensitive on the way in, because the learner reads the log in whatever
    order they like; duplicates are rejected, because a list that names a row twice is
    not an audit finding.
    """
    value = _normalized_int_list(submission)
    if value is None or len(set(value)) != len(value):
        return False
    _entries, wrong = decision_log(SEED)
    return sorted(value) == wrong


RUNNER = """
import json, os, sys
sys.path.insert(0, {root!r})
sys.path.insert(0, {workspace!r})
from tests.hidden import check_authorize
try:
    import authorize
except Exception as error:
    print(json.dumps({{"failures": ["submission could not be imported: " + type(error).__name__]}}))
    sys.stdout.flush()
    os._exit(0)
if not hasattr(authorize, "authorize"):
    print(json.dumps({{"failures": ["submission does not define authorize()"]}}))
    sys.stdout.flush()
    os._exit(0)
print(json.dumps({{"failures": getattr(check_authorize, {phase!r})(authorize, {seed!r})}}))
sys.stdout.flush()
os._exit(0)
"""


def _check_code(phase: str, submission: object) -> bool:
    """Run one hidden phase against the learner's file in a throwaway workspace."""
    if not isinstance(submission, str) or not submission.strip():
        return False
    if len(submission) > MAX_BODY_BYTES:
        return False
    result = _run_submission_script(
        {"authorize.py": submission}, RUNNER.replace("{phase!r}", repr(phase)), SEED
    )
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
    if checkpoint_id == "environment":
        return _check_environment(submission)
    if checkpoint_id == "window":
        return _check_window(submission)
    if checkpoint_id == "audit":
        return _check_audit(submission)
    phase = CODE_CHECKPOINT_PHASES.get(checkpoint_id)
    if phase is not None:
        return _check_code(phase, submission)
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
            # Unknown checkpoint is a failed verdict with the id echoed when it is at
            # least a string, so the platform's echo check still holds.
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
        """Silence the default stderr access log; it would echo submissions."""

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
    port = int(os.environ.get("VERIFY_PORT", "18300"))
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
