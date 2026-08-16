"""Participant Workbench API.

This image carries the harness, the starter, and the public tests. It does not
carry the reference or the mutation suite. ``/verify`` proxies to the separately
built verifier container.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fixtures.generate import evidence_blocks, health_token

ROOT = Path(__file__).resolve().parents[1]
SEED = os.environ.get("FLAG_SEED", "local-dev-seed")
PORT = int(os.environ.get("WORKBENCH_PORT", "18570"))
VERIFIER_URL = os.environ.get("VERIFIER_URL", "http://verifier:18571/verify")

MAX_BODY_BYTES = 256 * 1024
MAX_OUTPUT_BYTES = 64 * 1024
RUN_TIMEOUT_SECONDS = 240
REQUEST_TIMEOUT_SECONDS = 15
SUBMISSION_FILES = ("candidate.S",)
CHECKPOINTS = ("environment", "measure", "dependency", "miss", "generalize")
CODE_CHECKPOINTS = frozenset(("measure", "dependency", "miss", "generalize"))
CHECKPOINT_LABELS = {
    "environment": "environment — 合言葉を貼る",
    "measure": "measure — まず正直に測れている状態を作る",
    "dependency": "dependency — レジスタ演算より遅くする",
    "miss": "miss — 機械が予測できないメモリまで届かせる",
    "generalize": "generalize — 見ていない seed でも成り立たせる",
}


def starter_payload() -> dict[str, str]:
    return {name: (ROOT / "starter" / name).read_text(encoding="utf-8") for name in SUBMISSION_FILES}


def config_payload() -> dict[str, object]:
    return {
        "id": "asm-worst-case-latency",
        "name": "1 命令を、どこまで遅くできるか",
        "description": "単一命令の実行時間を正直に測るハーネスの上で、この機械が最も嫌がる 1 命令を見つける。",
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
                "name": "One instruction, as slow as you can make it",
                "description": "On a harness that measures a single instruction honestly, find the one this machine hates most.",
                "checkpointLabels": {
                    "environment": "environment - paste the pass phrase",
                    "measure": "measure - produce an honest measurement at all",
                    "dependency": "dependency - beat register arithmetic",
                    "miss": "miss - reach memory the machine cannot predict",
                    "generalize": "generalize - hold up under an unseen seed",
                },
            }
        },
    }


def inspect_payload(seed: str) -> dict[str, object]:
    return evidence_blocks(seed)


def _submission_source(files: object) -> str | None:
    if not isinstance(files, dict):
        return None
    source = files.get("candidate.S")
    if not isinstance(source, str) or not source.strip() or len(source) > MAX_BODY_BYTES:
        return None
    return source


def run_public_tests(seed: str, files: object) -> dict[str, object]:
    """Build the participant's candidate with the harness and show the number.

    This is the same harness the verifier uses, so a participant is never
    surprised by the measurement — only by the threshold.
    """
    source = _submission_source(files)
    if source is None:
        return {"passed": False, "output": "candidate.S must be a non-empty assembly file."}

    with tempfile.TemporaryDirectory() as workspace:
        work = Path(workspace)
        (work / "candidate.S").write_text(source, encoding="utf-8")
        binary = work / "measure"
        build = subprocess.run(
            [
                "gcc", "-O2", "-I", str(ROOT / "harness"), "-o", str(binary),
                str(ROOT / "harness" / "measure.c"), str(ROOT / "harness" / "arena.c"),
                str(ROOT / "harness" / "baseline.S"), str(work / "candidate.S"),
            ],
            capture_output=True, text=True, timeout=120, check=False,
        )
        if build.returncode != 0:
            return {"passed": False, "output": build.stderr[-MAX_OUTPUT_BYTES:]}
        try:
            completed = subprocess.run(
                [str(binary), str(abs(hash(seed)) % (2**31))],
                capture_output=True, text=True, timeout=RUN_TIMEOUT_SECONDS, check=False,
            )
        except subprocess.TimeoutExpired:
            return {"passed": False, "output": "the measurement did not finish within its time limit."}
        if completed.returncode != 0:
            return {"passed": False, "output": "the measurement did not complete."}
        return {"passed": True, "output": completed.stdout[-MAX_OUTPUT_BYTES:]}


def prepare_submissions(seed: str, files: object) -> dict[str, object]:
    source = _submission_source(files)
    if source is None:
        return {"ok": False, "output": "candidate.S must be a non-empty assembly file."}
    return {
        "ok": True,
        "submissions": {
            "environment": health_token(seed),
            "measure": source,
            "dependency": source,
            "miss": source,
            "generalize": source,
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
            self._respond(400, {"error": "bad json"})
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
        request = urllib.request.Request(
            VERIFIER_URL, data=raw, headers={"content-type": "application/json"}, method="POST"
        )
        try:
            with urllib.request.urlopen(request, timeout=RUN_TIMEOUT_SECONDS + 30) as response:
                forwarded = response.read(MAX_BODY_BYTES)
                status = response.status
        except (urllib.error.URLError, OSError, TimeoutError):
            self._respond(503, {"error": "verifier unavailable"})
            return
        self._raw(status, forwarded)

    def _respond(self, status: int, payload: object) -> None:
        self._raw(status, json.dumps(payload, ensure_ascii=False).encode("utf-8"))

    def _raw(self, status: int, payload: bytes) -> None:
        self.send_response(status)
        self.send_header("content-type", "application/json; charset=utf-8")
        self.send_header("content-length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def log_message(self, _format: str, *_args: object) -> None:
        return


def main() -> None:
    ThreadingHTTPServer(("0.0.0.0", PORT), Handler).serve_forever()  # noqa: S104 - compose publishes loopback only


if __name__ == "__main__":
    main()
