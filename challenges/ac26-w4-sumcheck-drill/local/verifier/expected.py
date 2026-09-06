"""Authoritative answers stay in the verifier; participant images do not contain fixtures."""
from fixtures.generate import setting


def expected_for(seed):
    return setting(seed)['expected']
