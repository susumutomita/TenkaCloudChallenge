"""POST /verify -- the scoring seam. Compose-internal only, stdlib only.

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

This problem is a drill: every checkpoint is a direct answer -- the value one line of
Python printed on the learner's own screen -- so the sandboxed runner below is used by
the author tooling (mutation suite, CI) and by nothing the learner submits. The grader
for every checkpoint is `_check_line`: the pasted value, normalised, against the value
this deployment's seed decides. Nothing about the learner's code is ever executed here.

Issue 543/537: this used to be the same process that also served the Participant
Portal's config, inspect, starter, public-test, and prepare endpoints, in the single
Docker stage a learner's own `make build` produced -- so the expected values this file
compares against (then a plain function in `fixtures/generate.py`) were importable from
inside the learner's own container. That Portal-facing surface now lives in
`participant/server.py`, in a separate image (see ../Dockerfile) that this process's own
container never builds; this file and its `verifier/expected.py` import are reachable
only over the Compose-internal network (see ../docker-compose.yml), never from the
participant container's filesystem.
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

from fixtures.generate import GRADED, LINES, normalize_answer
from verifier.expected import expected_for

ROOT = Path(__file__).resolve().parents[1]
PROBLEM_ID = "ac26-w4-plonk-drill"
SEED = os.environ.get("FLAG_SEED", "local-dev-seed")

MAX_BODY_BYTES = 256 * 1024
RUN_TIMEOUT_SECONDS = 20
MAX_ADDRESS_SPACE_BYTES = 512 * 1024 * 1024
MAX_PROCESSES = 64
MAX_OUTPUT_BYTES = 64 * 1024
#: Wall clock for reading a request body, so a stalled client cannot pin the server.
REQUEST_TIMEOUT_SECONDS = 15

#: No checkpoint runs learner code. The editor file is a scratchpad whose public test
#: prints the learner's own values; the grade is the pasted value, nothing else. Eight of
#: the twelve drill lines have an answer field (the platform's maximum per problem).
CODE_CHECKPOINTS: dict[str, tuple[str, ...]] = {}
CHECKPOINTS = GRADED
MANUAL_CHECKPOINTS = GRADED


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


def _check_line(line: str, submission: object) -> bool:
    """The value the learner pasted for one drill line, against this deployment's value.

    A tuple may arrive as `[a, b, c]`, `(a, b, c)` or `a, b, c`; an integer as a number
    or a digit string. The comparison is exact: there is one right value per line per
    seed, and it is the value the line prints when typed against this seed's numbers.
    """
    if line not in GRADED or line not in LINES:
        return False
    answer = submission
    if isinstance(answer, str):
        try:
            answer = json.loads(answer)
        except json.JSONDecodeError:
            answer = answer.strip()
    if isinstance(answer, bool) or answer is None:
        return False
    got = normalize_answer(line, answer)
    if got is None:
        return False
    expected = expected_for(SEED)[line]
    return got == expected


RUNNER = """
import json, os, sys
sys.path.insert(0, {root!r})
sys.path.insert(0, {workspace!r})
from tests.hidden import check_plonk_drill
try:
    import plonk_drill
except Exception as error:
    print(json.dumps({{"failures": ["submission could not be imported: " + type(error).__name__]}}))
    sys.stdout.flush()
    os._exit(0)
phases = {phases!r}
if phases:
    failures = []
    for name in phases:
        failures.extend(getattr(check_plonk_drill, name)(plonk_drill, {seed!r}))
else:
    failures = check_plonk_drill.run(plonk_drill, {seed!r})
print(json.dumps({{"failures": failures}}))
sys.stdout.flush()
os._exit(0)
"""


def _run_submission(submission: object, phases: tuple[str, ...], seed: str) -> bool:
    """Run the hidden suite against a `plonk_drill.py` in a throwaway workspace.

    Kept for the author path (mutation.py, CI): no checkpoint of this problem routes a
    learner's file through it.
    """
    source = submission
    if isinstance(source, dict):
        source = source.get("plonk_drill.py")
    if not isinstance(source, str) or not source.strip():
        return False
    if len(source) > MAX_BODY_BYTES:
        return False
    with tempfile.TemporaryDirectory() as workspace:
        (Path(workspace) / "plonk_drill.py").write_text(source, encoding="utf-8")
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
            return False
    if completed.returncode != 0:
        return False
    for line in reversed(captured[-MAX_OUTPUT_BYTES:].splitlines()):
        try:
            payload = json.loads(line)
        except json.JSONDecodeError:
            continue
        failures = payload.get("failures")
        return isinstance(failures, list) and len(failures) == 0
    return False


def evaluate(checkpoint_id: str, submission: object) -> bool:
    if checkpoint_id in GRADED:
        return _check_line(checkpoint_id, submission)
    if checkpoint_id in CODE_CHECKPOINTS:
        return _run_submission(submission, CODE_CHECKPOINTS[checkpoint_id], SEED)
    return False


def _b64decode(value: str) -> bytes:
    padding = "=" * (-len(value) % 4)
    return base64.urlsafe_b64decode(value + padding)


def _unwrap_submission(checkpoint_id: str, submission: object) -> object:
    """Undo the Workbench's `tcw1.` seal and check it against this deployment.

    A direct-answer submission is HMAC-bound to `PROBLEM_ID` and `SEED` by
    `participant/workbench.py`'s `PortalEditorSupport._seal_manual` -- the same
    derivation, duplicated here rather than imported, because that module lives only
    in the participant image (see ../Dockerfile) and this process must not trust an
    unsealed value for any of this problem's checkpoints, all of which are manual.
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
    timeout = REQUEST_TIMEOUT_SECONDS

    def do_GET(self) -> None:  # noqa: N802 - stdlib handler API
        if urlsplit(self.path).path == "/healthz":
            self._respond(200, {"ok": True})
            return
        self._respond(404, {"error": "not found"})

    def do_POST(self) -> None:  # noqa: N802 - stdlib handler API
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
        content = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("content-type", "application/json; charset=utf-8")
        self.send_header("content-length", str(len(content)))
        self.send_header("cache-control", "no-store")
        self.send_header("x-content-type-options", "nosniff")
        self.end_headers()
        self.wfile.write(content)


def main() -> None:
    port = int(os.environ.get("VERIFY_PORT", "18138"))
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
