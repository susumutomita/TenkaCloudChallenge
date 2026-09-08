"""A bounded value channel to the learner process, never a channel for grading verdicts.

One process serves the whole suite. Fresh call IDs reject stale/preprinted replies, but do not attest function execution.
Only untrusted JSON function results cross this boundary;
the trusted parent owns the checker and the verdict.
"""
from __future__ import annotations

import json
import os
import re
import resource
import select
import secrets
import signal
import subprocess
import sys
import time
from pathlib import Path
from types import SimpleNamespace

from participant.protocol import encode, decode
from participant.isolation import protect_supervisor

class ProtocolError(Exception):
    pass

MAX_FRAME_BYTES = 64 * 1024
MAX_LOG_BYTES = 64 * 1024
RUN_TIMEOUT_SECONDS = 12


class LearnerError(Exception):
    pass


def _limits():
    resource.setrlimit(resource.RLIMIT_AS, (512 * 1024 * 1024, 512 * 1024 * 1024))
    resource.setrlimit(resource.RLIMIT_NPROC, (64, 64))
    resource.setrlimit(resource.RLIMIT_FSIZE, (MAX_LOG_BYTES, MAX_LOG_BYTES))
    resource.setrlimit(resource.RLIMIT_CPU, (20, 21))


class LearnerSession:
    def __init__(self, sources, *, separate_session=True, timeout=None):
        self.sources = sources
        self.separate_session = separate_session
        self.timeout = RUN_TIMEOUT_SECONDS if timeout is None else timeout
        self.process = None
        self.pending = b''
        self.log = ''
        self.sequence = None
        self.initialization_diagnostic = ''

    def __enter__(self):
        if sys.platform != 'linux':
            raise LearnerError('The deployed evaluator requires Linux isolation.')
        protect_supervisor()
        self.deadline = time.monotonic() + self.timeout
        self.process = subprocess.Popen(
            [sys.executable, '-I', str(Path(__file__).with_name('worker.py'))],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
            env={'PATH': '/usr/local/bin:/usr/bin:/bin', 'PYTHONDONTWRITEBYTECODE': '1'},
            preexec_fn=_limits, start_new_session=self.separate_session, bufsize=0, close_fds=True,
        )
        os.set_blocking(self.process.stdout.fileno(), False)
        os.set_blocking(self.process.stdin.fileno(), False)
        try:
            self._send({'sources': self.sources})
            while True:
                line = self._line()
                try:
                    value = json.loads(line)
                except (ValueError, RecursionError):
                    value = None
                if isinstance(value, dict):
                    if 'initializationError' in value:
                        self.initialization_diagnostic = self._initialization_diagnostic(value['initializationError'])
                        raise LearnerError('The submitted files could not be initialized.')
                    if value.get('ready') is True:
                        break
                self._log_line(line)
        except (OSError, ValueError, RecursionError, LearnerError):
            self.__exit__(None, None, None)
            raise LearnerError('Source could not start.') from None
        return self

    def _initialization_diagnostic(self, value):
        if not isinstance(value, dict):
            return ''
        filename, line, kind = value.get('file'), value.get('line'), value.get('type')
        if not isinstance(filename, str) or filename not in self.sources or type(line) is not int or not 1 <= line <= len(self.sources[filename].splitlines()) + 1:
            return ''
        if not isinstance(kind, str) or re.fullmatch(r'[A-Za-z_][A-Za-z_0-9]{0,79}', kind) is None:
            return ''
        return f'{filename}:{line}: {kind}'

    def _log_line(self, line):
        self.log += line+'\n'
        if len(self.log.encode()) > MAX_LOG_BYTES:
            raise LearnerError('Function output exceeded the limit.')

    def _send(self, payload):
        data = (json.dumps(payload)+'\n').encode()
        fd = self.process.stdin.fileno()
        while data:
            remaining = self.deadline-time.monotonic()
            if remaining <= 0:
                raise LearnerError('Function evaluation timed out.')
            _, ready, _ = select.select([], [fd], [], remaining)
            if not ready:
                raise LearnerError('Function evaluation timed out.')
            try:
                sent = os.write(fd, data)
            except BlockingIOError:
                continue
            if sent <= 0:
                raise LearnerError('The functions could not receive input.')
            data = data[sent:]

    def _line(self):
        while b'\n' not in self.pending:
            remaining = self.deadline - time.monotonic()
            if remaining <= 0:
                raise LearnerError('Function evaluation timed out.')
            fd = self.process.stdout.fileno()
            ready, _, _ = select.select([fd], [], [], remaining)
            if not ready:
                raise LearnerError('Function evaluation timed out.')
            chunk = os.read(fd, 4096)
            if not chunk:
                raise LearnerError('The functions did not return the required values.')
            self.pending += chunk
            if len(self.pending) > MAX_FRAME_BYTES:
                raise LearnerError('Function output exceeded the limit.')
        line, self.pending = self.pending.split(b'\n', 1)
        return line.decode(errors='replace')

    def call(self, module, function, args):
        if time.monotonic() >= self.deadline:
            raise LearnerError('Function evaluation timed out.')
        self.sequence = secrets.token_hex(16)
        request = {'callId': self.sequence, 'module': module, 'function': function,
                   'args': encode(args)}
        try:
            self._send(request)
        except (OSError, ValueError):
            raise LearnerError('The functions could not receive the next input.') from None
        while True:
            line = self._line()
            try:
                value = json.loads(line)
            except (ValueError, RecursionError):
                value = None
            if isinstance(value, dict) and value.get('callId') == self.sequence:
                if 'error' in value:
                    raise {'ValueError': ValueError, 'TypeError': TypeError, 'ProtocolError': ProtocolError}.get(value['error'], LearnerError)('The submitted function refused its input.')
                if 'value' in value:
                    return decode(value['value'])  # inert values; only the parent applies the rules
            self._log_line(line)

    def module(self):
        def function(name):
            return lambda *args: self.call('air', name, args)
        return SimpleNamespace(**{name: function(name) for name in ('execute', 'transition_residuals', 'boundary_residuals', 'interpolate', 'evaluate', 'column_polynomials', 'first_violation', 'underconstrained_witness')})

    def __exit__(self, *_args):
        if self.process is None:
            return
        try:
            if self.separate_session:
                os.killpg(self.process.pid, signal.SIGKILL)
            else:
                # In the private grader, the outer launcher owns this whole group
                # and removes descendants after grading returns or times out.
                self.process.kill()
        except ProcessLookupError:
            pass
        self.process.wait()
        self.process.stdin.close()
        self.process.stdout.close()
