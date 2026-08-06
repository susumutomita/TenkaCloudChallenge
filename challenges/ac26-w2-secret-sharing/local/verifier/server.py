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
#: Wall clock for reading a request body, so a stalled client cannot pin the server.
REQUEST_TIMEOUT_SECONDS = 15

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
import json, os, sys
sys.path.insert(0, {root!r})
sys.path.insert(0, {workspace!r})
from tests.hidden import check_sharing
try:
    import sharing
except Exception as error:
    print(json.dumps({{"failures": ["submission could not be imported: " + type(error).__name__]}}))
    sys.stdout.flush()
    os._exit(0)
phases = {phases!r}
if phases:
    failures = []
    for name in phases:
        failures.extend(getattr(check_sharing, name)(sharing, {seed!r}))
else:
    failures = check_sharing.run(sharing, {seed!r})
print(json.dumps({{"failures": failures}}))
sys.stdout.flush()
os._exit(0)
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
    if checkpoint_id == "threshold":
        return _check_threshold(submission)
    if checkpoint_id in CODE_CHECKPOINTS:
        seed = f"{SEED}:transfer" if checkpoint_id == "transfer" else SEED
        return _run_submission(submission, CODE_CHECKPOINTS[checkpoint_id], seed)
    return False

# BEGIN GENERATED PORTAL EDITOR API
from verifier.workbench import PortalEditorSupport

_WORKBENCH = PortalEditorSupport(
    root=ROOT,
    seed=SEED,
    problem_id='ac26-w2-secret-sharing',
    problem_name='分けても、まだ何も分からない',
    problem_name_en='Split it, and still nobody knows',
    description='秘密を n 個に分けて配る。足せば戻る。それだけなら暗号ではない。n-1 個を持っていても何も分からないことを、証拠で示す。',
    description_en='Split a secret across n parties. Add them up and it comes back. If that were all, it would not be cryptography. Show, with evidence, that holding n-1 of them tells you nothing.',
    checkpoint_labels={'share-and-reconstruct': '分けて、集めて、戻す', 'hides-the-secret': '足りない集合からは何も言えないことを示す', 'threshold': '必要数を、証人つきで答える', 'rerandomize': '秘密を変えずに share を入れ替える', 'transfer': '見たことのない設定でも成立させる'},
    checkpoint_labels_en={'share-and-reconstruct': 'Split it, collect it, get it back', 'hides-the-secret': 'Show that a short set says nothing', 'threshold': 'Answer how many are needed, with witnesses', 'rerandomize': 'Refresh the shares without moving the secret', 'transfer': 'Hold up in settings you have not seen'},
    submitted_files=('sharing.py',),
    code_checkpoints=('share-and-reconstruct', 'hides-the-secret', 'rerandomize', 'transfer'),
    checkpoints=('share-and-reconstruct', 'hides-the-secret', 'threshold', 'rerandomize', 'transfer'),
    max_body_bytes=MAX_BODY_BYTES,
    run_timeout_seconds=RUN_TIMEOUT_SECONDS,
    max_output_bytes=MAX_OUTPUT_BYTES,
    limit_fn=_limits,
)
# END GENERATED PORTAL EDITOR API

class Handler(BaseHTTPRequestHandler):
    """Serve the Portal editor API and preserve the existing /verify contract."""

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
        self._respond(404, {"error": "not found"})

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
    port = int(os.environ.get("VERIFY_PORT", "18095"))
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
