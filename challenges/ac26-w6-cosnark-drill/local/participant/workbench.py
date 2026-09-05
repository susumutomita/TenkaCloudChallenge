"""Shared stdlib-only support used by this challenge's Portal editor API.

This module never decides whether a checkpoint is correct. The existing ``evaluate``
function remains the only grading seam. It serves authored evidence, runs the public
suite against Portal-edited files in a throwaway copy, formats Portal submissions, and
binds direct-answer submissions to this deployment's public binding tag.
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


class PortalEditorSupport:
    def __init__(
        self,
        *,
        root: Path,
        deployment_binding: str,
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
        problem_name_en: str | None = None,
        description_en: str | None = None,
        checkpoint_labels_en: dict[str, str] | None = None,
    ) -> None:
        self.root = root
        self.deployment_binding = deployment_binding
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
        self.problem_name_en = problem_name_en
        self.description_en = description_en
        self.checkpoint_labels_en = checkpoint_labels_en or {}

    def config_payload(self) -> dict[str, object]:
        # 日本語 (従来のトップレベル) と英語 (i18n.en) を両方運ぶ。 言語の選択は Portal 側の
        # locale (TenkaCloud#2890: ?lang= → 永続 locale → browser language) が行うので、
        # この verifier はリクエストの言語を知る必要がない。 文言は生成時に metadata から
        # 埋め込まれた定数で、 実行時にこのコンテナの外を読むことはない (#381)。
        payload: dict[str, object] = {
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
        if self.problem_name_en or self.description_en or self.checkpoint_labels_en:
            payload["i18n"] = {
                "en": {
                    "name": self.problem_name_en or self.problem_name,
                    "description": self.description_en or self.description,
                    "checkpointLabels": {
                        checkpoint: self.checkpoint_labels_en.get(
                            checkpoint, self.checkpoint_labels.get(checkpoint, checkpoint)
                        )
                        for checkpoint in self.checkpoints
                    },
                }
            }
        return payload

    def starter_payload(self) -> dict[str, str]:
        return {
            name: (self.root / "starter" / name).read_text(encoding="utf-8")
            for name in self.submitted_files
        }

    def _child_env(self, **extra: str) -> dict[str, str]:
        """The fixed environment `show.py` and the public tests run under.

        Deliberately built from nothing rather than inherited, so a Portal run cannot
        pick up whatever the server process happens to carry. The one value forwarded
        from this process is `VERIFIER_PUBLIC_URL`, and only when it is set: a problem
        whose `fixtures/` no longer ships in the participant image (Issue 543/537) has
        no local way to derive this deployment's public evidence, and fetches it from
        its own Compose-internal verifier's `GET /public` instead. Problems that still
        carry `fixtures/` never set it and see exactly the environment they saw before.
        """
        env = {
            "PATH": "/usr/local/bin:/usr/bin:/bin",
            "PYTHONDONTWRITEBYTECODE": "1",
            **extra,
        }
        verifier_public_url = os.environ.get("VERIFIER_PUBLIC_URL")
        if verifier_public_url:
            env["VERIFIER_PUBLIC_URL"] = verifier_public_url
        return env

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
            env=self._child_env(),
            timeout=self.run_timeout_seconds,
        )
        if result is None:
            return {"output": "inspect timed out or could not start."}
        _status, output = result
        return {"output": output or "inspect produced no output."}

    def _normalize_files(self, files: object) -> dict[str, str] | str:
        """Validate a Portal editor payload.

        Returns the normalized sources, or a message naming which condition
        failed. One message used to cover four unrelated causes, so a payload
        carrying an extra file was told it "must contain a non-empty source
        file" while every file it sent was non-empty -- which sends the player
        to look at the wrong thing. Nothing here reveals hidden material: the
        expected file names are already published by `/api/config`.
        """
        expected = ", ".join(sorted(self.submitted_files))
        if not isinstance(files, dict):
            return f"The editor payload must be an object keyed by file name ({expected})."
        missing = sorted(set(self.submitted_files) - set(files))
        unexpected = sorted(set(files) - set(self.submitted_files))
        if missing or unexpected:
            detail = []
            if missing:
                detail.append("missing " + ", ".join(missing))
            if unexpected:
                detail.append("unexpected " + ", ".join(unexpected))
            return f"This problem is edited as exactly {expected} ({'; '.join(detail)})."
        normalized: dict[str, str] = {}
        for name in self.submitted_files:
            value = files.get(name)
            if not isinstance(value, str):
                return f"{name} must be sent as text."
            if not value.strip():
                return f"{name} is empty. Every Portal editor must contain a non-empty source file."
            normalized[name] = value
        total = sum(len(value.encode("utf-8")) for value in normalized.values())
        if total > self.max_body_bytes:
            return (
                f"The submitted sources total {total} bytes, over this lab's "
                f"{self.max_body_bytes}-byte limit."
            )
        return normalized

    def run_public_tests(self, files: object) -> dict[str, object]:
        sources = self._normalize_files(files)
        if isinstance(sources, str):
            return {"passed": False, "output": sources}
        with tempfile.TemporaryDirectory() as temp_directory:
            copied_root = Path(temp_directory) / "problem"
            shutil.copytree(
                self.root,
                copied_root,
                ignore=shutil.ignore_patterns(
                    "__pycache__", "*.pyc", "reference", "mutation.py"
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
                    env=self._child_env(BROWSER_PUBLIC_TESTS="1"),
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
        if isinstance(sources, str):
            return {"ok": False, "output": sources}
        manual_values = manual if isinstance(manual, dict) else {}

        def supplied(checkpoint: str) -> bool:
            value = manual_values.get(checkpoint)
            return isinstance(value, str) and bool(value.strip())

        # Prepare everything that *can* be prepared, and report the rest. Refusing the
        # whole call because some direct-answer field is empty locked players out of the
        # problem permanently (Issue 414).
        #
        # The Portal prepares one checkpoint at a time but sends the values of *every*
        # answer-kind checkpoint, filling the ones it has no input for with "". Once a
        # direct answer is accepted, the Portal replaces its input with a "solved" badge
        # and persists that — so after a runtime restart the remembered value is gone,
        # the field cannot be typed into again, and it arrives here as "". Under the old
        # rule that single empty string refused prepare for *all* checkpoints, including
        # pure-code ones that never needed it. A player who followed the stop button's
        # own advice to free local resources could not submit anything ever again, with
        # no way back: 2/6 cleared and the remaining four unreachable.
        #
        # Nothing is loosened by preparing partially. A code checkpoint only ever needed
        # the editor files. A direct-answer checkpoint still has to arrive sealed —
        # `unwrap_submission` rejects an unsealed manual submission — so omitting the
        # ones with no value cannot let an unanswered checkpoint score. `missingManual`
        # still names them, so a caller that wants to prompt for them still can.
        missing = [
            checkpoint for checkpoint in self.manual_checkpoints if not supplied(checkpoint)
        ]

        if len(sources) == 1:
            code_value = next(iter(sources.values()))
        else:
            code_value = json.dumps(sources, separators=(",", ":"), ensure_ascii=False)

        submissions: dict[str, str] = {
            checkpoint: self._seal_manual(checkpoint, code_value)
            for checkpoint in self.code_checkpoints
        }
        for checkpoint in self.manual_checkpoints:
            if not supplied(checkpoint):
                continue
            submissions[checkpoint] = self._seal_manual(
                checkpoint, self._decode_manual(manual_values[checkpoint])
            )
        return {"ok": True, "submissions": submissions, "missingManual": missing}

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
            (self.problem_id + "\0" + self.deployment_binding).encode("utf-8")
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
                (self.problem_id + "\0" + self.deployment_binding).encode("utf-8")
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
