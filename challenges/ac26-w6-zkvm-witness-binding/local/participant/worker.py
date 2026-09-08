"""Execute submitted functions only. No fixture seed, checker or verdict is loaded here."""
from __future__ import annotations

# Supported computational helpers are loaded before evaluation restrictions.
import array
import base64
import binascii
import bisect
import contextlib
import heapq
import re
import string
import struct

# Load standard beginner-facing helpers before filesystem restrictions.
import collections
import copy
import dataclasses
import decimal
import enum
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
import sys
import time
import types
import typing
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from participant.isolation import restrict_learner
from participant.protocol import decode, encode
import participant.lab


class RemoteEnv:
    """Request operations on the parent's Env; counters and transcripts stay there."""
    def __init__(self, call, index, sequence):
        self.call, self.index, self.sequence = call, index, sequence

    def __getattr__(self, method):
        if method not in ('public', 'variable', 'note', 'hint', 'write_private',
                          'public_inputs', 'hints', 'read_private', 'transcript', 'writes', 'reads'):
            raise AttributeError(method)

        def operation(*args, **kwargs):
            operation_id = self.sequence[0]
            self.sequence[0] += 1
            print(json.dumps({'callId': self.call, 'env': self.index,
                              'operationId': operation_id, 'method': method,
                              'args': encode(args), 'kwargs': encode(kwargs)}), flush=True)
            reply = json.loads(sys.stdin.readline())
            if reply.get('callId') != self.call or reply.get('operationId') != operation_id:
                raise ValueError('Malformed input reply.')
            if 'error' in reply:
                raise ValueError('Input operation refused.')
            return decode(reply['value'])
        return operation


def main():
    initial = json.loads(sys.stdin.readline())
    restrict_learner()
    module = types.ModuleType('guest')
    sys.modules['guest'] = module
    try:
        exec(compile(initial['sources']['guest.py'], 'guest.py', 'exec'), module.__dict__)
    except BaseException:
        print('{"initializationError":{}}', flush=True)
        return
    print('{"ready":true}', flush=True)
    for line in sys.stdin:
        call = json.loads(line)
        try:
            sequence = [0]
            args = [RemoteEnv(call['callId'], item[1], sequence) if item[0] == 'env'
                    else decode(item) for item in call['args']]
            result = getattr(module, call['function'])(*args)
            response = {'callId': call['callId'], 'value': encode(result)}
        except BaseException as error:
            # Only the class name crosses; exception text may contain a hidden input.
            response = {'callId': call['callId'], 'error': 'ValueError' if isinstance(error, ValueError) else type(error).__name__}
        print(json.dumps(response), flush=True)


if __name__ == '__main__':
    main()
