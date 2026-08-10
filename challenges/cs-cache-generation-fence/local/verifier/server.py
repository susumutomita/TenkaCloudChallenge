"""Loopback Portal API and multi-checkpoint verifier for the cache lab."""

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
from urllib.parse import urlsplit

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fixtures.generate import audit_trace, health_token, race_evidence

ROOT = Path(__file__).resolve().parents[1]
SEED = os.environ.get("FLAG_SEED", "local-dev-seed")

MAX_BODY_BYTES = 256 * 1024
RUN_TIMEOUT_SECONDS = 10
MAX_ADDRESS_SPACE_BYTES = 512 * 1024 * 1024
MAX_PROCESSES = 64
MAX_OUTPUT_BYTES = 64 * 1024
REQUEST_TIMEOUT_SECONDS = 15

CHECKPOINTS = (
    "environment",
    "audit",
    "basic-invalidate",
    "fence",
    "per-key",
    "generalize",
)
SUBMISSION_FILES = ("cache_policy.py",)
CODE_CHECKPOINT_PHASES = {
    "basic-invalidate": "check_basic_invalidate",
    "fence": "check_fence",
    "per-key": "check_per_key",
    "generalize": "check_generalize",
}
CODE_CHECKPOINTS = frozenset(CODE_CHECKPOINT_PHASES)
CHECKPOINT_LABELS = {
    "environment": "environment — Portal editor が出す合言葉を、そのまま貼る",
    "audit": "audit — 現在の origin より古い cache hit の行番号を昇順で",
    "basic-invalidate": "basic-invalidate — 更新の世代を忘れない cache_policy.py",
    "fence": "fence — invalidate 前に始まった古い fill を戻さない cache_policy.py",
    "per-key": "per-key — ほかの商品を巻き込まない cache_policy.py",
    "generalize": "generalize — 未見の順序と revision でも成り立つ cache_policy.py",
}
ENGLISH_LABELS = {
    "environment": "environment - paste the pass phrase printed by the Portal editor",
    "audit": "audit - indices of cache hits older than the current origin revision, ascending",
    "basic-invalidate": "basic-invalidate - a cache_policy.py that remembers the update generation",
    "fence": "fence - a cache_policy.py that refuses a fill started before invalidation",
    "per-key": "per-key - a cache_policy.py that does not disturb other products",
    "generalize": "generalize - a cache_policy.py that holds for unseen orderings and revisions",
}

_ADDRESS_SPACE_CAPPABLE = sys.platform.startswith("linux")


def _limits() -> None:
    if _ADDRESS_SPACE_CAPPABLE:
        resource.setrlimit(resource.RLIMIT_AS, (MAX_ADDRESS_SPACE_BYTES, MAX_ADDRESS_SPACE_BYTES))
    resource.setrlimit(resource.RLIMIT_NPROC, (MAX_PROCESSES, MAX_PROCESSES))
    resource.setrlimit(resource.RLIMIT_FSIZE, (MAX_OUTPUT_BYTES, MAX_OUTPUT_BYTES))


def starter_payload() -> dict[str, str]:
    return {
        name: (ROOT / "starter" / name).read_text(encoding="utf-8")
        for name in SUBMISSION_FILES
    }


def config_payload() -> dict[str, object]:
    return {
        "id": "cs-cache-generation-fence",
        "name": "消した。それでも古い値が戻ってきた",
        "description": "invalidate 後に遅れて完了した古い fill が cache を復活させる trace を監査し、世代 fence を実装する。",
        "submittedFiles": list(SUBMISSION_FILES),
        "checkpoints": [
            {
                "id": checkpoint,
                "label": CHECKPOINT_LABELS[checkpoint],
                "kind": "code" if checkpoint in CODE_CHECKPOINTS else "answer",
            }
            for checkpoint in CHECKPOINTS
        ],
        "i18n": {
            "en": {
                "name": "Deleted. The old value still came back",
                "description": "A product price was updated and its old cache entry deleted, yet a later request received the old price. Find the stale responses in the decision log and write a generation fence that refuses fills started before invalidation.",
                "checkpointLabels": ENGLISH_LABELS,
            }
        },
    }


def inspect_payload(seed: str) -> dict[str, object]:
    rows, _answer = audit_trace(seed)
    return {
        "environment": {
            "python": sys.version.split()[0],
            "healthToken": health_token(seed),
        },
        "race": race_evidence(seed),
        "audit": {
            "rule": "A cache_hit is stale when its revision is lower than the latest earlier origin_commit for that key.",
            "events": [{"index": index, **row} for index, row in enumerate(rows)],
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
    sources: dict[str, str],
    script: str,
    seed: str,
    *,
    pass_record: bytes = b"",
    fail_record: bytes = b"",
) -> tuple[int, str] | None:
    with tempfile.TemporaryDirectory() as workspace:
        for name, source in sources.items():
            (Path(workspace) / name).write_text(source, encoding="utf-8")
        transcript = Path(workspace) / "stdout"
        try:
            with transcript.open("w", encoding="utf-8") as sink:
                completed = subprocess.run(  # noqa: S603 - fixed argv, shell=False
                    [
                        sys.executable,
                        "-I",
                        "-c",
                        script.format(
                            root=str(ROOT),
                            workspace=workspace,
                            seed=seed,
                            pass_record=pass_record,
                            fail_record=fail_record,
                        ),
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
runpy.run_path({root!r} + "/tests/public/test_cache_policy.py", run_name="__main__")
"""


def run_public_tests(seed: str, files: object) -> dict[str, object]:
    sources = _submission_sources(files)
    if sources is None:
        return {"passed": False, "output": "cache_policy.py must be a non-empty Python file."}
    result = _run_submission_script(sources, PUBLIC_TEST_SCRIPT, seed)
    if result is None:
        return {"passed": False, "output": "Public tests timed out or could not start."}
    return {"passed": result[0] == 0, "output": result[1]}


def prepare_submissions(seed: str, files: object) -> dict[str, object]:
    sources = _submission_sources(files)
    if sources is None:
        return {"ok": False, "output": "cache_policy.py must be a non-empty Python file."}
    source = sources["cache_policy.py"]
    return {
        "ok": True,
        "submissions": {
            "environment": health_token(seed),
            **{checkpoint: source for checkpoint in CODE_CHECKPOINTS},
        },
    }


def _check_environment(submission: object) -> bool:
    return isinstance(submission, str) and submission.strip() == health_token(SEED)


def _normalized_int_list(submission: object) -> list[int] | None:
    value = submission
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except json.JSONDecodeError:
            return None
    if not isinstance(value, list):
        return None
    normalized: list[int] = []
    for item in value:
        if type(item) is not int:
            return None
        normalized.append(item)
    return normalized


def _check_audit(submission: object) -> bool:
    value = _normalized_int_list(submission)
    if value is None or len(value) != len(set(value)):
        return False
    _events, stale = audit_trace(SEED)
    return sorted(value) == stale


RUNNER = """
import json, os, sys
hard_exit = os._exit
trusted_stdout = sys.stdout
trusted_write = sys.stdout.buffer.write
sys.path.insert(0, {root!r})
from tests.hidden import check_cache_policy
private_checker = getattr(check_cache_policy, __PHASE__)
for module_name in tuple(sys.modules):
    if module_name == "tests" or module_name.startswith("tests.") or module_name == "fixtures" or module_name.startswith("fixtures."):
        sys.modules.pop(module_name, None)
while {root!r} in sys.path:
    sys.path.remove({root!r})
sys.path.insert(0, {workspace!r})

try:
    import cache_policy
except Exception:
    # submission could not be imported: emit only the private, nonce-bound failure record.
    os._exit = hard_exit
    sys.stdout = trusted_stdout
    trusted_write({fail_record!r})
    sys.stdout.flush()
    os._exit(0)

required = ("invalidate", "admit_fill")
if any(not hasattr(cache_policy, name) for name in required):
    failures = ["submission does not define both required functions"]
else:
    try:
        failures = private_checker(cache_policy, {seed!r})
    except Exception:
        failures = ["submission could not be checked"]

# Participant imports may replace json.dumps, print, sys.stdout, or os._exit. Restore
# the trusted C-backed output/exit handles and write a fixed record instead of calling
# any participant-mutable serializer after grading.
os._exit = hard_exit
sys.stdout = trusted_stdout
trusted_write({pass_record!r} if not failures else {fail_record!r})
sys.stdout.flush()
os._exit(0)
"""


def _check_code(phase: str, submission: object) -> bool:
    if not isinstance(submission, str) or not submission.strip() or len(submission) > MAX_BODY_BYTES:
        return False
    verdict_token = secrets.token_hex(32)
    pass_line = f"TC-VERDICT:{verdict_token}:PASS"
    fail_line = f"TC-VERDICT:{verdict_token}:FAIL"
    runner = RUNNER.replace("__PHASE__", repr(phase))
    result = _run_submission_script(
        {"cache_policy.py": submission},
        runner,
        SEED,
        pass_record=(pass_line + "\n").encode("utf-8"),
        fail_record=(fail_line + "\n").encode("utf-8"),
    )
    if result is None or result[0] != 0:
        return False
    lines = result[1].splitlines()
    return bool(lines) and lines[-1] == pass_line


def _check_basic_invalidate(submission: object) -> bool:
    return _check_code("check_basic_invalidate", submission)


def _check_fence(submission: object) -> bool:
    return _check_code("check_fence", submission)


def _check_per_key(submission: object) -> bool:
    return _check_code("check_per_key", submission)


def _check_generalize(submission: object) -> bool:
    return _check_code("check_generalize", submission)


def evaluate(checkpoint_id: str, submission: object) -> bool:
    if checkpoint_id == "environment":
        return _check_environment(submission)
    if checkpoint_id == "audit":
        return _check_audit(submission)
    checker = {
        "basic-invalidate": _check_basic_invalidate,
        "fence": _check_fence,
        "per-key": _check_per_key,
        "generalize": _check_generalize,
    }.get(checkpoint_id)
    return checker(submission) if checker is not None else False


class Handler(BaseHTTPRequestHandler):
    timeout = REQUEST_TIMEOUT_SECONDS

    def do_GET(self) -> None:  # noqa: N802
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

    def do_POST(self) -> None:  # noqa: N802
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
        except (UnicodeDecodeError, json.JSONDecodeError, TimeoutError, OSError):
            self._respond(400, {"error": "bad request body"})
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
        except Exception:  # noqa: BLE001 - verifier failures fail closed
            correct = False
        self._respond(200, {"checkpointId": checkpoint_id, "correct": correct})

    def log_message(self, *_args: object) -> None:
        """Do not echo learner submissions to stderr."""

    def _respond(self, status: int, payload: dict[str, object]) -> None:
        encoded = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("content-type", "application/json")
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
    port = int(os.environ.get("VERIFY_PORT", "18340"))
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
