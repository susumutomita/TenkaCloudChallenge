"""Evaluate functions on supplied inputs. No seed, checker or expected answers enter here.

The caller treats every output byte as untrusted. Compile source after installing
kernel restrictions: imports cannot open private files, even via ctypes or exec.
"""
from __future__ import annotations

# Load the small standard-library vocabulary before closing file access. The exercise
# itself needs only dictionaries, if, loops and arithmetic. No pip packages are needed.
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


def main():
    payload = json.load(sys.stdin)
    # Popen closes every unrelated descriptor; close the input once consumed as well.
    os.close(0)
    restrict_learner()
    modules = {name: types.ModuleType(name) for name in ('classify', 'counterexamples')}
    sys.modules.update(modules)
    for name, module in modules.items():
        exec(compile(payload['sources'][name + '.py'], name + '.py', 'exec'), module.__dict__)
    values = []
    for call in payload['calls']:
        module = modules['classify' if call['function'] == 'classify' else 'counterexamples']
        values.append(getattr(module, call['function'])(call['argument']))
    print(json.dumps({'values': values}, separators=(',', ':')), flush=True)


if __name__ == '__main__':
    main()
