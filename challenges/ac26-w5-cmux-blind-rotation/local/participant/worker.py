"""Execute only submitted functions on supplied inputs; there is no checker or seed here."""
from __future__ import annotations

import copy
import collections
import decimal
import fractions
import functools
import hashlib
import hmac
import operator
import random
import statistics
import time
import itertools
import json
import math
import os
import sys
import types
import typing
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from isolation import restrict_learner
from protocol import encode, decode

# This completed vocabulary is the only problem library the submission imports.
# Load it before filesystem access is disabled; do not preload tests or fixtures.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import participant.ring


def initialization_error(error, filename):
    """Report only source locations; the receiver validates these untrusted fields."""
    line = None
    if isinstance(error, SyntaxError) and error.filename == filename:
        line = error.lineno
    else:
        tb = error.__traceback__
        while tb is not None:
            if tb.tb_frame.f_code.co_filename in ('cmux.py',):
                filename, line = tb.tb_frame.f_code.co_filename, tb.tb_lineno
            tb = tb.tb_next
    return {'file': filename, 'line': line, 'type': type(error).__name__}


class RemoteRows(tuple):
    """Tuple-compatible row access whose observations belong to the caller."""
    def __new__(cls, count, handle, operation):
        result = super().__new__(cls, [None] * count)
        result.handle, result.operation = handle, operation
        return result

    def __getitem__(self, index):
        wire_index = (index.start, index.stop, index.step) if isinstance(index, slice) else index
        return self.operation(method='row', handle=self.handle, index=encode(wire_index))

    def __iter__(self):
        for index in range(len(self)):
            yield self[index]



def main():
    initial = json.loads(sys.stdin.readline())
    restrict_learner()
    modules = {name: types.ModuleType(name) for name in ('cmux',)}
    sys.modules.update(modules)
    for name, module in modules.items():
        filename = name+'.py'
        try:
            exec(compile(initial['sources'][filename], filename, 'exec'), module.__dict__)
        except BaseException as error:
            print(json.dumps({'initializationError': initialization_error(error, filename)}), flush=True)
            return
    print('{"ready":true}', flush=True)
    for line in sys.stdin:
        call = json.loads(line)
        try:
            module = modules[call['module']]
            operation_id = 0
            def operation(**request):
                nonlocal operation_id
                print(json.dumps({'callId': call['callId'], 'operationId': operation_id, **request}), flush=True)
                reply = json.loads(sys.stdin.readline())
                if reply.get('callId') != call['callId'] or reply.get('operationId') != operation_id:
                    raise ValueError('mismatched observation reply')
                operation_id += 1
                if 'error' in reply:
                    raise IndexError('row index outside the input')
                return decode(reply['value'])
            args = [RemoteRows(frame[1][1], frame[1][0], operation) if frame[0] == 'rows'
                    else decode(frame) for frame in call['args']]
            saved = []
            for name in call.get('audit', []):
                saved.append((name, hasattr(module, name), getattr(module, name, None)))
                def tripwire(*args, _name=name, **kwargs):
                    return operation(method='helper', name=_name)
                setattr(module, name, tripwire)
            try:
                value = getattr(module, call['function'])(*args)
            finally:
                for name, existed, previous in reversed(saved):
                    if existed:
                        setattr(module, name, previous)
                    else:
                        delattr(module, name)
            # Preserve list/tuple and bool/int distinctions across the value boundary.
            # The trusted parent validates every returned value, never a verdict here.
            response = {'callId': call['callId'], 'value': encode(value)}
        except BaseException as error:
            # No exception text: a failed hidden call may mention its input values.
            response = {'callId': call['callId'], 'error': 'ValueError' if isinstance(error, ValueError) else type(error).__name__}
        print(json.dumps(response, separators=(',', ':'), allow_nan=False), flush=True)


if __name__ == '__main__':
    main()
