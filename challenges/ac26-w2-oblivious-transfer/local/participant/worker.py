"""Execute only submitted functions on supplied inputs; there is no checker or seed here."""
from __future__ import annotations

import collections
import decimal
import fractions
import functools
import hashlib
import hmac
import itertools
import json
import math
import operator
import os
import random
import statistics
import time
import sys
import types
import typing
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from isolation import restrict_learner
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import participant.ot  # public key derivation, loaded before filesystem isolation


def initialization_error(error, filename):
    """Report only source locations; the receiver validates these untrusted fields."""
    line = None
    if isinstance(error, SyntaxError) and error.filename == filename:
        line = error.lineno
    else:
        tb = error.__traceback__
        while tb is not None:
            if tb.tb_frame.f_code.co_filename in ('oblivious.py',):
                filename, line = tb.tb_frame.f_code.co_filename, tb.tb_lineno
            tb = tb.tb_next
    return {'file': filename, 'line': line, 'type': type(error).__name__}


def main():
    initial = json.loads(sys.stdin.readline())
    restrict_learner()
    modules = {name: types.ModuleType(name) for name in ('oblivious',)}
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
            value = getattr(module, call['function'])(*args)
            # Python list/tuple pairs both serialize to JSON arrays. They carry
            # values, never a verdict; the parent checks shape, types and mathematics.
            response = {'callId': call['callId'], 'value': value}
        except BaseException as error:
            # No exception text: a failed hidden call may mention its input values.
            response = {'callId': call['callId'], 'error': type(error).__name__}
        print(json.dumps(response, separators=(',', ':')), flush=True)


if __name__ == '__main__':
    main()
