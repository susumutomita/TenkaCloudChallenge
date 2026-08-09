"""Small fail-closed Python submission sandbox used by Portal and verifier."""

from __future__ import annotations

import os
import resource
import subprocess
import sys
import tempfile
from pathlib import Path

MAX_SOURCE_BYTES = 256 * 1024
MAX_OUTPUT_BYTES = 64 * 1024
MAX_ADDRESS_SPACE_BYTES = 512 * 1024 * 1024
MAX_PROCESSES = 64
RUN_TIMEOUT_SECONDS = 10
_ADDRESS_SPACE_CAPPABLE = sys.platform.startswith("linux")


def _limits() -> None:
    if _ADDRESS_SPACE_CAPPABLE:
        resource.setrlimit(resource.RLIMIT_AS, (MAX_ADDRESS_SPACE_BYTES, MAX_ADDRESS_SPACE_BYTES))
    resource.setrlimit(resource.RLIMIT_NPROC, (MAX_PROCESSES, MAX_PROCESSES))
    resource.setrlimit(resource.RLIMIT_FSIZE, (MAX_OUTPUT_BYTES, MAX_OUTPUT_BYTES))


def normalize_source(files: object) -> str | None:
    if not isinstance(files, dict):
        return None
    source = files.get("collector.py")
    if not isinstance(source, str) or not source.strip():
        return None
    if len(source.encode()) > MAX_SOURCE_BYTES:
        return None
    return source


def run_source(source: str, command: list[str], seed: str) -> tuple[int, str] | None:
    """Run one source file in a fresh directory with no shell interpolation."""
    with tempfile.TemporaryDirectory() as workspace:
        root = Path(workspace)
        (root / "collector.py").write_text(source, encoding="utf-8")
        transcript = root / "stdout"
        expanded = [part.replace("{workspace}", workspace) for part in command]
        try:
            with transcript.open("w", encoding="utf-8") as sink:
                completed = subprocess.run(  # noqa: S603 - fixed argv, shell=False
                    expanded,
                    cwd=workspace,
                    env={
                        "PATH": "/usr/local/bin:/usr/bin:/bin",
                        "FLAG_SEED": seed,
                        "SUBMISSION_DIR": workspace,
                    },
                    stdout=sink,
                    stderr=subprocess.STDOUT,
                    text=True,
                    timeout=RUN_TIMEOUT_SECONDS,
                    preexec_fn=_limits,
                    check=False,
                )
            output = transcript.read_text(encoding="utf-8", errors="replace")
        except (OSError, subprocess.TimeoutExpired, ValueError):
            return None
    return completed.returncode, output[-MAX_OUTPUT_BYTES:]
