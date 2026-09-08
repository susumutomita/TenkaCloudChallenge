"""Execute only submitted functions on supplied inputs; there is no checker or seed here."""
from __future__ import annotations

import base64
import binascii
import struct
import base64
import binascii
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
# No problem helpers are needed.


def initialization_error(error, filename):
    """Report only source locations; the receiver validates these untrusted fields."""
    line = None
    if isinstance(error, SyntaxError) and error.filename == filename:
        line = error.lineno
    else:
        tb = error.__traceback__
        while tb is not None:
            if tb.tb_frame.f_code.co_filename in ('schnorr.py',):
                filename, line = tb.tb_frame.f_code.co_filename, tb.tb_lineno
            tb = tb.tb_next
    return {'file': filename, 'line': line, 'type': type(error).__name__}


def main():
    initial = json.loads(sys.stdin.readline())
    restrict_learner()
    modules = {name: types.ModuleType(name) for name in ('schnorr',)}
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
            args = decode(call['args'])
            value = getattr(module, call['function'])(*args)
            # Preserve list/tuple and bool/int distinctions across the value boundary.
            # The trusted parent validates every returned value, never a verdict here.
            response = {'callId': call['callId'], 'value': encode(value)}
        except BaseException as error:
            # No exception text: a failed hidden call may mention its input values.
            kind = next((name for name in ('InvalidKey', 'InvalidEncoding')
                         if isinstance(getattr(module, name, None), type) and isinstance(error, getattr(module, name))), type(error).__name__)
            response = {'callId': call['callId'], 'error': kind}
        print(json.dumps(response, separators=(',', ':'), allow_nan=False), flush=True)


if __name__ == '__main__':
    main()
