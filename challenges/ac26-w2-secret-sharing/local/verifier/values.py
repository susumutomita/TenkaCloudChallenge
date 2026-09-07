"""Trusted adapter for the existing property checker; only JSON crosses from learner.

Precompute independent calls in batches, then replay their values to the checker.
Reconstruction always starts another worker, with shares but not the original secret.
"""
from __future__ import annotations

import json
import time

from fixtures.generate import (PRIMES, line_cases, privacy_probe, randomness,
                               setting, share_randomness)
from participant.execution import run_functions


class ExecutionFailed(Exception):
    pass


class Values:
    def __init__(self, source, seed, phases):
        self.source = source
        self.deadline = time.monotonic() + 12
        self.cache = {}
        calls = []
        if set(phases) & {'check_roundtrip', 'check_no_trivial_split', 'check_rerandomize'}:
            for label in ('h0', 'h1', 'h2', 'h3'):
                cfg = setting(seed, label)
                p,n,s = cfg['p'],cfg['n'],cfg['secret']
                calls.append(('share', [s,n,p,share_randomness(seed,label,n-1,p,s)]))
                if 'check_no_trivial_split' in phases:
                    calls.append(('share',[s,n,p,[0]*(n-1)]))
        if 'check_completion' in phases:
            for label in ('h0', 'h1', 'h2', 'h3'):
                cfg = setting(seed,label);p,n = cfg['p'],cfg['n']
                partial = [r % p for r in randomness(seed,f'{label}-partial',n-1,p)]
                calls.extend(('complete_shares',[partial,s,p]) for s in range(p))
        if set(phases) & {'check_line_pairs', 'check_line_privacy'}:
            for case in line_cases(seed):
                p = case['p']
                calls.append(('share_line',[case['secret'],p,[case['slope']]]))
                if 'check_line_privacy' in phases:
                    secrets = (range(p) if p in PRIMES else
                               privacy_probe(seed,case['label'],p,case['secret'])['secrets'])
                    calls.extend(('share_line',[secret,p,[r]]) for secret in secrets for r in range(p))
        unique = {self.key(name,args):(name,args) for name,args in calls}
        ordered = list(unique.values())
        for key,result in zip(unique,self.reconstruct_values(ordered)):
            self.cache[key] = result

    @staticmethod
    def key(name,args):
        return name + ':' + json.dumps(args,separators=(',',':'))

    def reconstruct_values(self,calls):
        remaining = self.deadline-time.monotonic()
        if remaining <= 0:
            raise ExecutionFailed()
        result = run_functions(self.source,[{'fn':name,'args':args} for name,args in calls],
                               timeout=remaining)
        if not isinstance(result,dict) or not isinstance(result.get('results'),list):
            raise ExecutionFailed()
        return result['results']

    def __getattr__(self,name):
        if name not in ('share','complete_shares','rerandomize','share_line','reconstruct','reconstruct_line'):
            raise AttributeError(name)
        def call(*args):
            key = self.key(name,args)
            if key not in self.cache:
                self.cache[key] = self.reconstruct_values([(name,list(args))])[0]
            result = self.cache[key]
            if 'raised' in result:
                raise ExecutionFailed()
            # No learner-controlled Python objects or aliases enter trusted properties.
            return json.loads(json.dumps(result.get('value')))
        return call
