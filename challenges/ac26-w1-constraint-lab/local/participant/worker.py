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


def main():
    initial = json.loads(sys.stdin.readline())
    restrict_learner()
    modules = {name: types.ModuleType(name) for name in ('field', 'circuit', 'gadgets')}
    sys.modules.update(modules)
    for name, module in modules.items():
        exec(compile(initial['sources'][name+'.py'], name+'.py', 'exec'), module.__dict__)
    for line in sys.stdin:
        call = json.loads(line)
        try:
            module = modules[call['module']]
            args = call['args']
            if call['module'] == 'field':
                value = getattr(module.Field(call['modulus']), call['function'])(*args)
            elif call['module'] == 'circuit':
                value = getattr(module, call['function'])(*args, modules['field'].Field(call['modulus']))
            else:
                value = getattr(module, call['function'])(*args)
            response = {'callId': call['callId'], 'value': value}
        except BaseException as error:
            # No exception text: a failed hidden call may mention its input values.
            response = {'callId': call['callId'], 'error': type(error).__name__}
        print(json.dumps(response, separators=(',', ':')), flush=True)


if __name__ == '__main__':
    main()
