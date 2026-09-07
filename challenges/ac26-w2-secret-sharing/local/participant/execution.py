"""Problem-local value boundary, adapted from ac26-bridge-properties.

A learner's stdout is never a verdict. The caller validates each JSON value using
trusted properties. No file, fixture seed, checker or expected result enters a worker.
"""
from __future__ import annotations

import json
import os
import resource
import secrets
import select
import signal
import subprocess
import sys
import tempfile
import time
from pathlib import Path

from participant.isolation import protect_supervisor

RUN_TIMEOUT_SECONDS = 12
# The exhaustive documented sharing properties return up to ~100k three-point values.
# The reader caps bytes while reading, before decoding a complete result frame.
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
        process = None
        pending = b''
        received = 0
        deadline = time.monotonic() + timeout

        def send(value):
            data = memoryview((json.dumps(value, separators=(',', ':')) + '\n').encode())
            while data:
                remaining = deadline-time.monotonic()
                if remaining <= 0: raise TimeoutError
                _, ready, _ = select.select([], [process.stdin.fileno()], [], remaining)
                if not ready: raise TimeoutError
                try: sent = os.write(process.stdin.fileno(), data)
                except BlockingIOError: continue
                if sent <= 0: raise EOFError
                data = data[sent:]

        def frame():
            nonlocal pending, received
            buffer = bytearray(pending)
            search_from = 0
            while True:
                newline = buffer.find(b'\n', search_from)
                if newline >= 0: break
                search_from = len(buffer)
                remaining = deadline-time.monotonic()
                if remaining <= 0: raise TimeoutError
                ready, _, _ = select.select([process.stdout.fileno()], [], [], remaining)
                if not ready: raise TimeoutError
                chunk = os.read(process.stdout.fileno(), 65536)
                if not chunk: raise EOFError
                received += len(chunk)
                if received > MAX_OUTPUT_BYTES: raise ValueError('output limit')
                buffer.extend(chunk)
            pending = bytes(buffer[newline+1:])
            try: return json.loads(bytes(buffer[:newline]))
            except (ValueError, RecursionError): return None

        try:
            process = subprocess.Popen(
                [sys.executable, '-I', str(Path(__file__).with_name('worker.py'))],
                stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                cwd=workspace, env={'PATH': '/usr/local/bin:/usr/bin:/bin',
                                    'PYTHONDONTWRITEBYTECODE': '1'},
                preexec_fn=_limits, start_new_session=True, close_fds=True, bufsize=0,
            )
            os.set_blocking(process.stdin.fileno(), False)
            os.set_blocking(process.stdout.fileno(), False)
            # Initialization receives neither calls nor a future batch identifier.
            send({'source': source})
            while True:
                value = frame()
                if isinstance(value, dict) and set(value) == {'ready'} and value['ready'] is True:
                    break
                if isinstance(value, dict) and isinstance(value.get('error'), dict):
                    return {'error': value['error']}
            batch_id = secrets.token_hex(16)
            # Keep the existing independent-call batch: ~100k line-privacy calls must
            # not become ~100k synchronous round trips under the 12-second limit.
            send({'batchId': batch_id, 'calls': calls})
            while True:
                value = frame()
                if not isinstance(value, dict) or value.get('batchId') != batch_id:
                    continue
                results = value.get('results')
                if (isinstance(results, list) and len(results) == len(calls)
                        and all(isinstance(result, dict) for result in results)):
                    return {'results': results}
        except (EOFError, OSError, ValueError, RecursionError, subprocess.SubprocessError):
            return None
        finally:
            if process is not None:
                try:
                    os.killpg(process.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
                process.wait()
                process.stdin.close()
                process.stdout.close()
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
