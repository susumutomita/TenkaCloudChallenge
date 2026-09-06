"""Execute only submitted functions on supplied inputs; there is no checker or seed here."""
from __future__ import annotations

import collections
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


def initialization_error(error, filename):
    """Report only source locations; the receiver validates these untrusted fields."""
    line = None
    if isinstance(error, SyntaxError) and error.filename == filename:
        line = error.lineno
    else:
        tb = error.__traceback__
        while tb is not None:
            if tb.tb_frame.f_code.co_filename in ('aggregate.py',):
                filename, line = tb.tb_frame.f_code.co_filename, tb.tb_lineno
            tb = tb.tb_next
    return {'file': filename, 'line': line, 'type': type(error).__name__}


def int_list(value):
    return type(value) in (list, tuple) and all(type(item) is int for item in value)


def sharings(value):
    return type(value) in (list, tuple) and all(int_list(row) for row in value)


class RemoteOpening:
    """Only the parent owns the real observation log and computes opened values."""
    def __init__(self, call_id):
        self.call_id = call_id
        self.next_id = 0

    def open_batch(self, values):
        if not sharings(values):
            raise TypeError('opening requires integer lists')
        request_id = self.next_id
        self.next_id += 1
        print(json.dumps({'callId': self.call_id, 'openingId': request_id,
                          'opening': values}, separators=(',', ':')), flush=True)
        reply = json.loads(sys.stdin.readline())
        if reply.get('callId') != self.call_id or reply.get('openingId') != request_id or not int_list(reply.get('opened')):
            raise ValueError('invalid opening reply')
        return reply['opened']


def main():
    initial = json.loads(sys.stdin.readline())
    restrict_learner()
    modules = {name: types.ModuleType(name) for name in ('aggregate',)}
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
            args = call['args']
            if call.get('withOpening'):
                args.append(RemoteOpening(call['callId']))
            value = getattr(module, call['function'])(*args)
            # Lists and tuples are equivalent ordered sequences on this value channel.
            # This is no Python-type or function-execution attestation: the parent
            # checks canonical elements, lengths and mathematics after JSON decoding.
            if call['function'] == 'plan':
                valid = type(value) is dict and all(type(k) is str and type(v) is int for k,v in value.items())
            elif call['function'] == 'share_inputs':
                valid = sharings(value)
            else:
                valid = int_list(value)
            if not valid:
                raise TypeError('invalid return type')
            response = {'callId': call['callId'], 'value': value}
        except BaseException as error:
            # No exception text: a failed hidden call may mention its input values.
            response = {'callId': call['callId'], 'error': type(error).__name__}
        print(json.dumps(response, separators=(',', ':')), flush=True)


if __name__ == '__main__':
    main()
