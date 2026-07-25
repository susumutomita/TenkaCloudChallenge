"""POST /verify — the scoring seam. Loopback only, stdlib only.

Same security contract as the AC26 template. Five of the six checkpoints run the
learner's sharing.py against seeded circuits; `root-cause` grades a structured answer,
because the issue asks for a diagnosis that is machine-checkable rather than prose.
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

from fixtures.generate import setting

ROOT = Path(__file__).resolve().parents[1]
SEED = os.environ.get("FLAG_SEED", "local-dev-seed")

MAX_BODY_BYTES = 256 * 1024
RUN_TIMEOUT_SECONDS = 20
MAX_ADDRESS_SPACE_BYTES = 512 * 1024 * 1024
MAX_PROCESSES = 64
MAX_OUTPUT_BYTES = 64 * 1024

CODE_CHECKPOINTS = {
    "share-and-reconstruct": ("check_roundtrip", "check_no_trivial_split"),
    "hides-the-secret": ("check_completion",),
    "rerandomize": ("check_rerandomize",),
    "transfer": (),
}
CHECKPOINTS = (
    "share-and-reconstruct",
    "hides-the-secret",
    "threshold",
    "rerandomize",
    "transfer",
)


def _limits() -> None:
    resource.setrlimit(resource.RLIMIT_AS, (MAX_ADDRESS_SPACE_BYTES, MAX_ADDRESS_SPACE_BYTES))
    resource.setrlimit(resource.RLIMIT_NPROC, (MAX_PROCESSES, MAX_PROCESSES))
    resource.setrlimit(resource.RLIMIT_FSIZE, (MAX_OUTPUT_BYTES, MAX_OUTPUT_BYTES))


def _check_threshold(submission: object) -> bool:
    """How many shares are needed, and two secrets consistent with one short of that.

    Naming the number alone is a guess; the two witnesses are what show that n-1
    shares carry no information about which secret was split.
    """
    answer = submission
    if isinstance(answer, str):
        try:
            answer = json.loads(answer)
        except json.JSONDecodeError:
            return False
    if not isinstance(answer, dict):
        return False
    cfg = setting(SEED)
    p, n = cfg["p"], cfg["n"]
    if answer.get("sharesNeeded") != n:
        return False
    partial = answer.get("partial")
    completions = answer.get("completions")
    if not isinstance(partial, list) or len(partial) != n - 1:
        return False
    if not isinstance(completions, list) or len(completions) != 2:
        return False
    try:
        head = [int(v) % p for v in partial]
        pairs = [(int(c["secret"]) % p, int(c["lastShare"]) % p) for c in completions]
    except (TypeError, ValueError, KeyError):
        return False
    if pairs[0][0] == pairs[1][0]:
        return False  # two different secrets, or it demonstrates nothing
    return all((sum(head) + last) % p == secret for secret, last in pairs)


RUNNER = """
import json, sys
sys.path.insert(0, {root!r})
sys.path.insert(0, {workspace!r})
from tests.hidden import check_sharing
try:
    import sharing
except Exception as error:
    print(json.dumps({{"failures": ["submission could not be imported: " + type(error).__name__]}}))
    raise SystemExit(0)
phases = {phases!r}
if phases:
    failures = []
    for name in phases:
        failures.extend(getattr(check_sharing, name)(sharing, {seed!r}))
else:
    failures = check_sharing.run(sharing, {seed!r})
print(json.dumps({{"failures": failures}}))
"""


def _run_submission(submission: object, phases: tuple[str, ...], seed: str) -> bool:
    source = submission
    if isinstance(source, dict):
        source = source.get("sharing.py")
    if not isinstance(source, str) or not source.strip():
        return False
    if len(source) > MAX_BODY_BYTES:
        return False
    with tempfile.TemporaryDirectory() as workspace:
        (Path(workspace) / "sharing.py").write_text(source, encoding="utf-8")
        script = RUNNER.format(
            root=str(ROOT), workspace=workspace, phases=list(phases), seed=seed
        )
        try:
            completed = subprocess.run(  # noqa: S603 - argument list, shell=False
                [sys.executable, "-I", "-c", script],
                capture_output=True,
                text=True,
                timeout=RUN_TIMEOUT_SECONDS,
                preexec_fn=_limits,
                cwd=workspace,
                env={"PATH": "/usr/local/bin:/usr/bin:/bin"},
                check=False,
            )
        except (subprocess.TimeoutExpired, OSError):
            return False
    if completed.returncode != 0:
        return False
    for line in reversed(completed.stdout[-MAX_OUTPUT_BYTES:].splitlines()):
        try:
            payload = json.loads(line)
        except json.JSONDecodeError:
            continue
        failures = payload.get("failures")
        return isinstance(failures, list) and len(failures) == 0
    return False


def evaluate(checkpoint_id: str, submission: object) -> bool:
    if checkpoint_id == "threshold":
        return _check_threshold(submission)
    if checkpoint_id in CODE_CHECKPOINTS:
        seed = f"{SEED}:transfer" if checkpoint_id == "transfer" else SEED
        return _run_submission(submission, CODE_CHECKPOINTS[checkpoint_id], seed)
    return False


class Handler(BaseHTTPRequestHandler):
    def do_POST(self) -> None:  # noqa: N802 - BaseHTTPRequestHandler's name
        if self.path.rstrip("/") != "/verify":
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
        if not isinstance(body, dict):
            self._respond(400, {"error": "bad json"})
            return
        checkpoint_id = body.get("checkpointId")
        if not isinstance(checkpoint_id, str) or checkpoint_id not in CHECKPOINTS:
            self._respond(200, {
                "checkpointId": checkpoint_id if isinstance(checkpoint_id, str) else "",
                "correct": False,
            })
            return
        try:
            correct = evaluate(checkpoint_id, body.get("submission"))
        except Exception:  # noqa: BLE001 - a broken checkpoint must not kill the verifier
            correct = False
        self._respond(200, {"checkpointId": checkpoint_id, "correct": correct})

    def log_message(self, *_args: object) -> None:
        """Silence the default access log; it would echo submissions."""

    def _respond(self, status: int, payload: dict[str, object]) -> None:
        encoded = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)


def main() -> None:
    port = int(os.environ.get("VERIFY_PORT", "18095"))
    HTTPServer(("127.0.0.1", port), Handler).serve_forever()


if __name__ == "__main__":
    main()
