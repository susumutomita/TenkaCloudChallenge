"""Run untrusted source; return untrusted values. Authoritative checking stays in the caller."""
from __future__ import annotations

import json
import math
import os
import resource
import signal
import subprocess
import sys
import tempfile
from pathlib import Path

RUN_TIMEOUT_SECONDS = 15
MAX_OUTPUT_BYTES = 64 * 1024
MAX_ADDRESS_SPACE_BYTES = 512 * 1024 * 1024
MAX_PROCESSES = 64


def _limits():
    resource.setrlimit(resource.RLIMIT_AS, (MAX_ADDRESS_SPACE_BYTES, MAX_ADDRESS_SPACE_BYTES))
    resource.setrlimit(resource.RLIMIT_NPROC, (MAX_PROCESSES, MAX_PROCESSES))
    resource.setrlimit(resource.RLIMIT_FSIZE, (MAX_OUTPUT_BYTES, MAX_OUTPUT_BYTES))
    cpu_seconds = max(1, math.ceil(RUN_TIMEOUT_SECONDS))
    resource.setrlimit(resource.RLIMIT_CPU, (cpu_seconds, cpu_seconds + 1))


def run_functions(sources, calls):
    # Do not silently substitute a weaker host execution path for the Linux runtime.
    if sys.platform != 'linux':
        return None
    with tempfile.TemporaryDirectory() as workspace:
        output = Path(workspace) / 'stdout'
        process = None
        try:
            with output.open('w') as sink:
                process = subprocess.Popen(
                    [sys.executable, '-I', str(Path(__file__).with_name('worker.py'))],
                    stdin=subprocess.PIPE, stdout=sink, stderr=subprocess.STDOUT,
                    cwd=workspace, env={'PATH': '/usr/local/bin:/usr/bin:/bin',
                                        'PYTHONDONTWRITEBYTECODE': '1'},
                    preexec_fn=_limits, start_new_session=True,
                )
                process.communicate(json.dumps({'sources': sources, 'calls': calls}).encode(),
                                    timeout=RUN_TIMEOUT_SECONDS)
            captured = output.read_text(errors='replace')[-MAX_OUTPUT_BYTES:]
            if process.returncode != 0:
                return {'values': None, 'output': captured}
            for line in reversed(captured.splitlines()):
                try:
                    decoded = json.loads(line)
                except (ValueError, TypeError):
                    continue
                if (isinstance(decoded, dict) and isinstance(decoded.get('values'), list)
                        and len(decoded['values']) == len(calls)):
                    return {'values': decoded['values'], 'output': captured}
            return {'values': None, 'output': captured}
        except (OSError, ValueError, subprocess.SubprocessError):
            return None
        finally:
            if process is not None:
                # A learner may fork and return early; completion and timeout both
                # clean the entire session. seccomp blocks escaping the process group.
                try:
                    os.killpg(process.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
                process.wait()
