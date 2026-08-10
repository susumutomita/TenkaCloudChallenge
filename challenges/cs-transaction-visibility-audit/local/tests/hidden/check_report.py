"""Hidden properties for reports built while deterministic commits progress."""

from __future__ import annotations

from typing import Iterable, Protocol

from fixtures.generate import ReportCase, _history


# hidden case の構築。 以前は `tests/hidden/cases.py` に分けていたが、 scaffold leftover
# guard が hidden に check module 1 本だけを許すため、 ここへ畳んだ。 参加者 image へは
# Docker が tests/hidden ごと入れないので、 未知の schedule が公開物へ出ないことは変わらない。
def snapshot_cases(seed: str) -> tuple[ReportCase, ...]:
    """Same accounts in three orders, with one commit during the report."""
    history = _history(f"{seed}:snapshot")
    accounts = tuple(history[0].balances)
    rotations = (
        accounts,
        accounts[1:] + accounts[:1],
        tuple(reversed(accounts)),
    )
    return tuple(
        ReportCase(
            f"snapshot-{index}",
            history[:2],
            order,
            commit_after_reads=(1,),
        )
        for index, order in enumerate(rotations)
    )


def transfer_cases(seed: str) -> tuple[ReportCase, ...]:
    """Unseen IDs, orders, revision gaps, and two commits for transfer testing."""
    history = _history(f"{seed}:transfer")
    accounts = tuple(history[0].balances)
    return (
        ReportCase("two commits", history, accounts, commit_after_reads=(1, 3)),
        ReportCase(
            "reverse order",
            history,
            tuple(reversed(accounts)),
            commit_after_reads=(2, 3),
        ),
        ReportCase(
            "subset and reorder",
            history,
            (accounts[2], accounts[0], accounts[3]),
            commit_after_reads=(1, 2),
        ),
    )

class Submission(Protocol):
    def build_report(self, ledger: object, account_ids: Iterable[str]) -> dict[str, object]: ...


def _case_failures(module: Submission, case: ReportCase) -> list[str]:
    ledger = case.ledger()
    try:
        result = module.build_report(ledger, case.account_ids)
    except Exception as error:  # noqa: BLE001 - a report failure is a failed property
        return [f"raised {type(error).__name__} while a report was being built"]

    if not isinstance(result, dict):
        return ["did not return a report object"]
    if set(result) != {"revision", "balances", "total"}:
        return ["the report does not have exactly revision, balances, and total"]
    if type(result["revision"]) is not int:
        return ["the report revision is not an integer"]
    balances = result["balances"]
    if not isinstance(balances, dict):
        return ["balances is not an object"]
    if list(balances) != list(case.account_ids):
        return ["the report did not preserve the requested account IDs and order"]
    if any(type(value) is not int for value in balances.values()):
        return ["a returned balance is not an integer"]
    if type(result["total"]) is not int or result["total"] != sum(balances.values()):
        return ["total is not the sum of the returned balances"]

    expected_state = case.starting_revision
    expected_balances = {
        account: expected_state.balances[account] for account in case.account_ids
    }
    failures: list[str] = []
    if result["revision"] != expected_state.number:
        failures.append("the displayed revision is not the revision captured for the report")
    if balances != expected_balances:
        failures.append("the balances do not all come from the report's captured revision")

    events = ledger.events
    snapshots = [event for event in events if event.get("kind") == "snapshot"]
    snapshot_reads = [event for event in events if event.get("kind") == "snapshot-read"]
    live_reads = [event for event in events if event.get("kind") == "read-committed"]
    if len(snapshots) != 1:
        failures.append("the report did not use exactly one snapshot")
    elif snapshots[0].get("exclusive") is not False:
        failures.append("the report stopped writers instead of using a non-exclusive snapshot")
    if live_reads:
        failures.append("at least one report row was read from the moving live revision")
    if [event.get("accountId") for event in snapshot_reads] != list(case.account_ids):
        failures.append("the one snapshot was not used once for every requested account")
    if any(event.get("revision") != expected_state.number for event in snapshot_reads):
        failures.append("snapshot rows did not retain one revision")
    if ledger.commits_completed != case.expected_commits:
        failures.append("scheduled writers did not continue while the report was read")
    return failures


def _phase(module: Submission, cases: Iterable[ReportCase]) -> list[str]:
    failures: list[str] = []
    for case in cases:
        for failure in _case_failures(module, case):
            failures.append(f"{case.name}: {failure}")
    return failures


def check_snapshot(module: Submission, seed: str) -> list[str]:
    return _phase(module, snapshot_cases(seed))


def check_transfer(module: Submission, seed: str) -> list[str]:
    return _phase(module, transfer_cases(seed))


def run(module: Submission, seed: str) -> list[str]:
    return check_snapshot(module, seed) + check_transfer(module, f"{seed}:unseen")
