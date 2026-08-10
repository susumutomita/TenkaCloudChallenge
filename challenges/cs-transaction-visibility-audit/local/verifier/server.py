"""Loopback Portal editor API and multi-checkpoint `/verify` seam.

Learner code runs in a fresh temporary directory with a wall-clock timeout, memory,
process, file-size, and output caps.  No submitted value is concatenated into a shell
command.  Direct answers travel through the Portal prepare API and are sealed to this
problem and deployment seed by the vendored workbench adapter.
"""

from __future__ import annotations

import json
import os
import resource
import secrets
import subprocess
import sys
import tempfile
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fixtures.generate import (
    audit_expected,
    audit_fixture,
    counterexample_expected,
    counterexample_fixture,
)

ROOT = Path(__file__).resolve().parents[1]
SEED = os.environ.get("FLAG_SEED", "local-dev-seed")

MAX_BODY_BYTES = 256 * 1024
RUN_TIMEOUT_SECONDS = 10
MAX_ADDRESS_SPACE_BYTES = 512 * 1024 * 1024
MAX_PROCESSES = 64
MAX_OUTPUT_BYTES = 64 * 1024
REQUEST_TIMEOUT_SECONDS = 15
VERIFIER_URL = os.environ.get("VERIFIER_URL")

CODE_CHECKPOINTS = {
    "snapshot": ("check_snapshot",),
    "transfer": ("check_transfer",),
}
CHECKPOINTS = ("audit", "counterexample", "snapshot", "transfer")
_ADDRESS_SPACE_CAPPABLE = sys.platform.startswith("linux")


def _limits() -> None:
    if _ADDRESS_SPACE_CAPPABLE:
        resource.setrlimit(resource.RLIMIT_AS, (MAX_ADDRESS_SPACE_BYTES, MAX_ADDRESS_SPACE_BYTES))
    resource.setrlimit(resource.RLIMIT_NPROC, (MAX_PROCESSES, MAX_PROCESSES))
    resource.setrlimit(resource.RLIMIT_FSIZE, (MAX_OUTPUT_BYTES, MAX_OUTPUT_BYTES))


def _json_object(submission: object) -> dict[str, object] | None:
    value = submission
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except json.JSONDecodeError:
            return None
    return value if isinstance(value, dict) else None


def _check_audit(submission: object) -> bool:
    answer = _json_object(submission)
    if answer is None or set(answer) != {"reportId", "observedRevisions"}:
        return False
    if not isinstance(answer["reportId"], str):
        return False
    revisions = answer["observedRevisions"]
    if (
        not isinstance(revisions, list)
        or len(revisions) != 2
        or any(type(revision) is not int for revision in revisions)
    ):
        return False
    return answer == audit_expected(SEED)


def _check_counterexample(submission: object) -> bool:
    answer = _json_object(submission)
    if answer is None or set(answer) != {"beforeCommit", "commit", "afterCommit"}:
        return False
    if not isinstance(answer["commit"], str):
        return False
    for key in ("beforeCommit", "afterCommit"):
        ids = answer[key]
        if not isinstance(ids, list) or len(ids) != 2 or any(not isinstance(i, str) for i in ids):
            return False
    return answer == counterexample_expected(SEED)


RUNNER = """
import json, os, sys
hard_exit = os._exit
trusted_stdout = sys.stdout
trusted_write = sys.stdout.buffer.write
sys.path.insert(0, {root!r})
from tests.hidden import check_report
checkers = tuple(getattr(check_report, phase) for phase in {phases!r})

# Keep private callable references, then remove the checker package and path before
# importing participant code. The submission must not be able to replace a hidden
# check through Python's shared module cache.
for module_name in tuple(sys.modules):
    if module_name == "tests" or module_name.startswith("tests."):
        sys.modules.pop(module_name, None)
while {root!r} in sys.path:
    sys.path.remove({root!r})
sys.path.insert(0, {workspace!r})

try:
    import report
except Exception:
    # submission could not be imported: emit only the private, nonce-bound failure record.
    os._exit = hard_exit
    sys.stdout = trusted_stdout
    trusted_write({fail_record!r})
    sys.stdout.flush()
    os._exit(0)

failures = []
if not hasattr(report, "build_report"):
    failures.append("submission does not define build_report()")
else:
    for checker in checkers:
        failures.extend(checker(report, {seed!r}))

# Participant imports may replace json.dumps, print, sys.stdout, or os._exit. Restore
# the trusted C-backed output/exit handles and write a fixed record instead of calling
# any participant-mutable serializer after grading.
os._exit = hard_exit
sys.stdout = trusted_stdout
trusted_write({pass_record!r} if not failures else {fail_record!r})
sys.stdout.flush()
os._exit(0)
"""


def _run_submission(submission: object, phases: tuple[str, ...], seed: str) -> bool:
    source = submission
    if isinstance(source, dict):
        source = source.get("report.py")
    if not isinstance(source, str) or not source.strip():
        return False
    if len(source.encode("utf-8")) > MAX_BODY_BYTES:
        return False

    with tempfile.TemporaryDirectory() as workspace:
        verdict_token = secrets.token_hex(32)
        pass_line = f"TC-VERDICT:{verdict_token}:PASS"
        fail_line = f"TC-VERDICT:{verdict_token}:FAIL"
        (Path(workspace) / "report.py").write_text(source, encoding="utf-8")
        script = RUNNER.format(
            root=str(ROOT),
            workspace=workspace,
            phases=list(phases),
            seed=seed,
            pass_record=(pass_line + "\n").encode("utf-8"),
            fail_record=(fail_line + "\n").encode("utf-8"),
        )
        transcript = Path(workspace) / "stdout"
        try:
            with transcript.open("w", encoding="utf-8") as sink:
                completed = subprocess.run(  # noqa: S603 - fixed argv, shell=False
                    [sys.executable, "-I", "-c", script],
                    cwd=workspace,
                    env={"PATH": "/usr/local/bin:/usr/bin:/bin"},
                    stdout=sink,
                    stderr=subprocess.STDOUT,
                    text=True,
                    timeout=RUN_TIMEOUT_SECONDS,
                    preexec_fn=_limits,
                    check=False,
                )
            output = transcript.read_text(encoding="utf-8", errors="replace")
        except (subprocess.TimeoutExpired, OSError, ValueError):
            return False
    if completed.returncode != 0:
        return False
    lines = output[-MAX_OUTPUT_BYTES:].splitlines()
    return bool(lines) and lines[-1] == pass_line


def evaluate(checkpoint_id: str, submission: object) -> bool:
    if checkpoint_id == "audit":
        return _check_audit(submission)
    if checkpoint_id == "counterexample":
        return _check_counterexample(submission)
    phases = CODE_CHECKPOINTS.get(checkpoint_id)
    if phases is not None:
        phase_seed = f"{SEED}:transfer" if checkpoint_id == "transfer" else SEED
        return _run_submission(submission, phases, phase_seed)
    return False


# BEGIN GENERATED PORTAL EDITOR API
from verifier.workbench import PortalEditorSupport

_WORKBENCH = PortalEditorSupport(
    root=ROOT,
    seed=SEED,
    problem_id="cs-transaction-visibility-audit",
    problem_name='どちらも committed。だが、その合計は一度も存在しない',
    problem_name_en='Both reads were committed. The total never existed',
    description='ポイント台帳の各 read は、その瞬間の committed 値を返している。公開テストも緑。それでも複数口座を束ねた report は、一度も存在しなかった合計を返せる。seed 固有の監査ログから反例を組み立て、1 revision の snapshot で report を直す。',
    description_en='Every account read returns a committed value and the public tests are green. A multi-account report can still return a total that never existed. Audit seed-derived traces, construct the counterexample, and bind the report to one immutable snapshot revision.',
    checkpoint_labels={'audit': 'audit — 一度も存在しない report と観測 revision を特定する', 'counterexample': 'counterexample — read の途中へ 1 commit を置き、反例を作る', 'snapshot': 'snapshot — report の全 row と revision を 1 つの view に固定する', 'transfer': 'transfer — 未見の ID・順序・複数 commit でも同じ性質を保つ'},
    checkpoint_labels_en={'audit': 'audit - name the report that never existed and its observed revisions', 'counterexample': 'counterexample - place one commit inside the reads and build the failure', 'snapshot': 'snapshot - bind every row and the revision to one view', 'transfer': 'transfer - keep the property for unseen IDs, orders, and commits'},
    submitted_files=("report.py",),
    code_checkpoints=("snapshot", "transfer"),
    checkpoints=CHECKPOINTS,
    max_body_bytes=MAX_BODY_BYTES,
    run_timeout_seconds=RUN_TIMEOUT_SECONDS,
    max_output_bytes=MAX_OUTPUT_BYTES,
    limit_fn=_limits,
)
# END GENERATED PORTAL EDITOR API


class Handler(BaseHTTPRequestHandler):
    timeout = REQUEST_TIMEOUT_SECONDS

    def do_GET(self) -> None:  # noqa: N802 - stdlib handler API
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
        if path == "/healthz":
            self._respond(200, {"ok": True})
            return
        self._respond(404, {"error": "not found"})

    def do_POST(self) -> None:  # noqa: N802 - stdlib handler API
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

        if VERIFIER_URL:
            self._proxy_verify(body)
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
        except Exception:  # noqa: BLE001 - a checkpoint failure must fail closed
            correct = False
        self._respond(200, {"checkpointId": checkpoint_id, "correct": correct})

    def _proxy_verify(self, body: dict[str, object]) -> None:
        payload = json.dumps(body, ensure_ascii=False).encode("utf-8")
        request = Request(
            VERIFIER_URL,
            data=payload,
            headers={"content-type": "application/json"},
            method="POST",
        )
        try:
            # VERIFIER_URL is a trusted Compose-only environment value, never participant input.
            with urlopen(request, timeout=REQUEST_TIMEOUT_SECONDS) as response:  # noqa: S310
                response_body = response.read(MAX_BODY_BYTES + 1)
                if len(response_body) > MAX_BODY_BYTES:
                    raise ValueError("verifier response too large")
                decoded = json.loads(response_body.decode("utf-8"))
        except (
            HTTPError,
            URLError,
            TimeoutError,
            OSError,
            ValueError,
            UnicodeDecodeError,
            json.JSONDecodeError,
        ):
            checkpoint_id = body.get("checkpointId")
            self._respond(
                200,
                {
                    "checkpointId": checkpoint_id if isinstance(checkpoint_id, str) else "",
                    "correct": False,
                },
            )
            return
        checkpoint_id = body.get("checkpointId")
        if (
            not isinstance(decoded, dict)
            or not isinstance(checkpoint_id, str)
            or decoded.get("checkpointId") != checkpoint_id
            or type(decoded.get("correct")) is not bool
        ):
            decoded = {
                "checkpointId": checkpoint_id if isinstance(checkpoint_id, str) else "",
                "correct": False,
            }
        self._respond(200, decoded)

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
        """Do not echo submissions into the access log."""

    def _respond(self, status: int, payload: dict[str, object]) -> None:
        content = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("content-type", "application/json; charset=utf-8")
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
    port = int(os.environ.get("VERIFY_PORT", "18320"))
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
