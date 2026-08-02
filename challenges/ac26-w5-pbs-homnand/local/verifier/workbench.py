"""Shared stdlib-only support used by this challenge's Browser Workbench.

This module never decides whether a checkpoint is correct. The existing ``evaluate``
function remains the only grading seam. It serves authored evidence, runs the public
suite against browser-edited files in a throwaway copy, formats Portal submissions, and
binds direct-answer submissions to this deployment's seed.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Callable


class WorkbenchSupport:
    ASSETS = {
        "/": ("index.html", "text/html; charset=utf-8"),
        "/app.js": ("app.js", "text/javascript; charset=utf-8"),
        "/styles.css": ("styles.css", "text/css; charset=utf-8"),
    }

    def __init__(
        self,
        *,
        root: Path,
        seed: str,
        problem_id: str,
        problem_name: str,
        description: str,
        submitted_files: tuple[str, ...],
        code_checkpoints: tuple[str, ...],
        checkpoints: tuple[str, ...],
        checkpoint_labels: dict[str, str],
        max_body_bytes: int,
        run_timeout_seconds: int,
        max_output_bytes: int,
        limit_fn: Callable[[], None],
    ) -> None:
        self.root = root
        self.seed = seed
        self.problem_id = problem_id
        self.problem_name = problem_name
        self.description = description
        self.submitted_files = submitted_files
        self.code_checkpoints = code_checkpoints
        self.checkpoints = checkpoints
        self.manual_checkpoints = tuple(
            checkpoint for checkpoint in checkpoints if checkpoint not in code_checkpoints
        )
        self.checkpoint_labels = checkpoint_labels
        self.max_body_bytes = max_body_bytes
        self.run_timeout_seconds = run_timeout_seconds
        self.max_output_bytes = max_output_bytes
        self.limit_fn = limit_fn

    def config_payload(self) -> dict[str, object]:
        return {
            "id": self.problem_id,
            "name": self.problem_name,
            "description": self.description,
            "submittedFiles": list(self.submitted_files),
            "checkpoints": [
                {
                    "id": checkpoint,
                    "label": self.checkpoint_labels.get(checkpoint, checkpoint),
                    "kind": "code" if checkpoint in self.code_checkpoints else "answer",
                }
                for checkpoint in self.checkpoints
            ],
        }

    def starter_payload(self) -> dict[str, str]:
        return {
            name: (self.root / "starter" / name).read_text(encoding="utf-8")
            for name in self.submitted_files
        }

    def asset(self, request_path: str) -> tuple[bytes, str] | None:
        asset = self.ASSETS.get(request_path)
        if asset is None:
            return None
        filename, content_type = asset
        try:
            content = (self.root / "workbench" / filename).read_bytes()
        except OSError:
            return None
        return content, content_type

    def inspect_payload(self) -> dict[str, object]:
        show = self.root / "show.py"
        if not show.exists():
            return {
                "output": (
                    f"{self.problem_name}\n\n"
                    "No separate inspect script is shipped. Read the problem statement and "
                    "the starter source shown in the editors below."
                )
            }
        result = self._run_process(
            [sys.executable, "-I", str(show)],
            cwd=self.root,
            env={
                "PATH": "/usr/local/bin:/usr/bin:/bin",
                "FLAG_SEED": self.seed,
                "PYTHONDONTWRITEBYTECODE": "1",
            },
            timeout=self.run_timeout_seconds,
        )
        if result is None:
            return {"output": "inspect timed out or could not start."}
        _status, output = result
        return {"output": output or "inspect produced no output."}

    def _normalize_files(self, files: object) -> dict[str, str] | None:
        if not isinstance(files, dict):
            return None
        if set(files) != set(self.submitted_files):
            return None
        normalized: dict[str, str] = {}
        for name in self.submitted_files:
            value = files.get(name)
            if not isinstance(value, str) or not value.strip():
                return None
            normalized[name] = value
        if sum(len(value.encode("utf-8")) for value in normalized.values()) > self.max_body_bytes:
            return None
        return normalized

    def run_public_tests(self, files: object) -> dict[str, object]:
        sources = self._normalize_files(files)
        if sources is None:
            return {
                "passed": False,
                "output": "Every Workbench editor must contain a non-empty source file.",
            }
        with tempfile.TemporaryDirectory() as temp_directory:
            copied_root = Path(temp_directory) / "problem"
            shutil.copytree(
                self.root,
                copied_root,
                ignore=shutil.ignore_patterns(
                    "__pycache__", "*.pyc", "reference", "mutation.py", "workbench"
                ),
            )
            for name, source in sources.items():
                destination = copied_root / "starter" / name
                destination.parent.mkdir(parents=True, exist_ok=True)
                destination.write_text(source, encoding="utf-8")

            test_files = sorted((copied_root / "tests" / "public").glob("test_*.py"))
            if not test_files:
                return {"passed": False, "output": "No public tests were found."}

            transcript: list[str] = []
            all_passed = True
            for test_file in test_files:
                result = self._run_process(
                    [sys.executable, "-I", str(test_file)],
                    cwd=copied_root,
                    env={
                        "PATH": "/usr/local/bin:/usr/bin:/bin",
                        "FLAG_SEED": self.seed,
                        "PYTHONDONTWRITEBYTECODE": "1",
                        "BROWSER_PUBLIC_TESTS": "1",
                    },
                    timeout=self.run_timeout_seconds,
                )
                transcript.append(f"== {test_file.name} ==")
                if result is None:
                    all_passed = False
                    transcript.append("timed out or could not start")
                    continue
                status, output = result
                transcript.append(output.rstrip())
                if status != 0:
                    all_passed = False
            return {
                "passed": all_passed,
                "output": "\n".join(transcript)[-self.max_output_bytes :],
            }

    def prepare_submissions(self, files: object, manual: object) -> dict[str, object]:
        sources = self._normalize_files(files)
        if sources is None:
            return {
                "ok": False,
                "output": "Every Workbench editor must contain a non-empty source file.",
            }
        manual_values = manual if isinstance(manual, dict) else {}
        missing = [
            checkpoint
            for checkpoint in self.manual_checkpoints
            if not isinstance(manual_values.get(checkpoint), str)
            or not manual_values[checkpoint].strip()
        ]
        if missing:
            return {
                "ok": False,
                "output": "Complete the direct-answer fields before prepare.",
                "missingManual": missing,
            }

        if len(sources) == 1:
            code_value = next(iter(sources.values()))
        else:
            code_value = json.dumps(sources, separators=(",", ":"), ensure_ascii=False)

        submissions: dict[str, str] = {
            checkpoint: self._seal_manual(checkpoint, code_value)
            for checkpoint in self.code_checkpoints
        }
        for checkpoint in self.manual_checkpoints:
            submissions[checkpoint] = self._seal_manual(
                checkpoint, self._decode_manual(manual_values[checkpoint])
            )
        return {"ok": True, "submissions": submissions}

    @staticmethod
    def _decode_manual(raw_value: str) -> object:
        try:
            return json.loads(raw_value)
        except json.JSONDecodeError:
            return raw_value.strip()

    @staticmethod
    def _b64encode(value: bytes) -> str:
        return base64.urlsafe_b64encode(value).rstrip(b"=").decode("ascii")

    @staticmethod
    def _b64decode(value: str) -> bytes:
        padding = "=" * (-len(value) % 4)
        return base64.urlsafe_b64decode(value + padding)

    def _seal_manual(self, checkpoint_id: str, answer: object) -> str:
        payload = json.dumps(
            {"v": 1, "checkpointId": checkpoint_id, "answer": answer},
            ensure_ascii=False,
            separators=(",", ":"),
            sort_keys=True,
        ).encode("utf-8")
        key = hashlib.sha256(
            (self.problem_id + "\0" + self.seed).encode("utf-8")
        ).digest()
        signature = hmac.new(key, payload, hashlib.sha256).digest()[:16]
        return f"tcw1.{self._b64encode(payload)}.{self._b64encode(signature)}"

    def unwrap_submission(self, checkpoint_id: str, submission: object) -> object:
        if not isinstance(submission, str) or not submission.startswith("tcw1."):
            # Direct-answer checkpoints must travel through prepare so the value is
            # tied to this deployment. Code checkpoints retain their historical raw
            # source format for Portal compatibility.
            return None if checkpoint_id in self.manual_checkpoints else submission
        try:
            prefix, encoded_payload, encoded_signature = submission.split(".", 2)
            if prefix != "tcw1":
                return None
            payload = self._b64decode(encoded_payload)
            signature = self._b64decode(encoded_signature)
            key = hashlib.sha256(
                (self.problem_id + "\0" + self.seed).encode("utf-8")
            ).digest()
            expected = hmac.new(key, payload, hashlib.sha256).digest()[:16]
            if not hmac.compare_digest(signature, expected):
                return None
            decoded = json.loads(payload.decode("utf-8"))
        except (ValueError, UnicodeDecodeError, json.JSONDecodeError):
            return None
        if not isinstance(decoded, dict):
            return None
        if decoded.get("v") != 1 or decoded.get("checkpointId") != checkpoint_id:
            return None
        return decoded.get("answer")

    def _run_process(
        self,
        command: list[str],
        *,
        cwd: Path,
        env: dict[str, str],
        timeout: int,
    ) -> tuple[int, str] | None:
        with tempfile.TemporaryDirectory() as transcript_directory:
            transcript = Path(transcript_directory) / "stdout"
            try:
                with transcript.open("w", encoding="utf-8") as sink:
                    completed = subprocess.run(  # noqa: S603 - fixed argv, shell=False
                        command,
                        cwd=cwd,
                        env=env,
                        stdout=sink,
                        stderr=subprocess.STDOUT,
                        text=True,
                        timeout=timeout,
                        preexec_fn=self.limit_fn,
                        check=False,
                    )
                output = transcript.read_text(encoding="utf-8", errors="replace")
            except (subprocess.TimeoutExpired, OSError, ValueError):
                return None
        return completed.returncode, output[-self.max_output_bytes :]
