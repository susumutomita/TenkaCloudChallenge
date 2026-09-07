"""Execute only submitted functions on supplied inputs; there is no checker or seed here."""
from __future__ import annotations

import copy
import dataclasses
import enum
import re
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
            if tb.tb_frame.f_code.co_filename in ('fftdomain.py',):
                filename, line = tb.tb_frame.f_code.co_filename, tb.tb_lineno
            tb = tb.tb_next
    return {'file': filename, 'line': line, 'type': type(error).__name__}


import _native_driver

active_module = None

def bootstrap(initial):
    global active_module
    restrict_learner()
    active_module = types.ModuleType('fftdomain')
    sys.modules['fftdomain'] = active_module
    exec(compile(initial['sources']['fftdomain.py'], 'fftdomain.py', 'exec'), active_module.__dict__)
    return active_module

def dispatch(call):
    name = call['function']
    if name not in ('validate_domain', 'fft', 'ifft', 'interpolate_and_evaluate'):
        raise ValueError('Unknown operation')
    return getattr(active_module, name)(*call['args'])

if __name__ == '__main__':
    _native_driver.run(bootstrap, dispatch, initialization_error, 'fftdomain.py', ())
