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
  - Responses carry `correct` and, for a failed code checkpoint, a `message` naming
    the broken properties the starter docstring already states (AGENTS.md §15). Never
    the hidden test names, the expected values, or reference output.
  - Malformed input produces a failed checkpoint, never a crashed process.

Issue 543/537: this used to be the same process that also served the Participant
Portal's config, inspect, starter, public-test, and prepare endpoints, in the single
Docker stage a learner's own `make build` produced -- so `first-broken`'s expected
value (then the third element `fixtures.generate.corrupted_trace` returned) was
importable from inside the learner's own container. Moving only that checkpoint's
derivation into `verifier/expected.py` was not enough on its own: `corrupted_trace`
itself is a plain, seed-keyed function, and `fixtures/` still shipped to the
participant stage for `show.py` and the public tests, so a learner with nothing but
their own container's `FLAG_SEED` could still call it directly and read the broken
index off the two remaining pieces by hand -- no different in substance from the
leak this file exists to close.

So `fixtures/` does not ship in the participant Docker stage at all any more (see
../Dockerfile). This process is the only one that still imports it: the Portal-facing
surface lives in `participant/server.py`, in a separate image that never builds this
file, `verifier/expected.py`, or `fixtures/`, and fetches the public evidence this
file serves at `GET /public` over the Compose-internal network instead (see
../docker-compose.yml) -- never from the participant container's filesystem.
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

from math import gcd

from fixtures.generate import health_token, public_case, public_payload, walkback_case
from verifier.expected import first_broken_index

ROOT = Path(__file__).resolve().parents[1]
SEED = os.environ.get("FLAG_SEED", "local-dev-seed")

MAX_BODY_BYTES = 256 * 1024
RUN_TIMEOUT_SECONDS = 10
MAX_ADDRESS_SPACE_BYTES = 512 * 1024 * 1024
MAX_PROCESSES = 64
MAX_OUTPUT_BYTES = 64 * 1024
#: Wall clock for reading a request body, so a stalled client cannot pin the server.
REQUEST_TIMEOUT_SECONDS = 15
#: Cap for the failed-code-checkpoint `message`, under the platform's 2000-char schema.
MAX_MESSAGE_CHARS = 1900

CHECKPOINTS = ("environment", "predict", "first-broken", "generalize", "walkback", "no-walkback")
SUBMISSION_FILES = ("counter.py",)

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


def _run_submission_script(
    sources: dict[str, str], script: str, seed: str
) -> tuple[int, str] | None:
    """Run the submitted `counter.py` with this process's resource limits."""
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


def _check_environment(submission: object) -> bool:
    return isinstance(submission, str) and submission.strip() == health_token(SEED)


def _check_predict(submission: object) -> bool:
    case = public_case(SEED)
    value = _normalized_int(submission)
    if value is None:
        return False
    return value == (case.start + case.step * case.rounds) % case.modulus


def _check_first_broken(submission: object) -> bool:
    value = _normalized_int(submission)
    if value is None:
        return False
    return value == first_broken_index(SEED)


def _check_walkback(submission: object) -> bool:
    """The number of rounds of the walk-back case, recovered from its final value."""
    value = _normalized_int(submission)
    if value is None:
        return False
    return value == walkback_case(SEED)["rounds"]


#: Bounds for the `no-walkback` construction: 2 and 3 admit no step in [2, modulus)
#: sharing a factor with them, 100 keeps the answer checkable by hand, and
#: `modulus > step` keeps `step` a genuine move on the ring rather than a full lap.
NO_WALKBACK_MIN_MODULUS = 4
NO_WALKBACK_MAX_MODULUS = 100


def _check_no_walkback(submission: object) -> bool:
    """A ring size on which this deployment's walk-back `step` cannot be undone.

    Keeping the walk-back case's `step`, the learner names a `modulus` for which no
    number multiplies `step` back to 1 -- the two share a factor. Checked as a
    property, never against one expected value: every such modulus is a valid answer,
    and the walk-back case's own prime modulus never is.
    """
    modulus = _normalized_int(submission)
    if modulus is None:
        return False
    step = walkback_case(SEED)["step"]
    if not NO_WALKBACK_MIN_MODULUS <= modulus <= NO_WALKBACK_MAX_MODULUS or modulus <= step:
        return False
    return gcd(step, modulus) > 1


RUNNER = """
import json, os, sys
from pathlib import Path
sys.path.insert(0, {root!r})
sys.path.insert(0, {workspace!r})
from tests.hidden.check_counter import run
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
    from counter import advance
except Exception as error:
    print(json.dumps({{"failures": ["submission could not be imported: " + type(error).__name__]}}))
    sys.stdout.flush()
    os._exit(0)
sys.path.insert(0, {root!r})
sys.modules.update(_hidden_modules)
print(json.dumps({{"failures": run(advance, {seed!r})}}))
sys.stdout.flush()
os._exit(0)
"""


def _failure_detail(failures: list[object]) -> str:
    """Join the checker's property-level failure strings for the response `message`.

    The checker writes messages that name a broken property the starter docstring
    already states, never an expected value (AGENTS.md §15). Non-string entries are
    dropped rather than serialized.
    """
    return "; ".join(item for item in failures if isinstance(item, str))[:MAX_MESSAGE_CHARS]


def _check_generalize(submission: object) -> tuple[bool, str]:
    """Run the hidden suite against the learner's file in a throwaway workspace.

    Returns the verdict and, on failure, the checker's failure summary for the
    response `message`. An empty string means no detail is surfaced.
    """
    if not isinstance(submission, str) or not submission.strip():
        return False, ""
    if len(submission) > MAX_BODY_BYTES:
        return False, ""
    result = _run_submission_script({"counter.py": submission}, RUNNER, SEED)
    if result is None or result[0] != 0:
        return False, ""
    for line in reversed(result[1].splitlines()):
        try:
            payload = json.loads(line)
        except json.JSONDecodeError:
            continue
        failures = payload.get("failures")
        if not isinstance(failures, list):
            return False, ""
        return len(failures) == 0, _failure_detail(failures)
    return False, ""


def evaluate(checkpoint_id: str, submission: object) -> tuple[bool, str]:
    """Verdict plus, for a failed code checkpoint, a property-level failure summary.

    Direct-answer checkpoints never carry detail: a reason would narrow their
    expected value (AGENTS.md §15).
    """
    if checkpoint_id == "environment":
        return _check_environment(submission), ""
    if checkpoint_id == "predict":
        return _check_predict(submission), ""
    if checkpoint_id == "first-broken":
        return _check_first_broken(submission), ""
    if checkpoint_id == "generalize":
        return _check_generalize(submission)
    if checkpoint_id == "walkback":
        return _check_walkback(submission), ""
    if checkpoint_id == "no-walkback":
        return _check_no_walkback(submission), ""
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
        if urlsplit(self.path).path.rstrip("/") != "/verify":
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
            correct, detail = evaluate(checkpoint_id, body.get("submission"))
        except Exception:  # noqa: BLE001 - a broken checkpoint must not kill the verifier
            correct, detail = False, ""
        payload: dict[str, object] = {"checkpointId": checkpoint_id, "correct": correct}
        if not correct and detail:
            payload["message"] = detail
        self._respond(200, payload)

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
        self.end_headers()
        self.wfile.write(encoded)


def main() -> None:
    port = int(os.environ.get("VERIFY_PORT", "18092"))
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
