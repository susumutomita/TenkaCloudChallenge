"""Hidden tests. Run by /verify against a copy of the learner's auditor.py.

Two shapes of wrong answer are equally fatal here and both are checked everywhere:

  * an auditor that flags nothing passes every clean case and finds no leak;
  * an auditor that flags everything finds every leak and condemns every clean run.

So every checkpoint below mixes leaking and clean programs, and the clean ones are the
awkward kind -- a log line carrying a value the specification publishes, and a party
reading its own slot. Reporting a violation on those is as wrong as missing a real one.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from fixtures.generate import (  # noqa: E402
    PROGRAM_IDS,
    TRUTH,
    execute,
    expected_total,
    program,
    rename_tag,
    renamed,
    reordered,
    spec,
    spec_as_public,
)

LABELS = ("h0", "h1", "h2")


def _run(seed: str, label: str, program_id: str):
    sp = spec(seed, label)
    return sp, spec_as_public(sp), execute(program(sp, program_id), sp)


def _expected_index(sp, program_id: str) -> int:
    """Where the violation actually sits, computed from the run rather than assumed."""
    run = execute(program(sp, program_id), sp)
    allowed = {*sp.public_inputs, *sp.masked, sp.result}
    for index, event in enumerate(run.events):
        kind = event["kind"]
        if kind == "open" and event["label"] not in allowed:
            return index
        if kind == "peek" and event["party"] != event["owner"]:
            return index
        if kind in ("emit", "fail") and event["label"] not in allowed:
            return index
    return -1


def _leaks(run, sp) -> bool:
    """Ground truth, computed here rather than by asking the learner's own auditor.

    Judging a repair with the submission's `first_violation` would be circular: an
    auditor that never reports anything would certify its own repairs.
    """
    allowed = {*sp.public_inputs, *sp.masked, sp.result}
    for event in run.events:
        kind = event["kind"]
        if kind == "open" and event["label"] not in allowed:
            return True
        if kind == "peek" and event["party"] != event["owner"]:
            return True
        if kind in ("emit", "fail") and event["label"] not in allowed:
            return True
    return False


def _verdict(module, run, public_spec) -> object:
    return module.first_violation(list(run.events), dict(public_spec))


def _check_programs(module, seed: str, program_ids: tuple[str, ...]) -> list[str]:
    failures: list[str] = []
    for label in LABELS:
        for program_id in program_ids:
            sp, public_spec, run = _run(seed, label, program_id)
            expected = TRUTH[program_id]
            try:
                got = _verdict(module, run, public_spec)
            except Exception as error:  # noqa: BLE001
                return [f"first_violation raised {type(error).__name__}"]
            if expected is None:
                if got is not None:
                    failures.append("a run that leaks nothing was reported as a violation")
                continue
            if not isinstance(got, dict):
                failures.append("a leaking run was reported as clean")
                continue
            if got.get("kind") != expected:
                failures.append("the violation was found but named as the wrong kind")
            if got.get("index") != _expected_index(sp, program_id):
                failures.append("the violation was named but not located at the right event")
    return failures


def check_allowed(module, seed: str) -> list[str]:
    failures: list[str] = []
    for label in LABELS:
        sp = spec(seed, label)
        public_spec = spec_as_public(sp)
        try:
            got = module.allowed_opens(dict(public_spec))
        except Exception as error:  # noqa: BLE001
            return [f"allowed_opens raised {type(error).__name__}"]
        if not isinstance(got, list) or any(not isinstance(item, str) for item in got):
            failures.append("allowed_opens did not return a list of labels")
            continue
        if sorted(got) != sorted(sp.allowed_opens()):
            failures.append("the allowed-open set does not match the specification")
    return failures


def check_opened_secret(module, seed: str) -> list[str]:
    return _check_programs(module, seed, ("alpha", "bravo", "foxtrot"))


def check_cross_party(module, seed: str) -> list[str]:
    return _check_programs(module, seed, ("alpha", "charlie", "golf"))


def check_log_leak(module, seed: str) -> list[str]:
    return _check_programs(module, seed, ("alpha", "delta", "echo", "foxtrot"))


def check_transcript(module, seed: str) -> list[str]:
    """The counterexample: naming the extra opening is not the same as showing it hurt."""
    failures: list[str] = []
    for label in LABELS:
        sp = spec(seed, label)
        public_spec = spec_as_public(sp)
        run = execute(program(sp, "bravo"), sp)
        try:
            got = module.derive_secret(list(run.transcript), dict(public_spec))
        except Exception as error:  # noqa: BLE001
            return [f"derive_secret raised {type(error).__name__}"]
        if not isinstance(got, dict) or "party" not in got or "value" not in got:
            failures.append("derive_secret did not name a party and a value")
            continue
        party = got["party"]
        if party not in sp.parties:
            failures.append("derive_secret named something that is not a party")
            continue
        if got["value"] != sp.private[party]:
            failures.append("the recovered value is not that party's private input")
    return failures


def check_repair(module, seed: str) -> list[str]:
    """Repaired programs must stay correct, stop leaking, and keep every legal opening.

    That last condition is what stops "delete the protocol" from counting as a repair:
    an empty program leaks nothing and can still be made to output the total.
    """
    failures: list[str] = []
    for label in LABELS:
        sp = spec(seed, label)
        public_spec = spec_as_public(sp)
        clean = execute(program(sp, "alpha"), sp)
        for program_id in PROGRAM_IDS:
            try:
                fixed = module.repair(list(program(sp, program_id)), dict(public_spec))
                run = execute(list(fixed), sp)
            except Exception as error:  # noqa: BLE001
                return [f"repairing a program raised {type(error).__name__}"]
            if run.output != expected_total(sp):
                failures.append("the repaired program no longer computes the right total")
                continue
            if _leaks(run, sp):
                failures.append("the repaired program still leaks")
            repaired_labels = [entry["label"] for entry in run.transcript]
            clean_labels = [entry["label"] for entry in clean.transcript]
            if any(label not in repaired_labels for label in clean_labels):
                failures.append("the repair removed something the specification allows")
            elif run.transcript != clean.transcript:
                failures.append("the repaired program still reveals something extra")
    return failures


def check_mutation(module, seed: str) -> list[str]:
    """Same protocols, every label renamed and the independent openings moved.

    Nothing about the verdict changes. An auditor keyed on literal label text, or on
    where in the trace a violation sat last time, disagrees with itself here.
    """
    failures: list[str] = []
    for label in LABELS:
        sp = spec(seed, label)
        tag = rename_tag(seed, label)
        for program_id in PROGRAM_IDS:
            ops, moved = renamed(reordered(program(sp, program_id)), sp, tag)
            run = execute(ops, moved)
            public_spec = spec_as_public(moved)
            expected = TRUTH[program_id]
            try:
                got = _verdict(module, run, public_spec)
            except Exception as error:  # noqa: BLE001
                return [f"first_violation raised {type(error).__name__} on a renamed program"]
            if expected is None and got is not None:
                failures.append("a renamed clean run was reported as a violation")
            elif expected is not None and (not isinstance(got, dict) or got.get("kind") != expected):
                failures.append("renaming the labels changed the verdict")
    return failures


def run(module, seed: str) -> list[str]:
    return [
        *check_allowed(module, seed),
        *check_opened_secret(module, seed),
        *check_cross_party(module, seed),
        *check_log_leak(module, seed),
        *check_transcript(module, seed),
        *check_repair(module, seed),
        *check_mutation(module, seed),
    ]
