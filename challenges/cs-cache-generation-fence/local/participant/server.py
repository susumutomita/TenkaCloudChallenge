"""Participant-facing Workbench API for the cache generation-fence lab.

This image carries only public fixtures, tests, and starter material. ``/verify``
proxies to the separately built hidden verifier on the Compose-internal network so
the Participant Portal keeps one loopback URL without shipping hidden checks.
"""

from __future__ import annotations

import json
from contextlib import suppress
import os
import resource
import subprocess
import sys
import tempfile
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fixtures.generate import audit_trace, health_token, race_evidence

ROOT = Path(__file__).resolve().parents[1]
SEED = os.environ.get("FLAG_SEED", "local-dev-seed")
PORT = int(os.environ.get("WORKBENCH_PORT", "18340"))
VERIFIER_URL = os.environ.get("VERIFIER_URL", "http://verifier:18341/verify")

MAX_BODY_BYTES = 256 * 1024
MAX_OUTPUT_BYTES = 64 * 1024
MAX_ADDRESS_SPACE_BYTES = 512 * 1024 * 1024
MAX_PROCESSES = 64
RUN_TIMEOUT_SECONDS = 10
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
CODE_CHECKPOINTS = frozenset(("basic-invalidate", "fence", "per-key", "generalize"))
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


def _limits() -> None:
    if sys.platform.startswith("linux"):
        resource.setrlimit(resource.RLIMIT_AS, (MAX_ADDRESS_SPACE_BYTES, MAX_ADDRESS_SPACE_BYTES))
    resource.setrlimit(resource.RLIMIT_NPROC, (MAX_PROCESSES, MAX_PROCESSES))
    resource.setrlimit(resource.RLIMIT_FSIZE, (MAX_OUTPUT_BYTES, MAX_OUTPUT_BYTES))


def starter_payload() -> dict[str, str]:
    return {name: (ROOT / "starter" / name).read_text(encoding="utf-8") for name in SUBMISSION_FILES}


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
    rows = audit_trace(seed)
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
    with tempfile.TemporaryDirectory() as workspace:
        for name, source in sources.items():
            Path(workspace, name).write_text(source, encoding="utf-8")
        transcript = Path(workspace) / "stdout"
        try:
            with transcript.open("w", encoding="utf-8") as sink:
                completed = subprocess.run(  # noqa: S603 - fixed argv, shell=False
                    [
                        sys.executable,
                        "-I",
                        "-c",
                        PUBLIC_TEST_SCRIPT.format(root=str(ROOT), workspace=workspace, seed=seed),
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
            output = transcript.read_text(encoding="utf-8", errors="replace")[-MAX_OUTPUT_BYTES:]
        except (OSError, ValueError, subprocess.TimeoutExpired):
            return {"passed": False, "output": "Public tests timed out or could not start."}
    return {"passed": completed.returncode == 0, "output": output}


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


class Handler(BaseHTTPRequestHandler):
    timeout = REQUEST_TIMEOUT_SECONDS

    def do_GET(self) -> None:  # noqa: N802
        path = urlsplit(self.path).path
        payloads = {
            "/api/config": config_payload,
            "/api/inspect": lambda: inspect_payload(SEED),
            "/api/starter": starter_payload,
        }
        builder = payloads.get(path)
        if builder is None:
            self._respond(404, {"error": "not found"})
            return
        self._respond(200, builder())

    def do_POST(self) -> None:  # noqa: N802
        path = urlsplit(self.path).path.rstrip("/") or "/"
        if path not in ("/verify", "/api/test", "/api/prepare"):
            # 未知 path でも body は読み捨てる。 読まずに応答すると、 送られてきた本文が接続に
            # 残り、 同じ接続を再利用するクライアントでは次の要求が壊れて読めない応答になる。
            self._drain_body()
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
            raw = self.rfile.read(length)
            body = json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError, OSError, TimeoutError):
            self._respond(400, {"error": "bad request body"})
            return
        if not isinstance(body, dict):
            self._respond(400, {"error": "bad json"})
            return

        # Issue 440 / #437: Portal 越しの `prepare` が 502 になっていた。 502 は Portal 側の
        # `workbench_unavailable` / `invalid_workbench_response` で、 **この handler が JSON を
        # 返せなかった**ことしか意味しない。 素の呼び出しでは try/except が無く、 ここで想定外の
        # 例外が出ると BaseHTTPRequestHandler が HTML の traceback を返し、 Portal 側の schema
        # 検証が落ちて 502 になる — 原因が一切残らない形で。
        #
        # 例外を握り潰すのではなく、 **契約どおりの JSON へ翻訳して型名を残す**。 これで失敗は
        # 502 ではなく editor 上の読めるエラーになり、 実機で何が起きたか分かる。
        if path == "/api/test":
            try:
                self._respond(200, run_public_tests(SEED, body.get("files")))
            except Exception as error:  # noqa: BLE001 - 契約を壊さないための境界
                self._respond(
                    200,
                    {"passed": False, "output": f"public tests raised {type(error).__name__}"},
                )
            return
        if path == "/api/prepare":
            try:
                self._respond(200, prepare_submissions(SEED, body.get("files")))
            except Exception as error:  # noqa: BLE001 - 契約を壊さないための境界
                self._respond(
                    200,
                    {"ok": False, "output": f"prepare raised {type(error).__name__}"},
                )
            return

        request = urllib.request.Request(
            VERIFIER_URL,
            data=raw,
            headers={"content-type": "application/json"},
            method="POST",
        )
        try:
            with urllib.request.urlopen(request, timeout=RUN_TIMEOUT_SECONDS + 5) as response:
                forwarded = response.read(MAX_BODY_BYTES)
                status = response.status
        except urllib.error.HTTPError as error:
            forwarded = error.read(MAX_BODY_BYTES)
            status = error.code
        except (urllib.error.URLError, OSError, TimeoutError):
            self._respond(503, {"error": "verifier unavailable"})
            return
        self._raw(status, forwarded)

    def _drain_body(self) -> None:
        try:
            length = int(self.headers.get("content-length", "0"))
        except ValueError:
            return
        if 0 < length <= MAX_BODY_BYTES:
            with suppress(OSError, TimeoutError):
                self.rfile.read(length)

    def _respond(self, status: int, payload: object) -> None:
        self._raw(status, json.dumps(payload, ensure_ascii=False).encode("utf-8"))

    def _raw(self, status: int, payload: bytes) -> None:
        self.send_response(status)
        self.send_header("content-type", "application/json; charset=utf-8")
        self.send_header("content-length", str(len(payload)))
        self.send_header("cache-control", "no-store")
        self.send_header("x-content-type-options", "nosniff")
        self.send_header(
            "content-security-policy",
            "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; "
            "img-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; "
            "form-action 'self'",
        )
        self.end_headers()
        self.wfile.write(payload)

    def log_message(self, *_args: object) -> None:
        """Do not echo learner submissions to stderr."""


def main() -> None:
    # Docker port publishing reaches the container bridge, so the process listens on
    # all container interfaces. Compose exposes only the Portal-selected host loopback.
    ThreadingHTTPServer(("0.0.0.0", PORT), Handler).serve_forever()  # noqa: S104


if __name__ == "__main__":
    main()
