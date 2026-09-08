"""Execute only submitted functions on supplied inputs; there is no checker or seed here."""
from __future__ import annotations

# time.strptime loads these helpers lazily; cache them before restricting files.
import _strptime

# Supported computational helpers are loaded before evaluation restrictions.
import array
import base64
import binascii
import bisect
import contextlib
import dataclasses
import enum
import heapq
import re
import string
import struct

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

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parent))
from isolation import restrict_learner
from protocol import encode, decode, transcript_fields

# This completed vocabulary is the only problem library the submission imports.
# Load it before filesystem access is disabled; do not preload tests or fixtures.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import participant.lab


def initialization_error(error, filename):
    """Report only source locations; the receiver validates these untrusted fields."""
    line = None
    if isinstance(error, SyntaxError) and error.filename == filename:
        line = error.lineno
    else:
        tb = error.__traceback__
        while tb is not None:
            if tb.tb_frame.f_code.co_filename in ('capstone.py',):
                filename, line = tb.tb_frame.f_code.co_filename, tb.tb_lineno
            tb = tb.tb_next
    return {'file': filename, 'line': line, 'type': type(error).__name__}


MODULES = {}
CURRENT_CALL = None


def supplied_callback(call_id, index):
    def invoke(*args):
        callback_id = os.urandom(16).hex()
        print(json.dumps({'callId': call_id, 'callback': index, 'callbackId': callback_id, 'args': encode(args)}), flush=True)
        while True:
            reply = json.loads(sys.stdin.readline())
            if 'function' in reply:
                dispatch(reply)
                continue
            if reply.get('callId') != call_id or reply.get('callbackId') != callback_id:
                raise ValueError('Invalid supplied function reply.')
            if 'error' in reply:
                raise ValueError('The supplied function refused input.')
            return decode(reply['value'])
    return invoke


def dispatch(call):
    global CURRENT_CALL
    previous, CURRENT_CALL = CURRENT_CALL, call['callId']
    try:
        args = [supplied_callback(call['callId'], frame[1]) if frame[0] == 'callback' else decode(frame) for frame in call['args']]
        value = getattr(MODULES[call['module']], call['function'])(*args)
        if call['function'] == 'run':
            value = transcript_fields(value)
        response = {'callId': call['callId'], 'value': encode(value)}
    except BaseException as error:
        response = {'callId': call['callId'], 'error': 'ValueError' if isinstance(error, ValueError) else type(error).__name__}
    finally:
        CURRENT_CALL = previous
    print(json.dumps(response, separators=(',', ':'), allow_nan=False), flush=True)


def main():
    initial = json.loads(sys.stdin.readline())
    restrict_learner()
    names = ('capstone',)
    MODULES.update({name: types.ModuleType(name) for name in names})
    sys.modules.update(MODULES)
    for name, module in MODULES.items():
        filename = name+'.py'
        try:
            exec(compile(initial['sources'][filename], filename, 'exec'), module.__dict__)
        except BaseException as error:
            print(json.dumps({'initializationError': initialization_error(error, filename)}), flush=True)
            return
    print('{"ready":true}', flush=True)
    for line in sys.stdin:
        dispatch(json.loads(line))


if __name__ == '__main__':
    main()
