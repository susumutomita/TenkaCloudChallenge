"""Hidden tests. Run by /verify against a copy of the learner's aggregate.py.

Correctness, privacy and cost are checked separately and on purpose. A submission can
be correct and expensive, correct and leaky, or private and wrong, and a suite that
folds them into one verdict cannot tell the learner which of those they built.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from fixtures.generate import (  # noqa: E402
    ForbiddenOpen,
    Protocol,
    inputs_shared,
    plain_score,
    reconstruct,
    setting,
    shares_of,
    triples,
)

LABELS = ("h0", "h1", "h2")


def _case(seed: str, label: str):
    st = setting(seed, label)
    shared = inputs_shared(seed, label, st)
    triple_list = [
        {"a": t.a, "b": t.b, "c": t.c} for t in triples(seed, label, st, st.parties)
    ]
    return st, shared, triple_list


def _run(module, seed: str, label: str):
    st, shared, triple_list = _case(seed, label)
    io = Protocol(p=st.p)
    out = module.aggregate(
        [list(s) for s in shared["counts"]],
        [list(s) for s in shared["severities"]],
        [dict(t) for t in triple_list],
        st.as_public(),
        io,
    )
    return st, io, out


def _valid_sharing(value: object, n: int, p: int) -> bool:
    return (
        isinstance(value, list)
        and len(value) == n
        and all(isinstance(v, int) and not isinstance(v, bool) and 0 <= v < p for v in value)
    )


def check_plan(module, seed: str) -> list[str]:
    failures: list[str] = []
    for label in LABELS:
        st = setting(seed, label)
        try:
            got = module.plan(st.as_public())
        except Exception as error:  # noqa: BLE001
            return [f"plan raised {type(error).__name__}"]
        if not isinstance(got, dict):
            failures.append("plan did not return a cost estimate")
            continue
        if got.get("multiplications") != st.parties:
            failures.append("the number of multiplications does not match the expression")
        if got.get("triples") != st.parties:
            failures.append("the number of triples does not match the multiplications")
        if got.get("rounds") != 1:
            # This is the misconception the checkpoint exists for: the openings are
            # independent, so the round count is not the multiplication count.
            failures.append("the round estimate does not account for batching")
    return failures


def check_share_inputs(module, seed: str) -> list[str]:
    failures: list[str] = []
    for label in LABELS:
        st = setting(seed, label)
        secrets = list(st.counts)
        randoms = [
            shares_of(seed, f"{label}-r{i}", 0, st.parties, st.p)[: st.parties - 1]
            for i in range(len(secrets))
        ]
        try:
            got = module.share_inputs(list(secrets), [list(r) for r in randoms], st.p)
        except Exception as error:  # noqa: BLE001
            return [f"share_inputs raised {type(error).__name__}"]
        if not isinstance(got, list) or len(got) != len(secrets):
            failures.append("share_inputs did not return one sharing per secret")
            continue
        for index, sharing in enumerate(got):
            if not _valid_sharing(sharing, st.parties, st.p):
                failures.append("a sharing does not have one canonical element per party")
                break
            if reconstruct(sharing, st.p) != secrets[index] % st.p:
                failures.append("a sharing does not reconstruct to its secret")
                break
            if list(sharing[: st.parties - 1]) != [v % st.p for v in randoms[index]]:
                failures.append("the sharing ignored the randomness it was given")
                break
    return failures


def check_add_public(module, seed: str) -> list[str]:
    """The public-constant rule again, now inside a bigger protocol."""
    failures: list[str] = []
    for label in LABELS:
        st = setting(seed, label)
        if st.parties < 2:
            continue
        secret = st.counts[0]
        sharing = shares_of(seed, f"{label}-addpub", secret, st.parties, st.p)
        try:
            got = module.add_public(list(sharing), st.bias, st.p)
        except Exception as error:  # noqa: BLE001
            return [f"add_public raised {type(error).__name__}"]
        if not _valid_sharing(got, st.parties, st.p):
            failures.append("add_public did not return one canonical element per party")
            continue
        total = reconstruct(got, st.p)
        if total != (secret + st.bias) % st.p:
            failures.append("adding a public constant did not shift the value by it")
        if total == (secret + st.parties * st.bias) % st.p and st.bias % st.p:
            failures.append("the public constant was added to every share instead of one")
    return failures


def check_correct(module, seed: str) -> list[str]:
    failures: list[str] = []
    for label in LABELS:
        try:
            st, _io, out = _run(module, seed, label)
        except ForbiddenOpen as error:
            return [f"the protocol tried to reveal something it may not: {error}"]
        except Exception as error:  # noqa: BLE001
            return [f"the protocol raised {type(error).__name__}"]
        if not _valid_sharing(out, st.parties, st.p):
            failures.append("the protocol did not return a valid sharing of the score")
            continue
        if reconstruct(out, st.p) != plain_score(st):
            failures.append("the score does not match the plain computation")
    return failures


def check_privacy(module, seed: str) -> list[str]:
    """The masked differences, and exactly those, may be revealed on the way.

    The check is an exact multiset match against the differences the supplied triples
    imply -- not a blacklist. That is what catches reusing one triple for every product:
    reuse still computes the right score, so correctness says nothing, but the same mask
    then covers two secrets and their difference falls straight out of the transcript.
    """
    failures: list[str] = []
    for label in LABELS:
        st, _shared, _triple_list = _case(seed, label)
        raw = triples(seed, label, st, st.parties)
        expected: list[int] = []
        for index in range(st.parties):
            a = reconstruct(list(raw[index].a), st.p)
            b = reconstruct(list(raw[index].b), st.p)
            expected.append((st.counts[index] - a) % st.p)
            expected.append((st.severities[index] - b) % st.p)

        try:
            _st, io, out = _run(module, seed, label)
        except ForbiddenOpen:
            failures.append("the protocol tried to reveal something it may not")
            continue
        except Exception as error:  # noqa: BLE001
            return [f"the protocol raised {type(error).__name__}"]

        secrets = {value % st.p for value in (*st.counts, *st.severities)}
        secrets.add(plain_score(st))
        running = 0
        for count, severity in zip(st.counts, st.severities):
            running = (running + count * severity) % st.p
            secrets.add(running)

        opened = [reconstruct(list(sharing), st.p) for sharing in io.opened]
        if sorted(opened) == sorted(expected):
            continue
        if any(value in secrets for value in opened):
            failures.append("the run revealed a value it was supposed to protect")
        elif len(opened) != len(expected):
            failures.append("the run opened a different number of values than the products need")
        else:
            # Right count, wrong values: the openings do not line up with one distinct
            # triple per product. Reusing a triple lands here.
            failures.append("an opened value does not match any product's own masked difference")
    return failures


def check_cost(module, seed: str) -> list[str]:
    """The estimate has to match the measurement, in both directions."""
    failures: list[str] = []
    for label in LABELS:
        try:
            st, io, _out = _run(module, seed, label)
        except Exception as error:  # noqa: BLE001
            return [f"the protocol raised {type(error).__name__}"]
        try:
            claimed = module.plan(st.as_public())
        except Exception as error:  # noqa: BLE001
            return [f"plan raised {type(error).__name__}"]
        if io.rounds != 1:
            failures.append("the openings were not batched into a single round")
        if not isinstance(claimed, dict) or claimed.get("rounds") != io.rounds:
            failures.append("the claimed round count does not match what the run cost")
        if sum(io.batch_sizes) != 2 * st.parties:
            # Two openings per multiplication, no more and no fewer. Fewer means a
            # triple was reused; more means something extra was revealed.
            failures.append("the number of opened sharings does not match one triple per product")
    return failures


def check_metamorphic(module, seed: str) -> list[str]:
    """Relations between runs, rather than one expected number.

    A memorized answer satisfies a fixed expectation. It does not survive three runs
    that must agree with each other in specific ways: fresh randomness must not move the
    score, reversing the organizations must not move it, and moving one organization's
    count by a known amount must move it by that amount times their severity.
    """
    failures: list[str] = []
    for label in LABELS:
        st, shared, triple_list = _case(seed, label)

        def score(counts, severities) -> object:
            io = Protocol(p=st.p)
            out = module.aggregate(
                [list(s) for s in counts],
                [list(s) for s in severities],
                [dict(t) for t in triple_list],
                st.as_public(),
                io,
            )
            return out if _valid_sharing(out, st.parties, st.p) else None

        try:
            base = score(shared["counts"], shared["severities"])
        except Exception as error:  # noqa: BLE001
            return [f"the protocol raised {type(error).__name__}"]
        if base is None:
            failures.append("the protocol did not return a valid sharing of the score")
            continue
        base_value = reconstruct(base, st.p)

        reshared = [
            shares_of(seed, f"{label}-re-c{i}", value, st.parties, st.p)
            for i, value in enumerate(st.counts)
        ]
        again = score(reshared, shared["severities"])
        if again is None or reconstruct(again, st.p) != base_value:
            failures.append("re-sharing the same inputs with fresh randomness changed the score")

        flipped = score(list(reversed(shared["counts"])), list(reversed(shared["severities"])))
        if flipped is None or reconstruct(flipped, st.p) != base_value:
            failures.append("reversing the organizations changed the score")

        # Move one organization's count by a known amount; the score must move by that
        # amount times their severity, and by nothing else.
        delta = 3
        bumped = list(shared["counts"])
        bumped[0] = shares_of(
            seed, f"{label}-bump", (st.counts[0] + delta) % st.p, st.parties, st.p
        )
        moved = score(bumped, shared["severities"])
        want = (base_value + delta * st.severities[0]) % st.p
        if moved is None or reconstruct(moved, st.p) != want:
            failures.append("changing one input did not move the score by the expected amount")
    return failures


def run(module, seed: str) -> list[str]:
    return [
        *check_plan(module, seed),
        *check_share_inputs(module, seed),
        *check_add_public(module, seed),
        *check_correct(module, seed),
        *check_privacy(module, seed),
        *check_cost(module, seed),
        *check_metamorphic(module, seed),
    ]
