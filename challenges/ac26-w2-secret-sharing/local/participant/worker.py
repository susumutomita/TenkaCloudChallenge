"""Untrusted sharing functions. Receives only source and call arguments, never a verdict."""
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


def diagnostic(error):
    # Values/messages/source lines are untrusted and may contain private call inputs.
    # Only an allowlisted type and a location in the user's own file may be returned.
    kind = type(error).__name__
    if kind not in ('SyntaxError', 'IndentationError', 'TabError', 'NameError',
                    'ImportError', 'ModuleNotFoundError', 'TypeError', 'ValueError',
                    'ZeroDivisionError', 'RuntimeError', 'AttributeError', 'PermissionError'):
        kind = 'Exception'
    line = error.lineno if isinstance(error, SyntaxError) else None
    trace = error.__traceback__
    while trace:
        if trace.tb_frame.f_code.co_filename == 'sharing.py':
            line = trace.tb_lineno
        trace = trace.tb_next
    return {'type': kind, 'line': line if type(line) is int and 1 <= line <= 100000 else None}


def main():
    payload = json.load(sys.stdin)
    os.close(0)
    restrict_learner()
    module = types.ModuleType('sharing')
    module.__file__ = 'sharing.py'
    sys.modules['sharing'] = module
    try:
        exec(compile(payload['source'], 'sharing.py', 'exec'), module.__dict__)
    except BaseException as error:
        print(json.dumps({'error': diagnostic(error)}), flush=True)
        return
    results = []
    for call in payload['calls']:
        try:
            value = getattr(module, call['fn'])(*call['args'])
            # JSON values are the only data accepted by the trusted caller.
            json.dumps(value, allow_nan=False)
            results.append({'value': value})
        except BaseException as error:
            results.append({'raised': diagnostic(error)})
    print(json.dumps({'results': results}, separators=(',', ':'), allow_nan=False), flush=True)


if __name__ == '__main__':
    main()
