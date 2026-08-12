"""POST /verify — the scoring seam. Loopback only, stdlib only.

Same security contract as the AC26 template. Three checkpoints run the learner's
gmw.py against seeded settings; `choice-leak` and `cross-term-audit` grade structured
answers, because each asks for a prediction that is machine-checkable rather than
prose — a pair of request values that decide a choice, and the share patterns a
shortcut breaks on.
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

from fixtures.generate import audit_bits, ot_setting

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
    "ot-request": ("check_request",),
    "ot-round-trip": ("check_round_trip", "check_wrong_branch"),
    "gmw-and": ("check_gmw_outputs", "check_ot_usage"),
}
CHECKPOINTS = (
    "ot-request",
    "ot-round-trip",
    "choice-leak",
    "gmw-and",
    "cross-term-audit",
)

#: The share patterns [x0, x1, y0, y1] on which "each party ANDs its own shares
#: locally" disagrees with the real AND — exactly the patterns whose cross terms
#: x0&y1 ^ x1&y0 are live. Derived, not transcribed, so the grader and the statement
#: cannot drift apart.
_FAILING_PATTERNS = frozenset(
    (x0, x1, y0, y1)
    for x0 in (0, 1)
    for x1 in (0, 1)
    for y0 in (0, 1)
    for y1 in (0, 1)
    if ((x0 & y0) ^ (x1 & y1)) != ((x0 ^ x1) & (y0 ^ y1))
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


def _as_answer(submission: object) -> dict[str, object] | None:
    answer = submission
    if isinstance(answer, str):
        try:
            answer = json.loads(answer)
        except json.JSONDecodeError:
            return None
    return answer if isinstance(answer, dict) else None


def _check_choice_leak(submission: object) -> bool:
    """The two request values that decide the choice, once b is drawn from 1..q-1.

    With 0 excluded, choice 0 can no longer send the identity and choice 1 can no
    longer send A itself — so observing A means choice 0 and observing 1 means
    choice 1. Both values are demanded because either alone can be found by
    pattern-matching one sentence of the statement; producing the pair, with the
    directions right, requires seeing why each distribution lost exactly one value.
    """
    answer = _as_answer(submission)
    if answer is None:
        return False
    cfg = ot_setting(SEED)
    p, g, a = cfg["p"], cfg["g"], cfg["a"]
    a_pub = pow(g, a, p)
    try:
        reveals_zero = int(answer["requestRevealingChoiceZero"])
        reveals_one = int(answer["requestRevealingChoiceOne"])
    except (KeyError, TypeError, ValueError):
        return False
    return reveals_zero == a_pub and reveals_one == 1


def _check_cross_term_audit(submission: object) -> bool:
    """Which share patterns the OT-skipping shortcut breaks on, plus tonight's run.

    The failing set alone is a fact about the shortcut; the verdict on this
    deployment's recorded shares binds the answer to the seed, so a set copied from
    another deployment still has to be applied to *these* bits to pass.
    """
    answer = _as_answer(submission)
    if answer is None:
        return False
    patterns = answer.get("failingPatterns")
    this_run = answer.get("thisRun")
    if not isinstance(patterns, list) or not isinstance(this_run, dict):
        return False
    try:
        submitted = {
            (int(p_[0]), int(p_[1]), int(p_[2]), int(p_[3]))
            for p_ in patterns
            if isinstance(p_, (list, tuple)) and len(p_) == 4
        }
    except (TypeError, ValueError):
        return False
    if len(submitted) != len(patterns) or submitted != _FAILING_PATTERNS:
        return False
    bits = audit_bits(SEED)
    x0, x1, y0, y1 = bits["x0"], bits["x1"], bits["y0"], bits["y1"]
    try:
        echoed = {name: int(this_run[name]) for name in ("x0", "x1", "y0", "y1")}
        broken = int(this_run["broken"])
        correct = int(this_run["correct"])
    except (KeyError, TypeError, ValueError):
        return False
    if echoed != bits:
        return False
    return broken == ((x0 & y0) ^ (x1 & y1)) and correct == ((x0 ^ x1) & (y0 ^ y1))


RUNNER = """
import json, os, sys
sys.path.insert(0, {root!r})
sys.path.insert(0, {workspace!r})
from tests.hidden import check_gmw
try:
    import gmw
except Exception as error:
    print(json.dumps({{"failures": ["submission could not be imported: " + type(error).__name__]}}))
    sys.stdout.flush()
    os._exit(0)
phases = {phases!r}
if phases:
    failures = []
    for name in phases:
        failures.extend(getattr(check_gmw, name)(gmw, {seed!r}))
else:
    failures = check_gmw.run(gmw, {seed!r})
print(json.dumps({{"failures": failures}}))
sys.stdout.flush()
os._exit(0)
"""


def _run_submission(submission: object, phases: tuple[str, ...], seed: str) -> bool:
    source = submission
    if isinstance(source, dict):
        source = source.get("gmw.py")
    if not isinstance(source, str) or not source.strip():
        return False
    if len(source) > MAX_BODY_BYTES:
        return False
    with tempfile.TemporaryDirectory() as workspace:
        (Path(workspace) / "gmw.py").write_text(source, encoding="utf-8")
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
    if checkpoint_id == "choice-leak":
        return _check_choice_leak(submission)
    if checkpoint_id == "cross-term-audit":
        return _check_cross_term_audit(submission)
    if checkpoint_id in CODE_CHECKPOINTS:
        return _run_submission(submission, CODE_CHECKPOINTS[checkpoint_id], SEED)
    return False

# BEGIN GENERATED PORTAL EDITOR API
from verifier.workbench import PortalEditorSupport

_WORKBENCH = PortalEditorSupport(
    root=ROOT,
    seed=SEED,
    problem_id='ac26-w2-gmw-and',
    problem_name='選ばなかった方は、開かない',
    problem_name_en='The one you did not choose stays closed',
    description='XOR シェアの AND を展開すると、どちらの手元にも材料がない積が 2 つ現れる。送る側は選択を知れず、受け取る側は片方しか読めない——1-out-of-2 OT の 2 つの約束を実装し、約束を破った実装から実際に選択を読み取り、OT 2 回で秘密の AND を組み立てる。',
    description_en='Expand an AND on XOR shares and two products appear that neither party can build alone. Implement the two promises of 1-out-of-2 OT — the sender cannot learn the choice, the receiver can read only one branch — read the choice off an implementation that broke one, and assemble the secret AND from two OTs.',
    checkpoint_labels={'ot-request': '選択を織り込み、それでも何も言わない request を作る', 'ot-round-trip': '選んだ枝だけが開くことを確かめる', 'choice-leak': '0 を捨てた実装から、選択を読み取る', 'gmw-and': 'OT を 2 回使って、秘密の AND を組み立てる', 'cross-term-audit': '近道がどこで壊れるかを、走らせる前に言う'},
    checkpoint_labels_en={'ot-request': 'Build a request that carries the choice and says nothing', 'ot-round-trip': 'Confirm that only the chosen branch opens', 'choice-leak': 'Read the choice off an implementation that dropped zero', 'gmw-and': 'Assemble the secret AND from two OTs', 'cross-term-audit': 'Say where the shortcut breaks, before running it'},
    submitted_files=('gmw.py',),
    code_checkpoints=('ot-request', 'ot-round-trip', 'gmw-and'),
    checkpoints=('ot-request', 'ot-round-trip', 'choice-leak', 'gmw-and', 'cross-term-audit'),
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
    port = int(os.environ.get("VERIFY_PORT", "18126"))
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
