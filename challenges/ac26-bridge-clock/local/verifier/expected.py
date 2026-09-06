"""Verifier-only expected values for the seven unique-answer checkpoints.

The remaining reuse checkpoint accepts every construction satisfying its public
contract, through valid_reuse; it has no canonical expected tuple.
"""
from fixtures.generate import setting


def expected_for(seed: str) -> dict[str, object]:
    return setting(seed)["expected"]
