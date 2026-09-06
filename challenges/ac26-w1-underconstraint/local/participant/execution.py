"""Exchange untrusted function values; authoritative checking stays in the caller.

A call identifier is minted only after a ready acknowledgement. It rejects queued
startup output and replies for earlier calls; it does not attest to how arbitrary
learner Python produced a value. The trusted checker must still validate every value.
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

RUN_TIMEOUT_SECONDS = 15
MAX_OUTPUT_BYTES = 64 * 1024
MAX_ADDRESS_SPACE_BYTES = 512 * 1024 * 1024
MAX_PROCESSES = 64


def _limits():
    resource.setrlimit(resource.RLIMIT_AS, (MAX_ADDRESS_SPACE_BYTES, MAX_ADDRESS_SPACE_BYTES))
    resource.setrlimit(resource.RLIMIT_NPROC, (MAX_PROCESSES, MAX_PROCESSES))
    resource.setrlimit(resource.RLIMIT_FSIZE, (MAX_OUTPUT_BYTES, MAX_OUTPUT_BYTES))
    resource.setrlimit(resource.RLIMIT_CPU, (5, 6))


class _OutputLimit(Exception):
    pass


def run_functions(sources, calls):
    # Do not silently substitute a weaker host execution path for the Linux runtime.
    if sys.platform != 'linux':
        return None
    with tempfile.TemporaryDirectory() as workspace:
        process = None
        output = []
        pending = b''
        received_bytes = 0
        deadline = time.monotonic() + RUN_TIMEOUT_SECONDS

        def send(value):
            data = (json.dumps(value, separators=(',', ':')) + '\n').encode()
            fd = process.stdin.fileno()
            while data:
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    raise TimeoutError
                _, ready, _ = select.select([], [fd], [], remaining)
                if not ready:
                    raise TimeoutError
                try:
                    size = os.write(fd, data)
                except BlockingIOError:
                    continue
                if size <= 0:
                    raise EOFError
                data = data[size:]

        def frame():
            nonlocal pending, received_bytes
            while b'\n' not in pending:
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    raise TimeoutError
                ready, _, _ = select.select([process.stdout.fileno()], [], [], remaining)
                if not ready:
                    raise TimeoutError
                chunk = os.read(process.stdout.fileno(), 4096)
                if not chunk:
                    if pending:
                        output.append(pending.decode(errors='replace'))
                    raise EOFError
                received_bytes += len(chunk)
                if received_bytes > MAX_OUTPUT_BYTES:
                    raise _OutputLimit
                pending += chunk
            line, pending = pending.split(b'\n', 1)
            text = line.decode(errors='replace')
            try:
                value = json.loads(text)
            except (ValueError, RecursionError):
                value = None
            return value, text

        try:
            process = subprocess.Popen(
                [sys.executable, '-I', str(Path(__file__).with_name('worker.py'))],
                stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                cwd=workspace, env={'PATH': '/usr/local/bin:/usr/bin:/bin',
                                    'PYTHONDONTWRITEBYTECODE': '1'},
                preexec_fn=_limits, start_new_session=True, close_fds=True, bufsize=0,
            )
            os.set_blocking(process.stdin.fileno(), False)
            os.set_blocking(process.stdout.fileno(), False)
            # Do not give source initialization future call IDs or a batch of inputs.
            send({'sources': sources})
            while True:
                value, text = frame()
                if isinstance(value, dict) and set(value) == {'ready'} and value['ready'] is True:
                    break
                output.append(text)
            values = []
            for call in calls:
                # A fresh 128-bit identifier, not a predictable sequence number.
                call_id = secrets.token_hex(16)
                send({'callId': call_id, 'function': call['function'], 'args': call['args']})
                while True:
                    value, text = frame()
                    if (isinstance(value, dict) and set(value) == {'callId', 'result'}
                            and value['callId'] == call_id):
                        result = value['result']
                        if isinstance(result, dict) and set(result) in ({'returned'}, {'raised'}):
                            values.append(result)
                            break
                    output.append(text)
            return {'values': values, 'output': '\n'.join(output)}
        except EOFError:
            # Source diagnostics/logs are available only to the public-test caller;
            # the hidden verifier never includes this channel in grading feedback.
            return {'values': None, 'output': '\n'.join(output)}
        except (OSError, ValueError, RecursionError, _OutputLimit, subprocess.SubprocessError):
            return None
        finally:
            if process is not None:
                # Completion, early EOF and timeout all clean the complete session.
                # seccomp prevents descendants escaping this process group.
                try:
                    os.killpg(process.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
                process.wait()
                process.stdin.close()
                process.stdout.close()
