"""Reference capstone. Lives inside the image only; never mounted to the host.

A toy private aggregation: each party splits its input into additive shares, sends one to
every other party, each party sums what it holds, and the partial sums are opened and added.
The sum comes out; no individual input does.

What makes it a capstone rather than an exercise is that every claim it makes is attached to
an experiment that runs. `evidence` is not a description of the protocol — it executes the
checks and reports what they returned.
"""

from __future__ import annotations

from itertools import combinations
from typing import Any, Callable

from participant.lab import (
    CLAIMABLE,
    NOT_PROVIDED,
    PROVIDED,
    Setting,
    honest_sum,
    randomness_space,
    sample_randomness,
    tiny_settings,
)

Protocol = Callable[[Setting, tuple[int, ...]], dict[str, Any]]


# ---------------------------------------------------------------------------
# 1. Scope
# ---------------------------------------------------------------------------


def scope(setting: Setting) -> dict[str, Any]:
    """What this build claims, and what it explicitly does not.

    The non-goals are not modesty. Additive sharing with no authentication cannot detect a
    party that lies about its own input — there is nothing to check it against — and it
    cannot finish if a party walks away. Claiming either would be the failure the whole
    capstone is about.
    """
    return {
        "claims": sorted(PROVIDED),
        "non_goals": sorted(NOT_PROVIDED),
        "threshold": threshold(setting.parties),
        "parameters": setting.as_dict(),
    }


# ---------------------------------------------------------------------------
# 2. The protocol
# ---------------------------------------------------------------------------


def share(value: int, parties: int, modulus: int, draws: tuple[int, ...]) -> list[int]:
    """Split `value` into `parties` additive shares over F_modulus.

    The first `parties - 1` shares are the drawn randomness verbatim; the last is whatever
    makes them add back to `value`. Drawing the last one too would be one value too many and
    the shares would not reconstruct.
    """
    parts = [draw % modulus for draw in draws[: parties - 1]]
    parts.append((value - sum(parts)) % modulus)
    return parts


def run(setting: Setting, randomness: tuple[int, ...]) -> dict[str, Any]:
    """One full execution, returning everything anybody observed.

    `messages` are point to point: `to` is the only party that sees one. `public` is opened
    to everybody. Keeping the two apart in the transcript is what lets privacy be measured
    rather than asserted.
    """
    modulus = setting.modulus
    messages: list[dict[str, int]] = []
    held: list[list[int]] = [[] for _ in range(setting.parties)]

    # Round 1: everybody shares their input to everybody.
    for party, value in enumerate(setting.inputs):
        start, end = setting.slice_for(party)
        parts = share(value, setting.parties, modulus, randomness[start:end])
        for recipient, part in enumerate(parts):
            messages.append({"from": party, "to": recipient, "value": part})
            held[recipient].append(part)

    # Round 2: everybody opens the sum of what they hold. A partial sum is a sum of shares
    # of *different* secrets, which is why opening it reveals none of them.
    public = [
        {"kind": "partial", "from": party, "value": sum(parts) % modulus}
        for party, parts in enumerate(held)
    ]
    output = sum(entry["value"] for entry in public) % modulus
    return {
        "output": output,
        "messages": messages,
        "public": public,
        "rounds": 2,
    }


# ---------------------------------------------------------------------------
# 3. Views and what a coalition can do with one
# ---------------------------------------------------------------------------


def view(transcript: dict[str, Any], coalition: tuple[int, ...]) -> dict[str, Any]:
    """Exactly what `coalition` observes: its own mail, plus everything opened.

    A message addressed to somebody else is not in the view, and putting it there would be
    modelling an adversary that already won.
    """
    members = set(coalition)
    return {
        "received": tuple(
            (message["from"], message["to"], message["value"])
            for message in transcript["messages"]
            if message["to"] in members
        ),
        "public": tuple(entry["value"] for entry in transcript["public"]),
        "output": transcript["output"],
    }


def threshold(parties: int) -> int:
    """The smallest coalition that learns an honest party's input.

    All but one. Not because the protocol leaks at that size, but because the *output* does:
    subtract your own inputs from the sum and the only party left is exposed. No protocol
    computing this function can do better, which is why it belongs in the scope statement
    rather than in a list of defects.
    """
    return parties - 1


def recover(observed: dict[str, Any], coalition: tuple[int, ...], setting: Setting) -> int | None:
    """The one honest input, when the coalition is large enough to pin it down.

    Returns None below the threshold — and that is the honest answer, not a failure. Below it
    every residual input is equally consistent with what was seen.
    """
    if len(set(coalition)) < threshold(setting.parties):
        return None
    known = sum(setting.inputs[party] for party in set(coalition)) % setting.modulus
    return (observed["output"] - known) % setting.modulus


# ---------------------------------------------------------------------------
# 4. The experiments
# ---------------------------------------------------------------------------


def experiment_correctness(setting: Setting, seed: str) -> dict[str, Any]:
    """Does it compute the function on inputs nobody chose for it?"""
    randomness = sample_randomness(seed, setting)
    transcript = run(setting, randomness)
    return {
        "id": "exp-correctness",
        "ran": True,
        "passed": transcript["output"] == honest_sum(setting),
    }


def experiment_privacy() -> dict[str, Any]:
    """Enumerate the whole probability space and compare two worlds, for every coalition.

    Two settings with the same sum and different honest inputs. For each coalition below the
    threshold, and for every randomness, record what that coalition sees. If the two
    multisets agree, the view is a function of the output alone — which is the definition of
    learning nothing else, not an approximation of it.

    Sweeping *every* coalition rather than one is what makes this an experiment rather than a
    formality. A protocol can be perfectly private against party 0 and hand party 2 the lot:
    draw no randomness at all and party 2 receives every input in the clear, while party 0
    sees a constant and notices nothing.
    """
    left, right = tiny_settings()
    space = 0
    for size in range(1, threshold(left.parties)):
        for coalition in coalitions(left.parties, size):
            seen = [
                sorted(
                    repr(view(run(setting, randomness), coalition))
                    for randomness in randomness_space(setting)
                )
                for setting in (left, right)
            ]
            space = len(seen[0])
            if seen[0] != seen[1]:
                return {"id": "exp-privacy", "ran": True, "passed": False, "space": space}
    return {"id": "exp-privacy", "ran": True, "passed": True, "space": space}


def experiment_threshold(setting: Setting, seed: str) -> dict[str, Any]:
    """Recovery must work at the threshold and be impossible below it."""
    randomness = sample_randomness(seed, setting)
    transcript = run(setting, randomness)
    size = threshold(setting.parties)
    at = list(range(size))
    victim = next(party for party in range(setting.parties) if party not in at)
    recovered = recover(view(transcript, tuple(at)), tuple(at), setting)
    below = (
        recover(view(transcript, tuple(at[:-1])), tuple(at[:-1]), setting)
        if size >= 2
        else None
    )
    return {
        "id": "exp-threshold",
        "ran": True,
        "passed": recovered == setting.inputs[victim] and below is None,
    }


def detects(protocol: Protocol) -> bool:
    """Whether `protocol` is broken. The capstone's own test suite, in one function.

    Three independent checks, because the interesting breakages fail different ones: a wrong
    sum fails correctness, a protocol that opens a share instead of a partial sum passes
    correctness and fails privacy, and one that mails a value to the wrong party passes both
    and fails the addressing check.
    """
    for setting in tiny_settings():
        for randomness in (sample_randomness("detect", setting), (0,) * setting.randomness_length):
            try:
                transcript = protocol(setting, randomness)
            except Exception:  # noqa: BLE001 - a protocol that raises is a broken one
                return True
            if not _well_formed(transcript, setting):
                return True
            if transcript["output"] != honest_sum(setting):
                return True

    # Privacy, measured the same way the experiment measures it, but against the candidate —
    # and against every coalition, because the breakages that survive a single-coalition
    # check are exactly the ones that hand everything to the coalition nobody looked at.
    left, right = tiny_settings()
    for size in range(1, threshold(left.parties)):
        for coalition in coalitions(left.parties, size):
            seen = []
            for setting in (left, right):
                try:
                    seen.append(
                        sorted(
                            repr(view(protocol(setting, randomness), coalition))
                            for randomness in randomness_space(setting)
                        )
                    )
                except Exception:  # noqa: BLE001
                    return True
            if seen[0] != seen[1]:
                return True
    return False


def _well_formed(transcript: object, setting: Setting) -> bool:
    """Shape, addressing, and internal consistency.

    The last of those is the one that is easy to leave out and worth the most. A transcript
    whose opened values do not add up to the output it reports, or whose opened value for a
    party is not the sum of what that party actually received, is a run that did not happen
    the way it says it did. Checking only the output would accept it: an implementation can
    always return the right number while its transcript describes something else entirely.
    """
    if not isinstance(transcript, dict):
        return False
    if not {"output", "messages", "public", "rounds"} <= set(transcript):
        return False
    if not isinstance(transcript["messages"], list) or not isinstance(transcript["public"], list):
        return False

    received: list[int] = [0] * setting.parties
    sent: list[int] = [0] * setting.parties
    for message in transcript["messages"]:
        if not isinstance(message, dict) or not {"from", "to", "value"} <= set(message):
            return False
        if not 0 <= message["from"] < setting.parties or not 0 <= message["to"] < setting.parties:
            return False
        if not 0 <= message["value"] < setting.modulus:
            return False
        received[message["to"]] = (received[message["to"]] + message["value"]) % setting.modulus
        sent[message["from"]] += 1

    if len(transcript["public"]) != setting.parties:
        return False
    if any(count != setting.parties for count in sent):
        return False

    opened = 0
    for party, entry in enumerate(transcript["public"]):
        if not isinstance(entry, dict) or "value" not in entry:
            return False
        if entry["value"] != received[party]:
            return False
        opened = (opened + entry["value"]) % setting.modulus
    return opened == transcript["output"] % setting.modulus


# ---------------------------------------------------------------------------
# 5. Measurement
# ---------------------------------------------------------------------------


def measure(setting: Setting, seed: str) -> dict[str, Any]:
    """Counted from a run, not from the protocol description.

    A number written down by hand is a claim about the design. A number counted off the
    transcript is a claim about the build, and only the second one can be wrong in a way
    anybody notices.
    """
    transcript = run(setting, sample_randomness(seed, setting))
    return {
        "rounds": transcript["rounds"],
        "messages": len(transcript["messages"]),
        "opened": len(transcript["public"]),
        "unit": "messages are point-to-point field elements; opened values are broadcast",
        "environment": f"{setting.parties} parties over F_{setting.modulus}, single process",
    }


# ---------------------------------------------------------------------------
# 6. Evidence
# ---------------------------------------------------------------------------


def evidence(setting: Setting, seed: str) -> dict[str, dict[str, Any]]:
    """Every claimed property, tied to an experiment that actually ran.

    A property with no experiment is a claim. An experiment that did not run is a plan. The
    non-goals appear too, marked as unclaimed, because a bundle that quietly omits what it
    cannot do reads exactly like one that has nothing left to hide.
    """
    correctness = experiment_correctness(setting, seed)
    privacy = experiment_privacy()
    limit = experiment_threshold(setting, seed)

    bundle: dict[str, dict[str, Any]] = {
        "correctness": {
            "claimed": True,
            "experiment": correctness["id"],
            "verdict": correctness["passed"],
            "limitation": "checked on seeded parameters, not proved for all of them",
        },
        "privacy": {
            "claimed": True,
            "experiment": privacy["id"],
            "verdict": privacy["passed"],
            "limitation": (
                f"exact over {privacy['space']} randomness values on a toy field, and only "
                f"below a coalition of {threshold(setting.parties)}"
            ),
        },
    }
    for name in sorted(NOT_PROVIDED):
        bundle[name] = {
            "claimed": False,
            "experiment": limit["id"] if name == "soundness" else "",
            "verdict": None,
            "limitation": (
                "a party that lies about its own input is not detected; nothing checks it"
                if name == "soundness"
                else "one party that stops responding stops the protocol"
            ),
        }
    return bundle


def claimable() -> tuple[str, ...]:
    """The vocabulary a bundle may talk about."""
    return CLAIMABLE


def coalitions(parties: int, size: int) -> list[tuple[int, ...]]:
    """Every coalition of the given size, for experiments that sweep them."""
    return [tuple(members) for members in combinations(range(parties), size)]
