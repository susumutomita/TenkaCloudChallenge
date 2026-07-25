"""Hidden tests. Run by /verify against a copy of the learner's file, never shown to them.

The mutants for the `detect` checkpoint live here rather than in `fixtures/`, because
`fixtures/` is a file in the learner's checkout and a visible mutant is one that can be
special-cased. Each is built by wrapping the learner's *own* `run`, so "is this broken" is
asked about their protocol rather than somebody else's.

Failure messages name the property that broke, never the expected value.
"""

from __future__ import annotations

import sys
from itertools import combinations
from pathlib import Path
from typing import Any, Callable

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from fixtures.generate import (  # noqa: E402
    CLAIMABLE,
    NOT_PROVIDED,
    PROVIDED,
    Setting,
    hidden_settings,
    honest_sum,
    public_setting,
    randomness_space,
    sample_randomness,
    tiny_settings,
)

Protocol = Callable[[Setting, tuple[int, ...]], Any]


def _call(module: Any, name: str, *args: Any) -> tuple[Any, str]:
    try:
        return getattr(module, name)(*args), ""
    except AttributeError:
        return None, f"{name} is not defined"
    except Exception as error:  # noqa: BLE001 - a raising solution is a failing solution
        return None, f"{name} raised {type(error).__name__}"


def _settings(seed: str) -> list[Setting]:
    return [public_setting(seed), *hidden_settings(seed)]


def _coalitions(parties: int, size: int) -> list[tuple[int, ...]]:
    return [tuple(members) for members in combinations(range(parties), size)]


# ---------------------------------------------------------------------------
# The specification, restated independently of reference/capstone.py
# ---------------------------------------------------------------------------


def _spec_well_formed(transcript: Any, setting: Setting) -> str:
    """Empty string when the transcript is a run that could actually have happened."""
    if not isinstance(transcript, dict):
        return "the run did not return a transcript"
    if not {"output", "messages", "public", "rounds"} <= set(transcript):
        return "the transcript is missing the output, the messages, the opened values, or the rounds"
    messages, public = transcript["messages"], transcript["public"]
    if not isinstance(messages, list) or not isinstance(public, list):
        return "the messages or the opened values are not lists"
    if len(public) != setting.parties:
        return "the number of opened values does not match the number of parties"

    received = [0] * setting.parties
    sent = [0] * setting.parties
    for message in messages:
        if not isinstance(message, dict) or not {"from", "to", "value"} <= set(message):
            return "a message is missing a sender, a recipient, or a value"
        sender, recipient, value = message["from"], message["to"], message["value"]
        if not isinstance(sender, int) or not 0 <= sender < setting.parties:
            return "a message comes from a party that is not playing"
        if not isinstance(recipient, int) or not 0 <= recipient < setting.parties:
            return "a message is addressed to a party that is not playing"
        if not isinstance(value, int) or isinstance(value, bool) or not 0 <= value < setting.modulus:
            return "a message carries a value outside the field"
        received[recipient] = (received[recipient] + value) % setting.modulus
        sent[sender] += 1

    if any(count != setting.parties for count in sent):
        return "a party did not send one share to every party"

    total = 0
    for party, entry in enumerate(public):
        if not isinstance(entry, dict) or "value" not in entry:
            return "an opened value has no value"
        if entry["value"] != received[party]:
            return "an opened value is not the sum of what that party received"
        total = (total + entry["value"]) % setting.modulus
    if total != transcript["output"] % setting.modulus:
        return "the opened values do not add up to the reported output"
    return ""


def _spec_view(transcript: dict[str, Any], coalition: tuple[int, ...]) -> dict[str, Any]:
    members = set(coalition)
    return {
        "received": tuple(
            (m["from"], m["to"], m["value"]) for m in transcript["messages"] if m["to"] in members
        ),
        "public": tuple(entry["value"] for entry in transcript["public"]),
        "output": transcript["output"],
    }


def _leaks(protocol: Protocol, viewer: Callable[[Any, tuple[int, ...]], Any]) -> bool:
    """Whether any coalition below the threshold sees more than the output determines.

    Exact, not sampled: the whole randomness space of a toy field is enumerated, for every
    coalition. Sweeping the coalitions is what catches a protocol that is private against
    party 0 and hands party 2 everything.
    """
    left, right = tiny_settings()
    for size in range(1, left.parties - 1):
        for members in _coalitions(left.parties, size):
            seen = []
            for setting in (left, right):
                try:
                    seen.append(
                        sorted(
                            repr(viewer(protocol(setting, randomness), members))
                            for randomness in randomness_space(setting)
                        )
                    )
                except Exception:  # noqa: BLE001
                    return True
            if seen[0] != seen[1]:
                return True
    return False


# ---------------------------------------------------------------------------
# 1. Scope
# ---------------------------------------------------------------------------


def check_scope(module: Any, seed: str) -> list[str]:
    failures: list[str] = []
    for setting in _settings(seed):
        manifest, error = _call(module, "scope", setting)
        if error:
            failures.append(error)
            continue
        if not isinstance(manifest, dict):
            failures.append("scope did not return a manifest")
            continue
        if not {"claims", "non_goals", "threshold", "parameters"} <= set(manifest):
            failures.append(
                "the manifest is missing claims, non-goals, the threshold, or the parameters"
            )
            continue
        claims, non_goals = manifest["claims"], manifest["non_goals"]
        if not isinstance(claims, list) or not isinstance(non_goals, list):
            failures.append("claims and non-goals must each be a list")
            continue
        if (set(claims) | set(non_goals)) - set(CLAIMABLE):
            failures.append("the manifest names a property outside the vocabulary")
        if set(claims) & set(non_goals):
            failures.append("a property is both claimed and disclaimed")
        # Claiming what the build does not do is the failure this checkpoint exists for.
        if set(claims) != set(PROVIDED):
            failures.append("the claims do not match what this construction actually provides")
        if set(non_goals) != set(NOT_PROVIDED):
            failures.append("the non-goals do not match what this construction cannot do")
        if manifest["threshold"] != setting.parties - 1:
            failures.append("the stated coalition threshold is wrong for this many parties")
        if manifest["parameters"] != setting.as_dict():
            failures.append("the manifest records parameters other than the ones it ran on")
    return failures


# ---------------------------------------------------------------------------
# 2. Correctness
# ---------------------------------------------------------------------------


def check_correctness(module: Any, seed: str) -> list[str]:
    failures: list[str] = []
    for setting in _settings(seed):
        for label in ("run", "alt"):
            randomness = sample_randomness(seed, setting, label)
            transcript, error = _call(module, "run", setting, randomness)
            if error:
                failures.append(error)
                break
            if not isinstance(transcript, dict) or "output" not in transcript:
                failures.append("the run produced no output")
                break
            if transcript["output"] != honest_sum(setting):
                failures.append("the protocol did not compute the sum of the inputs")
                break
    return failures


# ---------------------------------------------------------------------------
# 3. Transcript
# ---------------------------------------------------------------------------


def check_transcript(module: Any, seed: str) -> list[str]:
    failures: list[str] = []
    for setting in _settings(seed):
        randomness = sample_randomness(seed, setting)
        transcript, error = _call(module, "run", setting, randomness)
        if error:
            failures.append(error)
            continue
        message = _spec_well_formed(transcript, setting)
        if message:
            failures.append(message)
    return failures


# ---------------------------------------------------------------------------
# 4. Privacy
# ---------------------------------------------------------------------------


def check_privacy(module: Any, seed: str) -> list[str]:
    """The learner's experiment must pass, and their `view` must be an honest one.

    Checking only the experiment would accept a `view` that returns a constant: privacy
    becomes trivially true because the adversary was modelled as seeing nothing.
    """
    failures: list[str] = []
    setting = tiny_settings()[0]
    transcript, error = _call(module, "run", setting, sample_randomness(seed, setting))
    if error:
        return [error]
    if _spec_well_formed(transcript, setting):
        return ["the transcript is not well formed, so the view cannot be checked"]

    for members in (*_coalitions(setting.parties, 1), *_coalitions(setting.parties, 2)):
        observed, error = _call(module, "view", transcript, members)
        if error:
            failures.append(error)
            break
        if not isinstance(observed, dict):
            failures.append("the view is not a record of what the coalition observed")
            break
        expected = _spec_view(transcript, members)
        received = observed.get("received", ())
        public = observed.get("public", ())
        if observed.get("output") != expected["output"]:
            failures.append("the view does not include the output, which everybody sees")
        if set(public) != set(expected["public"]):
            failures.append("the view does not include everything that was opened")
        if len(tuple(received)) != len(expected["received"]):
            failures.append("the view does not carry exactly the messages addressed to the coalition")
    if failures:
        return failures

    if _leaks(module.run, module.view):
        failures.append("a coalition below the threshold can tell two different inputs apart")

    report, error = _call(module, "experiment_privacy")
    if error:
        failures.append(error)
    elif not isinstance(report, dict) or not report.get("ran") or not report.get("passed"):
        failures.append("the privacy experiment did not run, or did not pass")
    else:
        # The claim is that the view is a function of the output, for *every* randomness.
        # A sample supports a weaker claim, so the space actually covered has to be the
        # whole one — which for a toy field is small enough to enumerate.
        whole = setting.modulus**setting.randomness_length
        if report.get("space") != whole:
            failures.append("the privacy experiment covered a sample rather than the whole space")
    return failures


# ---------------------------------------------------------------------------
# 5. Threshold
# ---------------------------------------------------------------------------


def check_threshold(module: Any, seed: str) -> list[str]:
    failures: list[str] = []
    for setting in _settings(seed):
        size, error = _call(module, "threshold", setting.parties)
        if error:
            failures.append(error)
            continue
        if size != setting.parties - 1:
            failures.append("the stated coalition threshold is not where this function stops hiding")
            continue

        randomness = sample_randomness(seed, setting)
        transcript, error = _call(module, "run", setting, randomness)
        if error or _spec_well_formed(transcript, setting):
            failures.append("the run needed for the recovery experiment is not usable")
            continue

        at = tuple(range(size))
        victim = next(party for party in range(setting.parties) if party not in at)
        recovered, error = _call(module, "recover", _spec_view(transcript, at), at, setting)
        if error:
            failures.append(error)
            continue
        if recovered != setting.inputs[victim]:
            failures.append("a coalition at the threshold did not recover the remaining input")
        if size >= 2:
            below = at[:-1]
            answer, error = _call(module, "recover", _spec_view(transcript, below), below, setting)
            if error:
                failures.append(error)
            elif answer is not None:
                failures.append("a coalition below the threshold claimed an input it cannot know")
    return failures


# ---------------------------------------------------------------------------
# 6. Detect — the capstone's own suite, graded against defects it has not seen
# ---------------------------------------------------------------------------


def _mutants(module: Any) -> list[tuple[str, Protocol]]:
    """Broken versions of the learner's own protocol.

    Every one returns a complete transcript. Some break the output, some leave the output
    right and break privacy, and some leave both looking right and break the transcript's
    internal consistency — which is the group a suite that only checks the answer misses.
    """
    run = module.run

    def leaks_an_input(setting: Setting, randomness: tuple[int, ...]) -> Any:
        transcript = run(setting, randomness)
        opened = [dict(entry) for entry in transcript["public"]]
        opened[0] = {"kind": "partial", "value": setting.inputs[0]}
        return {**transcript, "public": opened}

    def opens_raw_shares(setting: Setting, randomness: tuple[int, ...]) -> Any:
        transcript = run(setting, randomness)
        mine = [m for m in transcript["messages"] if m["from"] == 1]
        return {
            **transcript,
            "public": [{"kind": "partial", "value": m["value"]} for m in mine],
            "output": honest_sum(setting),
        }

    def draws_no_randomness(setting: Setting, _randomness: tuple[int, ...]) -> Any:
        return run(setting, (0,) * setting.randomness_length)

    def reuses_one_partys_randomness(setting: Setting, randomness: tuple[int, ...]) -> Any:
        start, end = setting.slice_for(0)
        reused = list(randomness)
        for party in range(setting.parties):
            low, high = setting.slice_for(party)
            reused[low:high] = list(randomness[start:end])
        return run(setting, tuple(reused))

    def reports_the_wrong_sum(setting: Setting, randomness: tuple[int, ...]) -> Any:
        transcript = run(setting, randomness)
        return {**transcript, "output": (transcript["output"] + 1) % setting.modulus}

    def misaddresses_messages(setting: Setting, randomness: tuple[int, ...]) -> Any:
        transcript = run(setting, randomness)
        return {
            **transcript,
            "messages": [{**m, "to": setting.parties + 3} for m in transcript["messages"]],
        }

    def escapes_the_field(setting: Setting, randomness: tuple[int, ...]) -> Any:
        transcript = run(setting, randomness)
        head, *rest = transcript["messages"]
        return {**transcript, "messages": [{**head, "value": head["value"] + setting.modulus}, *rest]}

    def does_not_reconstruct(setting: Setting, randomness: tuple[int, ...]) -> Any:
        transcript = run(setting, randomness)
        return {
            **transcript,
            "messages": [
                {**m, "value": (m["value"] * 2) % setting.modulus} for m in transcript["messages"]
            ],
            "output": honest_sum(setting),
        }

    def drops_a_message(setting: Setting, randomness: tuple[int, ...]) -> Any:
        transcript = run(setting, randomness)
        return {**transcript, "messages": transcript["messages"][:-1]}

    return [
        ("leaks an input into the opened values", leaks_an_input),
        ("opens an honest party's raw shares", opens_raw_shares),
        ("draws no randomness at all", draws_no_randomness),
        ("gives every party the same randomness", reuses_one_partys_randomness),
        ("reports a sum that is not the sum", reports_the_wrong_sum),
        ("addresses messages to a party that is not playing", misaddresses_messages),
        ("emits a value outside the field", escapes_the_field),
        ("returns a transcript that does not reconstruct its own output", does_not_reconstruct),
        ("drops a message", drops_a_message),
    ]


def check_detect(module: Any, _seed: str) -> list[str]:
    if not hasattr(module, "run"):
        return ["run is not defined"]
    verdict, error = _call(module, "detects", module.run)
    if error:
        return [error]
    if verdict is not False:
        # A detector that flags everything is not a detector.
        return ["the suite reports the submission's own protocol as broken"]

    failures: list[str] = []
    for name, mutant in _mutants(module):
        verdict, error = _call(module, "detects", mutant)
        if error:
            failures.append(error)
            break
        if verdict is not True:
            failures.append(f"the suite does not notice a protocol that {name}")
    return failures


# ---------------------------------------------------------------------------
# 7. Measurement
# ---------------------------------------------------------------------------


def check_measure(module: Any, seed: str) -> list[str]:
    failures: list[str] = []
    for setting in _settings(seed):
        report, error = _call(module, "measure", setting, seed)
        if error:
            failures.append(error)
            continue
        if not isinstance(report, dict):
            failures.append("measure did not return a measurement")
            continue
        if not {"rounds", "messages", "opened", "unit", "environment"} <= set(report):
            failures.append("the measurement is missing a count, its unit, or its environment")
            continue
        transcript, error = _call(module, "run", setting, sample_randomness(seed, setting))
        if error or not isinstance(transcript, dict):
            failures.append("the run the measurement should have counted is not usable")
            continue
        # A number written by hand is a claim about the design. Only a number counted off a
        # real transcript is a claim about the build.
        if report["rounds"] != transcript.get("rounds"):
            failures.append("the reported round count is not the one the run took")
        if report["messages"] != len(transcript.get("messages", [])):
            failures.append("the reported message count is not the one the run sent")
        if report["opened"] != len(transcript.get("public", [])):
            failures.append("the reported opened-value count is not the one the run opened")
        if not str(report["unit"]).strip():
            failures.append("the measurement states no unit")
        if not str(report["environment"]).strip():
            failures.append("the measurement states no environment")
    return failures


# ---------------------------------------------------------------------------
# 8. Evidence
# ---------------------------------------------------------------------------


def check_evidence(module: Any, seed: str) -> list[str]:
    failures: list[str] = []
    setting = public_setting(seed)
    bundle, error = _call(module, "evidence", setting, seed)
    if error:
        return [error]
    if not isinstance(bundle, dict):
        return ["evidence did not return a bundle"]

    if set(bundle) - set(CLAIMABLE):
        failures.append("the bundle reports on something that is not a property")
    if not set(PROVIDED) <= set(bundle):
        failures.append("a claimed property has no entry in the bundle")
    # A bundle that quietly omits what the build cannot do reads exactly like one with
    # nothing left to hide. The non-goals have to appear, marked as unclaimed.
    if not set(NOT_PROVIDED) <= set(bundle):
        failures.append("the bundle omits a property the build does not provide")

    for name, row in bundle.items():
        if not isinstance(row, dict) or not {"claimed", "experiment", "verdict", "limitation"} <= set(row):
            failures.append(
                "an entry is missing whether it is claimed, its experiment, its verdict, or its limitation"
            )
            continue
        if not str(row["limitation"]).strip():
            failures.append("an entry records no limitation")
        if row["claimed"]:
            if name not in PROVIDED:
                failures.append("the bundle claims a property this construction does not provide")
            if not str(row["experiment"]).strip():
                failures.append("a claimed property cites no experiment")
            if row["verdict"] is not True:
                failures.append("a claimed property has no passing experiment behind it")
        elif row["verdict"] is True:
            failures.append("a property that is not claimed reports a passing verdict")
    return failures


# ---------------------------------------------------------------------------


CHECKS = (
    check_scope,
    check_correctness,
    check_transcript,
    check_privacy,
    check_threshold,
    check_detect,
    check_measure,
    check_evidence,
)


def run(module: Any, seed: str) -> list[str]:
    """Every checkpoint at once. Empty means the whole problem passes."""
    failures: list[str] = []
    for check in CHECKS:
        failures.extend(check(module, seed))
    return failures
