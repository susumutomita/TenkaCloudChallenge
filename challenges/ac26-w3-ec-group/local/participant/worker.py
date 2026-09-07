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
            if tb.tb_frame.f_code.co_filename in ('curve.py',):
                filename, line = tb.tb_frame.f_code.co_filename, tb.tb_lineno
            tb = tb.tb_next
    return {'file': filename, 'line': line, 'type': type(error).__name__}


import _native_driver

objects = {}
next_handle = 0
active_module = None

def describe(value, kind, handle):
    if kind == 'curve':
        return {'id': handle, 'params': value.params}
    return {'id': handle, 'params': value.curve.params,
            'x': value.x, 'y': value.y, 'isInfinity': value.is_infinity}

def save(value, kind):
    global next_handle
    next_handle += 1
    objects[next_handle] = value
    return describe(value, kind, next_handle)


def bootstrap(initial):
    global active_module
    restrict_learner()
    active_module = types.ModuleType('curve')
    sys.modules['curve'] = active_module
    exec(compile(initial["sources"]['curve.py'], 'curve.py', "exec"), active_module.__dict__)
    return active_module


def dispatch(call):
    module = active_module
    name, args = call['function'], call['args']
    if name == 'Curve':
        value = save(module.Curve(*args), 'curve')
    elif name == 'Point':
        value = save(module.Point(objects[args[0]], *args[1:]), 'point')
    elif name == 'point':
        value = save(objects[args[0]].point(*args[1:]), 'point')
    elif name == 'infinity':
        value = save(objects[args[0]].infinity(), 'point')
    elif name == 'describe':
        value = describe(objects[args[0]], 'point', args[0])
    elif name == 'contains':
        value = objects[args[0]].contains(objects[args[1]])
    elif name == 'add':
        value = save(objects[args[0]] + objects[args[1]], 'point')
    elif name == 'neg':
        value = save(-objects[args[0]], 'point')
    elif name in ('scalar', 'mul', 'rmul'):
        point, scalar = objects[args[0]], args[1]
        result = point.scalar_mul(scalar) if name == 'scalar' else point * scalar if name == 'mul' else scalar * point
        value = save(result, 'point')
    elif name == 'eq':
        value = objects[args[0]] == objects[args[1]]
    elif name == 'hash':
        value = hash(objects[args[0]])
    elif name == 'trace':
        value = module.double_and_add_trace(objects[args[0]], args[1])
    else:
        raise ValueError('Unknown operation')
    return value


if __name__ == "__main__":
    _native_driver.run(bootstrap, dispatch, initialization_error, 'curve.py', ('NotOnCurve', 'CurveMismatch'))
