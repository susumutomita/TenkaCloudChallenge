"""Hidden tests. Run by /verify against a copy of the learner's encoding.py.

Ground truth comes from `fixtures.generate`, never from the submission. That matters most
for the `interval` and `first-failure` checkpoints, which are the same fact approached
from two directions: a checker that measured the interval with the learner's `decode`
would accept a `decode` and an interval that are wrong together, which is precisely the
failure mode a learner reaches by writing the interval to match whatever their decoder
happened to do.

Every phase runs across several parameter sets, and `params` produces both parities of
`delta`. An implementation that works out the interval from an even `delta` and assumes
symmetry passes about half the labels and fails the rest.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from fixtures.generate import (  # noqa: E402
    INVALID_PARAMS,
    VALID_PARAMS,
    centered as reference_centered,
    decode as reference_decode,
    encode as reference_encode,
    first_failure as reference_first_failure,
    params as parameters,
    success_interval as reference_interval,
)

LABELS = ("h0", "h1", "h2", "h3", "h4", "h5")


def _sets(seed: str) -> list[dict]:
    """Several parameter sets, guaranteed to include both parities of delta.

    Without the guarantee this suite would silently stop testing the asymmetric case
    whenever a seed happened to draw six odd deltas.
    """
    drawn = [parameters(seed, label) for label in LABELS]
    if all(par["delta"] % 2 for par in drawn):
        drawn.append({"p": drawn[0]["p"], "delta": 16, "q": drawn[0]["p"] * 16})
    if all(par["delta"] % 2 == 0 for par in drawn):
        drawn.append({"p": drawn[0]["p"], "delta": 9, "q": drawn[0]["p"] * 9})
    return drawn


def check_encode(module, seed: str) -> list[str]:
    failures: list[str] = []
    for par in _sets(seed):
        try:
            points = [module.encode(par, m) for m in range(par["p"])]
        except Exception as error:  # noqa: BLE001
            return [f"encoding raised {type(error).__name__}"]
        if points != [reference_encode(par, m) for m in range(par["p"])]:
            failures.append("an encoding point is not m * delta reduced into the ring")
            continue
        if len(set(points)) != par["p"]:
            failures.append("two messages encode to the same point")
            continue
        # A message outside the space is normalized, not rejected and not left alone.
        for m in (par["p"], par["p"] + 1, -1, -par["p"]):
            if module.encode(par, m) != reference_encode(par, m):
                failures.append("a message outside [0, p) is not normalized into it")
                break
        # And every point is a ring element.
        if any(not 0 <= point < par["q"] for point in points):
            failures.append("an encoding point falls outside [0, q)")
    return failures


def check_noise(module, seed: str) -> list[str]:
    """Adding noise, and the centered view of the result."""
    failures: list[str] = []
    for par in _sets(seed):
        q = par["q"]
        try:
            values = [module.centered(par, x) for x in range(q)]
        except Exception as error:  # noqa: BLE001
            return [f"centering raised {type(error).__name__}"]
        if values != [reference_centered(par, x) for x in range(q)]:
            failures.append("the centered representative is off for at least one value")
            continue
        # Round trip: centering then reducing has to be the identity on the ring.
        if [value % q for value in values] != list(range(q)):
            failures.append("centering does not round-trip back through the ring")
            continue
        # Adding q changes the representation and not the value.
        if any(module.centered(par, x + q) != values[x] for x in range(q)):
            failures.append("adding q changed the centered representative")
            continue

        # Negative noise is noise. Taking its absolute value is a mutation, and it only
        # shows up when the noise actually is negative.
        for m in range(par["p"]):
            base = reference_encode(par, m)
            for e in (-1, -3, 0, 3, q + 5, -(q + 5)):
                if module.add_noise(par, base, e) != (base + e) % q:
                    failures.append("adding noise does not reduce (c + e) into [0, q)")
                    break
    return failures


def check_decode(module, seed: str) -> list[str]:
    failures: list[str] = []
    for par in _sets(seed):
        q = par["q"]
        try:
            decoded = [module.decode(par, c) for c in range(q)]
        except Exception as error:  # noqa: BLE001
            return [f"decoding raised {type(error).__name__}"]
        if decoded != [reference_decode(par, c) for c in range(q)]:
            failures.append("at least one ring value decodes to the wrong message")
            continue
        # decode(encode(m)) == m, the property everything else rests on.
        if [module.decode(par, reference_encode(par, m)) for m in range(par["p"])] != list(
            range(par["p"])
        ):
            failures.append("an exact encoding point does not decode to its own message")
            continue
        # Adding q does not change the decoded message.
        if any(module.decode(par, c + q) != decoded[c] for c in range(q)):
            failures.append("adding q to the representation changed the decoded message")
            continue
        # The tie. With delta even there is an exact half-way point and it rounds up;
        # rounding down there is a whole-interval error that a worked example misses.
        if par["delta"] % 2 == 0:
            halfway = reference_encode(par, 0) + par["delta"] // 2
            if module.decode(par, halfway % q) != 1 % par["p"]:
                failures.append("the exact half-way point does not round up")
    return failures


def check_interval(module, seed: str) -> list[str]:
    """The tolerated interval, predicted rather than measured."""
    failures: list[str] = []
    for par in _sets(seed):
        try:
            reported = tuple(module.success_interval(par))
        except Exception as error:  # noqa: BLE001
            return [f"computing the interval raised {type(error).__name__}"]
        expected = reference_interval(par)
        if reported != expected:
            # Named rather than shown: the most common wrong answer is the symmetric one.
            if reported == (-(par["delta"] // 2), par["delta"] // 2):
                failures.append("the interval is symmetric, but the tie rule is not")
            else:
                failures.append("the predicted interval is not the tolerated one")
            continue
        low, high = expected
        # It has to be the real interval, checked against the reference decoder rather
        # than the submission's: every message survives inside it...
        for m in range(par["p"]):
            base = reference_encode(par, m)
            if any(
                reference_decode(par, (base + e) % par["q"]) != m for e in range(low, high + 1)
            ):
                failures.append("a message fails inside the reported interval")
                break
            # ...and fails at both ends, one step out.
            if any(
                reference_decode(par, (base + e) % par["q"]) == m for e in (low - 1, high + 1)
            ):
                failures.append("a message survives one step outside the reported interval")
                break
    return failures


def check_first_failure(module, seed: str) -> list[str]:
    """The first noise that breaks it, and what it breaks into."""
    failures: list[str] = []
    for par in _sets(seed):
        for m in range(par["p"]):
            for direction in (1, -1):
                try:
                    reported = tuple(module.first_failure(par, m, direction))
                except Exception as error:  # noqa: BLE001
                    return [f"searching for the first failure raised {type(error).__name__}"]
                expected = reference_first_failure(par, m, direction)
                if reported != expected:
                    # The wrap is the whole content of this check for two of the p
                    # messages, and only for those two.
                    if reported[0] == expected[0]:
                        failures.append(
                            "the failing message is not reduced modulo p at the ends of the space"
                        )
                    else:
                        failures.append("the first failing noise is not the first one")
                    break
    return failures


def check_transfer(module, seed: str) -> list[str]:
    """Everything at once, under a parameter set the learner has not seen.

    /verify passes a derived seed for this checkpoint, so these parameters are not the
    ones any other checkpoint used.
    """
    failures: list[str] = []
    for phase in (check_encode, check_noise, check_decode, check_interval, check_first_failure):
        failures.extend(phase(module, seed))
    return failures


def check_validate(module, seed: str) -> list[str]:
    """Parameter sets that must be rejected, and the ones that must not be.

    The rejects are fixed in the fixtures rather than constructed by the learner:
    rejecting a parameter set you broke yourself proves nothing about the validator.
    """
    failures: list[str] = []
    try:
        for reason, par in INVALID_PARAMS:
            if not module.validate_params(dict(par)):
                failures.append(f"an invalid parameter set was accepted: {reason}")
        for par in VALID_PARAMS:
            reported = module.validate_params(dict(par))
            if reported:
                failures.append("a usable parameter set was rejected")
    except Exception as error:  # noqa: BLE001
        return [f"validating parameters raised {type(error).__name__}"]

    # Every generated set is usable by construction, so rejecting one is a false positive
    # rather than caution.
    for par in _sets(seed):
        if module.validate_params(dict(par)):
            failures.append("a generated parameter set was rejected")
            break

    # Deterministic: the same input twice gives the same answer, and the answer is a list
    # of strings rather than a bool or None.
    sample = dict(INVALID_PARAMS[0][1])
    first = module.validate_params(dict(sample))
    if not isinstance(first, list) or not all(isinstance(item, str) for item in first):
        failures.append("validation does not report a list of strings")
    elif first != module.validate_params(dict(sample)):
        failures.append("validation is not deterministic")

    return failures


PHASES = (
    check_encode,
    check_noise,
    check_decode,
    check_interval,
    check_first_failure,
    check_validate,
)


def run(module, seed: str) -> list[str]:
    failures: list[str] = []
    for phase in PHASES:
        failures.extend(phase(module, seed))
    return failures
