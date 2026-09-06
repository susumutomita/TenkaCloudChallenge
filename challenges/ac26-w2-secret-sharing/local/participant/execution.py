"""Problem-local value boundary, adapted from ac26-bridge-properties.

A learner's stdout is never a verdict. The caller validates each JSON value using
trusted properties. No file, fixture seed, checker or expected result enters a worker.
"""
from __future__ import annotations

import json
import os
import resource
import signal
import subprocess
import sys
import tempfile
from pathlib import Path

from participant.isolation import protect_supervisor

RUN_TIMEOUT_SECONDS = 12
# The exhaustive documented sharing properties return up to ~100k three-point values.
# File-backed output keeps both a flood and a valid batch bounded (not an unbounded pipe).
MAX_OUTPUT_BYTES = 16 * 1024 * 1024
MAX_ADDRESS_SPACE_BYTES = 512 * 1024 * 1024
MAX_PROCESSES = 64


def _limits():
    resource.setrlimit(resource.RLIMIT_AS, (MAX_ADDRESS_SPACE_BYTES, MAX_ADDRESS_SPACE_BYTES))
    resource.setrlimit(resource.RLIMIT_NPROC, (MAX_PROCESSES, MAX_PROCESSES))
    resource.setrlimit(resource.RLIMIT_FSIZE, (MAX_OUTPUT_BYTES, MAX_OUTPUT_BYTES))
    resource.setrlimit(resource.RLIMIT_CPU, (12, 13))


def run_functions(source, calls, timeout=RUN_TIMEOUT_SECONDS):
    if sys.platform != 'linux':
        return None  # Never silently run a weaker learner on the host.
    protect_supervisor()
    with tempfile.TemporaryDirectory() as workspace:
        output = Path(workspace) / 'stdout'
        process = None
        try:
            with output.open('w') as sink:
                process = subprocess.Popen(
                    [sys.executable, '-I', str(Path(__file__).with_name('worker.py'))],
                    stdin=subprocess.PIPE, stdout=sink, stderr=subprocess.DEVNULL,
                    cwd=workspace, env={'PATH': '/usr/local/bin:/usr/bin:/bin',
                                        'PYTHONDONTWRITEBYTECODE': '1'},
                    preexec_fn=_limits, start_new_session=True, close_fds=True,
                )
                process.communicate(json.dumps({'source': source, 'calls': calls}).encode(),
                                    timeout=timeout)
            if process.returncode != 0:
                return None
            captured = output.read_bytes()
            for line in reversed(captured.splitlines()):
                try:
                    decoded = json.loads(line)
                except (ValueError, TypeError):
                    continue
                if not isinstance(decoded, dict):
                    continue
                results = decoded.get('results')
                if (isinstance(results, list) and len(results) == len(calls)
                        and all(isinstance(result, dict) for result in results)):
                    return {'results': results}
                if isinstance(decoded.get('error'), dict):
                    return {'error': decoded['error']}
            return None
        except (OSError, ValueError, subprocess.SubprocessError):
            return None
        finally:
            if process is not None:
                try:
                    os.killpg(process.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
                process.wait()
                # Compose init:true reaps orphaned descendants, including success paths.


def public_diagnostic(result):
    """Location-only public feedback; never interpolate exception values or stdout."""
    error = result.get('error') if isinstance(result, dict) else None
    if not isinstance(error, dict):
        return 'sharing.py: execution failed or exceeded the limit'
    allowed = {'SyntaxError', 'IndentationError', 'TabError', 'NameError', 'ImportError',
               'ModuleNotFoundError', 'TypeError', 'ValueError', 'ZeroDivisionError',
               'RuntimeError', 'AttributeError', 'PermissionError', 'Exception'}
    kind = error.get('type')
    kind = kind if isinstance(kind, str) and kind in allowed else 'Exception'
    line = error.get('line')
    location = f':{line}' if type(line) is int and 1 <= line <= 100000 else ''
    return f'sharing.py{location}: {kind}'
