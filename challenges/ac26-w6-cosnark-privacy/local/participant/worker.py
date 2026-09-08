"""Execute submitted functions only. No fixture seed, checker or verdict is loaded here."""
from __future__ import annotations

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
from participant.protocol import Codec
from participant.mpc import CrossPartyRead, TripleMisuse
import participant.lab
import participant.specimens
from contextlib import contextmanager


class RemoteRuntime:
    """Only named public MPC operations cross to the parent's actual runtime."""
    def __init__(self, token, setting, methods, channel, codec):
        self.token, self.setting, self.methods = token, setting, methods
        self.channel, self.codec = channel, codec

    def _operation(self, method, *args, **kwargs):
        sequence = self.channel['sequence']
        self.channel['sequence'] += 1
        call = self.channel['call']
        print(json.dumps({'callId': call, 'runtime': self.token,
                          'operationId': sequence, 'method': method,
                          'args': self.codec.encode(args), 'kwargs': self.codec.encode(kwargs)}), flush=True)
        reply = json.loads(sys.stdin.readline())
        if reply.get('callId') != call or reply.get('operationId') != sequence:
            raise ValueError('Malformed MPC reply.')
        if 'error' in reply:
            errors = {'ValueError': ValueError, 'TypeError': TypeError,
                      'CrossPartyRead': CrossPartyRead, 'TripleMisuse': TripleMisuse, 'KeyError': KeyError}
            raise errors.get(reply['error'], ValueError)('MPC operation refused.')
        return self.codec.decode(reply['value'])

    def __call__(self, *args, **kwargs):
        if '__call__' not in self.methods:
            raise TypeError('This object is not a probe.')
        return self._operation('__call__', *args, **kwargs)

    @contextmanager
    def party_scope(self, party):
        result = self._operation('scope-enter', party)
        try:
            yield result
        finally:
            self._operation('scope-exit')

    def __getattr__(self, method):
        if method not in self.methods:
            raise AttributeError(method)
        return lambda *args, **kwargs: self._operation(method, *args, **kwargs)


def main():
    initial = json.loads(sys.stdin.readline())
    restrict_learner()
    module = types.ModuleType('prover')
    sys.modules['prover'] = module
    try:
        exec(compile(initial['sources']['prover.py'], 'prover.py', 'exec'), module.__dict__)
    except BaseException:
        print('{"initializationError":{}}', flush=True)
        return
    print('{"ready":true}', flush=True)
    channel = {'call': None, 'sequence': 0}
    for line in sys.stdin:
        call = json.loads(line)
        codec = Codec()
        codec.runtime_factory = lambda token, setting, methods: RemoteRuntime(token, setting, methods, channel, codec)
        try:
            channel.update(call=call['callId'], sequence=0)
            args = codec.decode(call['args'])
            result = getattr(module, call['function'])(*args)
            response = {'callId': call['callId'], 'value': codec.encode(result)}
        except BaseException as error:
            # Only the class name crosses; exception text may contain a hidden input.
            response = {'callId': call['callId'], 'error': 'ValueError' if isinstance(error, ValueError) else type(error).__name__}
        print(json.dumps(response), flush=True)


if __name__ == '__main__':
    main()
