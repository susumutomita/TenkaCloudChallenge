"""Hidden derivation of the two seed-bound direct answers.

The participant image carries the evidence generator but never this module.  These
helpers derive answers from the same public evidence instead of placing answer-labelled
fields or fixed values in the participant artifact.
"""

from __future__ import annotations

from fixtures.generate import audit_fixture, counterexample_fixture


def audit_expected(seed: str) -> dict[str, object]:
    fixture = audit_fixture(seed)
    committed = fixture["committed"]
    reports = fixture["reports"]
    assert isinstance(committed, list) and isinstance(reports, list)

    impossible: list[dict[str, object]] = []
    for report in reports:
        assert isinstance(report, dict)
        reads = report.get("reads")
        assert isinstance(reads, list)
        observed = {
            str(read["accountId"]): int(read["balance"])
            for read in reads
            if isinstance(read, dict)
        }
        if not any(
            isinstance(state, dict) and state.get("balances") == observed
            for state in committed
        ):
            impossible.append(report)

    if len(impossible) != 1:
        raise AssertionError("audit fixture must contain exactly one impossible report")
    report = impossible[0]
    reads = report["reads"]
    assert isinstance(reads, list)
    revisions = list(
        dict.fromkeys(
            int(read["revision"])
            for read in reads
            if isinstance(read, dict)
        )
    )
    return {"reportId": report["reportId"], "observedRevisions": revisions}


def counterexample_expected(seed: str) -> dict[str, object]:
    fixture = counterexample_fixture(seed)
    order = fixture["readOrder"]
    cut = fixture["commitAfterRead"]
    candidates = fixture["candidates"]
    assert isinstance(order, list) and type(cut) is int and isinstance(candidates, list)
    before = order[:cut]
    after = order[cut:]
    crossing = [
        candidate
        for candidate in candidates
        if isinstance(candidate, dict)
        and (candidate.get("source") in before) != (candidate.get("destination") in before)
    ]
    if len(crossing) != 1:
        raise AssertionError("counterexample fixture must contain exactly one crossing transfer")
    return {
        "beforeCommit": before,
        "commit": crossing[0]["transferId"],
        "afterCommit": after,
    }
