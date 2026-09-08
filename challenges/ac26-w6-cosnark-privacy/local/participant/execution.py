"""A bounded value channel to the learner process, never a channel for grading verdicts.

One process serves the whole suite. Fresh call IDs reject stale/preprinted replies, but do not attest function execution.
Untrusted JSON function results and MPC operation requests cross this boundary;
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
import types
from pathlib import Path
from types import SimpleNamespace

from participant.protocol import Codec
from participant.mpc import AuditRuntime, Sink, CrossPartyRead, TripleMisuse
from participant.isolation import protect_supervisor

MAX_FRAME_BYTES = 64 * 1024
MAX_LOG_BYTES = 64 * 1024
RUN_TIMEOUT_SECONDS = 12


class LearnerError(Exception):
    pass


def _limits():
    resource.setrlimit(resource.RLIMIT_AS, (512 * 1024 * 1024, 512 * 1024 * 1024))
    resource.setrlimit(resource.RLIMIT_NPROC, (64, 64))
    resource.setrlimit(resource.RLIMIT_FSIZE, (MAX_LOG_BYTES, MAX_LOG_BYTES))
    resource.setrlimit(resource.RLIMIT_CPU, (25, 26))


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
        self.codec = Codec(parent=True)

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

    def call(self, function, args):
        if time.monotonic() >= self.deadline:
            raise LearnerError('Function evaluation timed out.')
        # Opaque handles are capabilities for this invocation only. A prior audit
        # may expose reconstruct; it must not remain usable on a later task's shares.
        # Actual Runtime objects/consumption records remain owned by the checker.
        self.codec = Codec(parent=True)
        self.sequence = secrets.token_hex(16)
        next_operation, operation_bytes = 0, 0
        scopes = []
        self._send({'callId': self.sequence, 'function': function,
                    'args': self.codec.encode(args)})
        try:
            while True:
                line = self._line()
                try:
                    value = json.loads(line)
                except (ValueError, RecursionError):
                    value = None
                if isinstance(value, dict) and value.get('callId') == self.sequence:
                    if 'runtime' in value:
                        token = value['runtime']
                        runtime = self.codec.objects.get(token) if isinstance(token, str) else None
                        if (not isinstance(runtime, (AuditRuntime, Sink, types.FunctionType))
                                or type(value.get('operationId')) is not int
                                or value['operationId'] != next_operation):
                            raise LearnerError('Malformed MPC operation.')
                        operation_bytes += len(line.encode())
                        if operation_bytes > MAX_LOG_BYTES:
                            raise LearnerError('MPC operations exceeded the limit.')
                        method = value.get('method')
                        allowed = ('value_of', 'add', 'sub', 'mul_public', 'add_public', 'zero',
                                   'open', 'reserve_triple', 'events', 'openings', 'violations',
                                   'consumed_triples', 'ancestry', 'issued')
                        if isinstance(runtime, Sink):
                            allowed = ('publish', 'emit', 'metric', 'fail', 'disclosure')
                        elif isinstance(runtime, types.FunctionType):
                            allowed = ('__call__',)
                        else:
                            allowed += ('peek', 'reached')
                        if hasattr(runtime, 'reconstruct'):
                            allowed += ('reconstruct',)
                        arguments, keywords = self.codec.decode(value.get('args')), self.codec.decode(value.get('kwargs'))
                        if not isinstance(arguments, (list, tuple)) or not isinstance(keywords, dict):
                            raise LearnerError('Malformed MPC arguments.')
                        reply = {'callId': self.sequence, 'operationId': next_operation}
                        try:
                            if method == 'scope-enter' and isinstance(runtime, AuditRuntime):
                                if len(scopes) >= 64:
                                    raise ValueError('Scope nesting limit.')
                                scope = runtime.party_scope(*arguments, **keywords)
                                result = scope.__enter__()
                                scopes.append((token, scope))
                            elif method == 'scope-exit':
                                if arguments or keywords or not scopes or scopes[-1][0] != token:
                                    raise ValueError('Unbalanced scope.')
                                result = scopes.pop()[1].__exit__(None, None, None)
                            elif method in allowed:
                                result = getattr(runtime, method)(*arguments, **keywords)
                            else:
                                raise ValueError('Unknown MPC operation.')
                            reply['value'] = self.codec.encode(result)
                        except (ValueError, TypeError, KeyError, CrossPartyRead, TripleMisuse) as error:
                            reply['error'] = type(error).__name__
                        self._send(reply)
                        next_operation += 1
                        continue
                    if 'error' in value:
                        errors = {'ValueError': ValueError, 'TypeError': TypeError,
                                  'CrossPartyRead': CrossPartyRead, 'TripleMisuse': TripleMisuse, 'KeyError': KeyError}
                        raise errors.get(value['error'], LearnerError)('The submitted function refused its input.')
                    if 'value' in value:
                        return self.codec.decode(value['value'])
                self._log_line(line)
        finally:
            while scopes:
                scopes.pop()[1].__exit__(None, None, None)

    def module(self):
        return SimpleNamespace(**{name: (lambda *args, _name=name: self.call(_name, args)) for name in ('classify', 'capability_audit', 'open_set_audit', 'cross_party_audit', 'leakage_audit', 'leakage_evidence', 'private_prover')})

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
