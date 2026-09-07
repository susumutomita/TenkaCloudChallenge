"""A bounded value channel to the learner process, never a channel for grading verdicts.

One process serves the whole suite. Fresh call IDs reject preprinted replies, but
do not attest native Python returns. All JSON values remain untrusted; the parent
owns the mathematical checks and the verdict.
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

MAX_FRAME_BYTES = 64 * 1024
MAX_LOG_BYTES = 64 * 1024
RUN_TIMEOUT_SECONDS = 30


class LearnerError(Exception):
    pass


def _limits():
    resource.setrlimit(resource.RLIMIT_AS, (512 * 1024 * 1024, 512 * 1024 * 1024))
    resource.setrlimit(resource.RLIMIT_NPROC, (64, 64))
    resource.setrlimit(resource.RLIMIT_FSIZE, (MAX_LOG_BYTES, MAX_LOG_BYTES))
    resource.setrlimit(resource.RLIMIT_CPU, (30, 31))


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
        except (OSError, ValueError, LearnerError):
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

    def call(self, module, function, args, modulus=None, *, expected_error=None):
        if time.monotonic() >= self.deadline:
            raise LearnerError('Function evaluation timed out.')
        self.sequence = secrets.token_hex(16)
        request = {'callId': self.sequence, 'module': module, 'function': function,
                   'args': args, 'modulus': modulus}
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
                    error_types = {'NotOnCurve': NotOnCurve, 'CurveMismatch': CurveMismatch}
                    kinds = value.get('errorKinds')
                    if (isinstance(kinds, list)
                            and all(type(kind) is str and kind in error_types for kind in kinds)
                            and expected_error in error_types and expected_error in kinds):
                        raise error_types[expected_error]('The submitted operation raised its required error.')
                    raise LearnerError('The submitted operation raised an inappropriate error.')
                if 'value' in value:
                    return value['value']  # untrusted JSON data, checked by the caller
            self._log_line(line)

    def module(self):
        return CurveModule(self)

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


class NotOnCurve(LearnerError):
    pass


class CurveMismatch(LearnerError):
    pass


def _params(value):
    return isinstance(value, (list, tuple)) and len(value) == 3 and all(type(n) is int for n in value)


def _on_curve(params, x, y):
    if x is None or y is None:
        return x is None and y is None
    p, a, b = params
    return type(x) is int and type(y) is int and (y*y-x*x*x-a*x-b) % p == 0


class CurveModule:
    """Expose submitted objects as untrusted data, never as grading code.

    The parent retains curve identities and checks scalar/coordinate data types.
    Private group-law checks remain outside the participant image. Handles and
    exception labels do not attest native Python object or exception provenance.
    """
    NotOnCurve = NotOnCurve
    CurveMismatch = CurveMismatch

    def __init__(self, session):
        self.session = session
        self.Point = RemotePoint

    def Curve(self, p, a, b):
        return RemoteCurve(self.session, p, a, b)

    def double_and_add_trace(self, point, scalar):
        return self.session.call('curve', 'trace', [point.handle, scalar])


class RemoteCurve:
    def __init__(self, session, p, a, b):
        self.session, self.p, self.a, self.b = session, p, a, b
        self.params = (p, a, b)
        result = session.call('curve', 'Curve', [p, a, b])
        if not isinstance(result, dict) or type(result.get('id')) is not int or not _params(result.get('params')) or tuple(result['params']) != self.params:
            raise LearnerError('A curve did not preserve its integer parameters.')
        self.handle = result['id']

    def contains(self, point):
        x, y, _ = point._snapshot()
        expected = _on_curve(self.params, x, y)
        result = self.session.call('curve', 'contains', [self.handle, point.handle])
        if type(result) is not bool or result != expected:
            raise LearnerError('Membership did not follow the curve equation.')
        return result

    def point(self, x, y):
        expected = (x % self.p, y % self.p)
        error = None if _on_curve(self.params, *expected) else 'NotOnCurve'
        result = self.session.call('curve', 'point', [self.handle, x, y], expected_error=error)
        if error:
            raise LearnerError('Off-curve coordinates were accepted.')
        point = RemotePoint.from_result(self, result)
        if point._snapshot()[:2] != expected:
            raise LearnerError('Point construction changed its coordinates.')
        return point

    def infinity(self):
        result = self.session.call('curve', 'infinity', [self.handle])
        point = RemotePoint.from_result(self, result)
        if point._snapshot() != (None, None, True):
            raise LearnerError('The identity must use two None coordinates.')
        return point


class RemotePoint:
    def __init__(self, curve, x, y):
        result = curve.session.call('curve', 'Point', [curve.handle, x, y])
        self._initialize(curve, result)
        if self._snapshot()[:2] != (x, y):
            raise LearnerError('The Point constructor changed the requested coordinates.')

    @classmethod
    def from_result(cls, curve, result):
        point = object.__new__(cls)
        point._initialize(curve, result)
        return point

    def _initialize(self, curve, result):
        self.curve, self.session = curve, curve.session
        if not isinstance(result, dict) or type(result.get('id')) is not int:
            raise LearnerError('An operation did not return point data.')
        self.handle = result['id']
        self._validate(result)

    def _validate(self, result):
        if not isinstance(result, dict) or type(result.get('id')) is not int or result['id'] != self.handle or not _params(result.get('params')) or tuple(result['params']) != self.curve.params:
            raise LearnerError('A point changed its curve or handle.')
        x, y, infinity = result.get('x'), result.get('y'), result.get('isInfinity')
        if type(infinity) is not bool:
            raise LearnerError('is_infinity must be a boolean.')
        if x is None or y is None:
            if not (x is None and y is None and infinity):
                raise LearnerError('Only the identity may have None coordinates.')
        elif type(x) is not int or type(y) is not int or not (0 <= x < self.curve.p and 0 <= y < self.curve.p) or infinity:
            raise LearnerError('Point coordinates must be canonical integers.')
        return x, y, infinity

    def _snapshot(self):
        return self._validate(self.session.call('curve', 'describe', [self.handle]))

    @property
    def x(self):
        return self._snapshot()[0]

    @property
    def y(self):
        return self._snapshot()[1]

    @property
    def is_infinity(self):
        return self._snapshot()[2]

    def __eq__(self, other):
        if not isinstance(other, RemotePoint):
            return False
        expected = self.curve.params == other.curve.params and self._snapshot() == other._snapshot()
        result = self.session.call('curve', 'eq', [self.handle, other.handle])
        if type(result) is not bool or result != expected:
            raise LearnerError('Point equality did not match the curve and coordinates.')
        return result

    def __hash__(self):
        value = self.session.call('curve', 'hash', [self.handle])
        if type(value) is not int:
            raise LearnerError('Point hash must be an integer.')
        return value

    def __add__(self, other):
        error = 'CurveMismatch' if self.curve.params != other.curve.params else None
        result = self.session.call('curve', 'add', [self.handle, other.handle], expected_error=error)
        if error:
            raise LearnerError('Points from different curves were combined.')
        return RemotePoint.from_result(self.curve, result)

    def __neg__(self):
        return RemotePoint.from_result(self.curve, self.session.call('curve', 'neg', [self.handle]))

    def scalar_mul(self, scalar):
        return RemotePoint.from_result(self.curve, self.session.call('curve', 'scalar', [self.handle, scalar]))

    def __mul__(self, scalar):
        return RemotePoint.from_result(self.curve, self.session.call('curve', 'mul', [self.handle, scalar]))

    def __rmul__(self, scalar):
        return RemotePoint.from_result(self.curve, self.session.call('curve', 'rmul', [self.handle, scalar]))
