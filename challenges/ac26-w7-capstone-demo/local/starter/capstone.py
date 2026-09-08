"""Edit capstone.py in the Portal. First implement scope and submit scope.

You build a private sum: people keep their inputs separate, send additive shares
(parts summing to the input after division remainder), and publish only partial sums.
The free statement gives every formula, API and return shape with a worked table.

A transcript is the run's message record. A coalition is a group pooling observations.
The view here contains received mail and public values only, not a complete adversary
state. Enumerating the tiny random space measures two specified worlds; it does not
prove privacy for arbitrary inputs or a production protocol.

Use start,end=setting.slice_for(i), then randomness[start:end]. The pair itself is
not a Python slice. Public entries include kind="partial" and value; optional from
is their recipient index. Self-addressed messages are recorded too.
"""

from __future__ import annotations

from typing import Any, Callable

from itertools import combinations

from participant.lab import (
    CLAIMABLE, PROVIDED, NOT_PROVIDED, Setting, honest_sum,
    randomness_space, sample_randomness, tiny_settings,
)

Protocol = Callable[[Setting, tuple[int, ...]], Any]


def scope(setting: Setting) -> dict[str, Any]:
    """What this build claims, and what it explicitly does not.

    Return {"claims", "non_goals", "threshold", "parameters"}. `claims` and `non_goals` are
    lists drawn from `participant.lab.CLAIMABLE`; `parameters` is `setting.as_dict()`.

    Two of the four properties this construction genuinely provides, and two it does not.
    Work out which before writing them down — one of the two it lacks is missing because
    nothing in the protocol ever checks a party against anything, and the other because one
    party going quiet is the end of the run. Claiming either is the failure being assessed.
    """
    return {}


def share(value: int, parties: int, modulus: int, draws: tuple[int, ...]) -> list[int]:
    """Split `value` into `parties` additive shares using division remainder by modulus.

    Exactly one of the shares is not drawn from `draws`. Drawing all of them would be one
    value too many, and the shares would no longer add back up to anything in particular.
    """
    return []


def run(setting: Setting, randomness: tuple[int, ...]) -> dict[str, Any]:
    """One full execution, returning the transcript described at the top of this file.

    Two rounds. In the first, everybody shares its input to everybody. In the second,
    everybody opens the sum of what it is holding.

    The second round is where the construction earns its keep: a partial sum is a sum of
    shares of *different* secrets, so the tiny experiment can test the observed distribution. This is not a
    general guarantee that no observer learns any individual input.
    """
    return {}


def view(transcript: dict[str, Any], coalition: tuple[int, ...]) -> dict[str, Any]:
    """Exactly what `coalition` observes: its own mail, plus everything opened.

    Return {"received", "public", "output"}. A message addressed to somebody outside the
    coalition is not in the view — and putting it there models an adversary that has already
    won, which makes the privacy result meaningless in the other direction.
    """
    return {}


def threshold(parties: int) -> int:
    """The smallest coalition that learns an honest party's input.

    Be careful here. The answer is not about a weakness in the protocol at all — it is about
    the function being computed. Ask what a coalition can work out from the *output* alone,
    given that they know their own inputs.
    """
    return 0


def recover(observed: dict[str, Any], coalition: tuple[int, ...], setting: Setting) -> int | None:
    """The remaining input, when the coalition is large enough to pin it down.

    Return None below the threshold. That is the honest answer and it is graded: a coalition
    that names an input it cannot know is a worse failure than one that admits it cannot.
    """
    return None


def experiment_privacy() -> dict[str, Any]:
    """Measure privacy rather than assert it.

    Return {"id", "ran", "passed", "space"}. `participant.lab.tiny_settings()` gives two
    settings with the same sum and different honest inputs, and `randomness_space` gives
    every randomness either one admits.

    For each coalition below the threshold, collect what it sees across the whole space in
    both settings. Compare sorted lists, preserving frequency. Agreement concerns these two worlds
    and this restricted received/public view only, not all possible inputs.

    Sweep every coalition, not one. A protocol can be perfectly private against party 0 and
    hand party 2 the lot.
    """
    return {}


def detects(protocol: Protocol) -> bool:
    """Your test suite, as one function: is `protocol` broken?

    It is handed your own protocol, which must come back False, and a series of broken ones
    you have not seen, which must all come back True. So it has to be a real suite, not a
    list of known-bad cases.

    Three independent things go wrong in practice and no single check finds all three: the
    output can be wrong; the output can be right while the transcript leaks; and both can
    look right while the transcript describes a run that did not happen.
    """
    return False


def measure(setting: Setting, seed: str) -> dict[str, Any]:
    """Rounds, messages, and opened values — counted off a real run.

    Return {"rounds", "messages", "opened", "unit", "environment"}. The counts are checked
    against an actual transcript, so a number worked out on paper will not match unless the
    build agrees with it. A measurement without a unit or an environment is not a
    measurement.
    """
    return {}


def evidence(setting: Setting, seed: str) -> dict[str, dict[str, Any]]:
    """Every property, tied to an experiment that ran.

    One entry per property, each {"claimed", "experiment", "verdict", "limitation"}. A
    claimed property needs a named experiment and a verdict of True. A property you do not
    claim still appears, marked unclaimed, with the limitation that explains why — a bundle
    that quietly omits what the build cannot do reads exactly like one with nothing to hide.
    """
    return {}
