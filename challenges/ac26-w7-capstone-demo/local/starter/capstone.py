"""The only file you edit in this problem.

Week 7's design problem ended with a selection. This is the build.

Several parties each hold one number and want the sum. Nobody will hand their number to
anybody. You implement the protocol, and then — this is the part that makes it a capstone —
you produce the evidence that it does what you say it does, and only that.

## The randomness contract

`run` receives its randomness as an explicit tuple, never by calling `random`. That is not
style: it is what makes privacy *measurable*. With the randomness fixed and finite, the
hidden tests enumerate the entire probability space of a toy field and compare what a
coalition sees across two different inputs with the same sum. You cannot enumerate a call to
`random`, and a privacy claim you cannot enumerate is a privacy claim you asserted.

The contract, which every correct implementation follows so the space lines up:

    randomness has setting.randomness_length entries, each in [0, modulus)
    party i draws randomness[setting.slice_for(i)] -- exactly parties - 1 values
    those are its first parties - 1 shares; the last is whatever makes them add to its input

## The transcript

`run` returns everything anybody observed:

    {"output": int,
     "messages": [{"from": i, "to": j, "value": v}, ...],   # only `to` sees one
     "public":   [{"kind": "partial", "value": v}, ...],    # everybody sees these
     "rounds":   int}

Keeping point-to-point mail apart from what was opened is what lets a coalition's view be
computed at all. `public[j]` is party j's opened value.

Run `make inspect` for a worked run, `make test` to check yourself.
"""

from __future__ import annotations

from typing import Any, Callable

from participant.lab import Setting

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
    """Split `value` into `parties` additive shares over F_modulus.

    Exactly one of the shares is not drawn from `draws`. Drawing all of them would be one
    value too many, and the shares would no longer add back up to anything in particular.
    """
    return []


def run(setting: Setting, randomness: tuple[int, ...]) -> dict[str, Any]:
    """One full execution, returning the transcript described at the top of this file.

    Two rounds. In the first, everybody shares its input to everybody. In the second,
    everybody opens the sum of what it is holding.

    The second round is where the construction earns its keep: a partial sum is a sum of
    shares of *different* secrets, so opening it reveals none of them. Opening anything else
    does reveal something, and the privacy checkpoint will find it.
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
    both settings. If the two collections agree, the view is a function of the output alone.

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
