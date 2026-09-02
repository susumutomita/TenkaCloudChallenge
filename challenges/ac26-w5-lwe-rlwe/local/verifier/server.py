"""POST /verify — the scoring seam. Compose-internal only, stdlib only.

Issue 543/537: this used to be the same process that also served the Participant
Portal's config, inspect, starter, public-test and prepare endpoints, in the single
Docker stage a learner's own `make build` produced -- so `tests/hidden/check_lwe.py`
shipped in the learner's own image alongside it, and all eight checkpoints are graded by
running that suite. Option B2 moved `fixtures/` to this side of the boundary as well: it
has to define working `normalize`, `ring_mul`, `lwe_encrypt`, `lwe_decrypt`,
`rlwe_encrypt`, `rlwe_decrypt`, `encode`, `decode` and `centered` to derive a
deployment's fixtures, and those are the names `starter/lwe.py` asks the learner to
write. The Portal-facing surface now lives in `participant/server.py`, in a separate
image (see ../Dockerfile) that this process's own container never builds; this file,
`fixtures/` and `tests/hidden/` are reachable only over the Compose-internal network
(see ../docker-compose.yml), never from the participant container's filesystem.

`GET /public` below is what the participant image reads instead of importing
`fixtures.generate`.

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

from fixtures.generate import public_payload

ROOT = Path(__file__).resolve().parents[1]
PROBLEM_ID = "ac26-w5-lwe-rlwe"
SEED = os.environ.get("FLAG_SEED", "local-dev-seed")

MAX_BODY_BYTES = 256 * 1024
RUN_TIMEOUT_SECONDS = 30
MAX_ADDRESS_SPACE_BYTES = 512 * 1024 * 1024
MAX_PROCESSES = 64
MAX_OUTPUT_BYTES = 64 * 1024
#: Cap for the verdict's optional human-readable failure summary. Kept under the
#: platform's 2000-character message limit with room to spare.
MAX_MESSAGE_CHARS = 1900
#: Wall clock for reading a request body, so a stalled client cannot pin the server.
REQUEST_TIMEOUT_SECONDS = 15

CODE_CHECKPOINTS = {
    "normalize": ("check_normalize",),
    "ring": ("check_ring",),
    "lwe": ("check_lwe",),
    "rlwe": ("check_rlwe",),
    "correspondence": ("check_correspondence",),
    "boundary": ("check_boundary",),
    "transfer": ("check_transfer",),
    "defense": ("check_defense",),
}
CHECKPOINTS = tuple(CODE_CHECKPOINTS)
#: Every checkpoint here is graded on the learner's file, so nothing has to arrive
#: sealed by the Workbench's prepare route. The set is derived rather than written as
#: `frozenset()` so that adding a direct-answer checkpoint later cannot silently skip
#: the seal check in `_unwrap_submission`.
MANUAL_CHECKPOINTS = frozenset(CHECKPOINTS) - frozenset(CODE_CHECKPOINTS)


# Darwin aliases RLIMIT_AS onto RLIMIT_RSS and refuses to set it, while still
# reporting RLIM_INFINITY for it. Setting it anyway raises inside `preexec_fn`, which
# aborts the exec -- so on a macOS checkout every submission run failed, including the
# reference. The lab runs on Linux, where the cap does apply, so skipping it on Darwin
# does not change what participants run.
_ADDRESS_SPACE_CAPPABLE = sys.platform.startswith("linux")


def _limits() -> None:
    """Applied inside the child, before exec. Caps memory, processes, and file size."""
    if _ADDRESS_SPACE_CAPPABLE:
        resource.setrlimit(resource.RLIMIT_AS, (MAX_ADDRESS_SPACE_BYTES, MAX_ADDRESS_SPACE_BYTES))
    resource.setrlimit(resource.RLIMIT_NPROC, (MAX_PROCESSES, MAX_PROCESSES))
    resource.setrlimit(resource.RLIMIT_FSIZE, (MAX_OUTPUT_BYTES, MAX_OUTPUT_BYTES))


RUNNER = """
import json, os, sys
sys.path.insert(0, {root!r})
sys.path.insert(0, {workspace!r})
from tests.hidden import check_lwe
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
    import lwe
except Exception as error:
    print(json.dumps({{"failures": ["submission could not be imported: " + type(error).__name__]}}))
    sys.stdout.flush()
    os._exit(0)
sys.path.insert(0, {root!r})
sys.modules.update(_hidden_modules)
phases = {phases!r}
if phases:
    failures = []
    for name in phases:
        failures.extend(getattr(check_lwe, name)(lwe, {seed!r}))
else:
    failures = check_lwe.run(lwe, {seed!r})
print(json.dumps({{"failures": failures}}))
sys.stdout.flush()
os._exit(0)
"""


def _failure_message(failures: list[object]) -> str | None:
    """Join the hidden checker's failure list into one participant-facing message.

    Only checker-authored strings are kept: anything else that ends up in the list
    is dropped rather than serialized, so a checker bug cannot push raw values
    through the message field.
    """
    text = "; ".join(dict.fromkeys(item for item in failures if isinstance(item, str)))
    return text[:MAX_MESSAGE_CHARS] if text else None


def _run_submission(
    submission: object, phases: tuple[str, ...], seed: str
) -> tuple[bool, str | None]:
    """Run the named hidden phases against the learner's file in a throwaway workspace."""
    source = submission
    if isinstance(source, dict):
        source = source.get("lwe.py")
    if not isinstance(source, str) or not source.strip():
        return False, None
    if len(source) > MAX_BODY_BYTES:
        return False, None
    with tempfile.TemporaryDirectory() as workspace:
        (Path(workspace) / "lwe.py").write_text(source, encoding="utf-8")
        script = RUNNER.format(
            root=str(ROOT), workspace=workspace, phases=list(phases), seed=seed
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
    for line in reversed(captured[-MAX_OUTPUT_BYTES:].splitlines()):
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
    """Boolean verdict for callers that need only pass/fail."""
    correct, _message = evaluate_with_message(checkpoint_id, submission)
    return correct


def evaluate_with_message(
    checkpoint_id: str, submission: object
) -> tuple[bool, str | None]:
    if checkpoint_id in CODE_CHECKPOINTS:
        # `transfer` runs under a derived seed, so its degree, modulus, dimension and
        # secret are not the ones any other checkpoint used.
        seed = f"{SEED}:transfer" if checkpoint_id == "transfer" else SEED
        return _run_submission(submission, CODE_CHECKPOINTS[checkpoint_id], seed)
    return False, None

def _b64decode(value: str) -> bytes:
    padding = "=" * (-len(value) % 4)
    return base64.urlsafe_b64decode(value + padding)


def _unwrap_submission(checkpoint_id: str, submission: object) -> object:
    """Undo the Workbench's `tcw1.` seal and check it against this deployment.

    The derivation is duplicated from `participant/workbench.py`'s
    `PortalEditorSupport._seal_manual` rather than imported, because that module lives
    only in the participant image (see ../Dockerfile). Repeating it here rather than
    trusting an already-unwrapped value from the Workbench is what keeps the seal
    meaningful: a caller who skips the Workbench is judged by the same rule. Same shape
    as ac26-w3-schnorr's verifier, for the same reason.

    This problem has no direct-answer checkpoint today, so an unsealed code submission
    passes through unchanged -- which is the format the Portal has always sent.
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
    """Serve the /verify contract, and nothing a participant-facing client needs.

    The Portal editor API is deliberately absent: it lives in `participant/server.py`,
    which runs in the image a learner builds. Everything here runs in the image that
    carries `fixtures/` and `tests/hidden/`, and is never published to the host.
    """

    timeout = REQUEST_TIMEOUT_SECONDS

    def do_GET(self) -> None:  # noqa: N802 - BaseHTTPRequestHandler's API
        path = urlsplit(self.path).path
        if path == "/healthz":
            self._respond(200, {"ok": True})
            return
        if path == "/public":
            # The public half of the deployment, and only that: the values `show.py` has
            # always printed, plus the parameters, secrets and masks the public tests
            # pass into the learner's own functions. Issue 543's option B2 -- `fixtures/`
            # does not ship in the participant image, so this route is where `show.py`
            # and `tests/public/test_lwe.py` get them from.
            # `fixtures.generate.public_payload` is the one place that decides what
            # counts as public; no checkpoint's expected value is derived there.
            self._respond(200, public_payload(SEED))
            return
        self._respond(404, {"error": "not found"})

    def do_POST(self) -> None:  # noqa: N802 - BaseHTTPRequestHandler's API
        if urlsplit(self.path).path.rstrip("/") != "/verify":
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
    port = int(os.environ.get("VERIFY_PORT", "18140"))
    # Bind every interface *inside the container*, not the container's loopback. The
    # Workbench reaches this process as `verifier:<port>` over the Compose network, which
    # resolves to this container's bridge address — a server listening only on 127.0.0.1
    # inside the container would accept nothing from it, and the platform could never
    # score the problem.
    #
    # Since Issue 543/537 this service publishes no host port at all (see
    # docker-compose.yml): it sits on the `lab` network, which is `internal: true` and so
    # carries no gateway. Nothing but the participant container can reach it.
    HTTPServer(("0.0.0.0", port), Handler).serve_forever()  # noqa: S104 - see above


if __name__ == "__main__":
    main()
