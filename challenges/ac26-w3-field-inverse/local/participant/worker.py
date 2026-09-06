"""Execute only submitted functions on supplied inputs; there is no checker or seed here."""
from __future__ import annotations

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


def initialization_error(error, filename):
    """Report only source locations; the receiver validates these untrusted fields."""
    line = None
    if isinstance(error, SyntaxError) and error.filename == filename:
        line = error.lineno
    else:
        tb = error.__traceback__
        while tb is not None:
            if tb.tb_frame.f_code.co_filename in ('field.py',):
                filename, line = tb.tb_frame.f_code.co_filename, tb.tb_lineno
            tb = tb.tb_next
    return {'file': filename, 'line': line, 'type': type(error).__name__}


def main():
    initial = json.loads(sys.stdin.readline())
    restrict_learner()
    modules = {name: types.ModuleType(name) for name in ('field',)}
    sys.modules.update(modules)
    for name, module in modules.items():
        filename = name+'.py'
        try:
            exec(compile(initial['sources'][filename], filename, 'exec'), module.__dict__)
        except BaseException as error:
            print(json.dumps({'initializationError': initialization_error(error, filename)}), flush=True)
            return
    print('{"ready":true}', flush=True)
    objects = {}
    next_handle = 0

    def save(value, kind):
        nonlocal next_handle
        next_handle += 1
        objects[next_handle] = value
        if kind == 'field':
            return {'id': next_handle, 'modulus': value.modulus}
        return {'id': next_handle, 'modulus': value.field.modulus, 'value': value.value}

    for line in sys.stdin:
        call = json.loads(line)
        try:
            module = modules['field']
            name, args = call['function'], call['args']
            if name == 'Field':
                value = save(module.Field(*args), 'field')
            elif name == 'element':
                value = save(objects[args[0]].element(args[1]), 'element')
            elif name in ('add', 'sub', 'mul', 'div', 'eq'):
                x, y = objects[args[0]], objects[args[1]]
                if name == 'add': value = x + y
                elif name == 'sub': value = x - y
                elif name == 'mul': value = x * y
                elif name == 'div': value = x / y
                else: value = x == y
                if name != 'eq': value = save(value, 'element')
            elif name == 'inverse':
                value = save(objects[args[0]].inverse(), 'element')
            elif name == 'hash':
                value = hash(objects[args[0]])
            elif name in ('egcd', 'egcd_trace', 'non_invertible_element'):
                value = getattr(module, name)(*args)
            else:
                raise ValueError('Unknown operation')
            response = {'callId': call['callId'], 'value': value}
        except BaseException as error:
            # Report only the type. The parent checks whether that exception is
            # appropriate for the mathematical operation and actual operands.
            kind = type(error).__name__
            for declared in ('NotInvertible', 'FieldMismatch'):
                exception_type = getattr(module, declared, None)
                if isinstance(exception_type, type) and isinstance(error, exception_type):
                    kind = declared
                    break
            response = {'callId': call['callId'], 'error': kind}
        print(json.dumps(response, separators=(',', ':')), flush=True)


if __name__ == '__main__':
    main()
