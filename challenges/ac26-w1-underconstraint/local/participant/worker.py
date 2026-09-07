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
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
# Public evaluator is an allowed import, loaded before file access closes.
import participant.evaluator
from isolation import restrict_learner


def main():
    payload = json.loads(sys.stdin.readline())
    restrict_learner()
    module = types.ModuleType('policy')
    sys.modules['policy'] = module
    exec(compile(payload['sources']['policy.py'], 'policy.py', 'exec'), module.__dict__)
    print('{"ready":true}', flush=True)
    for line in sys.stdin:
        call = json.loads(line)
        try:
            result = {'returned': getattr(module, call['function'])(*call['args'])}
        except Exception as error:
            result = {'raised': type(error).__name__}
        print(json.dumps({'callId': call['callId'], 'result': result},
                         separators=(',', ':')), flush=True)


if __name__ == '__main__':
    main()
