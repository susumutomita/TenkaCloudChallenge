"""Break the reference eleven intended ways and require the hidden suite to notice."""

from __future__ import annotations

import sys
import types
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from fixtures.generate import public_cases
from tests.hidden import check_report

SEED = "transaction-visibility-mutation-seed"
REFERENCE = (Path(__file__).parent / "reference" / "report.py").read_text(encoding="utf-8")


def _function(body: str) -> str:
    return (
        "from __future__ import annotations\n\n"
        "def build_report(ledger, account_ids):\n"
        + "\n".join(f"    {line}" if line else "" for line in body.splitlines())
        + "\n"
    )


PUBLIC_CASE = public_cases(SEED)[0]
PUBLIC_IDS = list(PUBLIC_CASE.account_ids)
PUBLIC_TOTAL = PUBLIC_CASE.starting_revision.total

MUTANTS: tuple[tuple[str, str], ...] = (
    (
        "latest-per-row",
        _function(
            """ids = tuple(account_ids)
reads = [ledger.read_committed(account_id) for account_id in ids]
balances = {read.account_id: read.balance for read in reads}
return {"revision": reads[-1].revision, "balances": balances, "total": sum(balances.values())}"""
        ),
    ),
    (
        "snapshot-per-row",
        _function(
            """ids = tuple(account_ids)
snapshots = [ledger.snapshot() for _account_id in ids]
balances = {account_id: snapshot.read(account_id) for account_id, snapshot in zip(ids, snapshots)}
return {"revision": snapshots[0].revision, "balances": balances, "total": sum(balances.values())}"""
        ),
    ),
    (
        "snapshot-after-first-row",
        _function(
            """ids = tuple(account_ids)
first = ledger.read_committed(ids[0])
snapshot = ledger.snapshot()
balances = {ids[0]: first.balance}
balances.update({account_id: snapshot.read(account_id) for account_id in ids[1:]})
return {"revision": snapshot.revision, "balances": balances, "total": sum(balances.values())}"""
        ),
    ),
    (
        "snapshot-then-live-reads",
        _function(
            """ids = tuple(account_ids)
snapshot = ledger.snapshot()
reads = [ledger.read_committed(account_id) for account_id in ids]
balances = {read.account_id: read.balance for read in reads}
return {"revision": snapshot.revision, "balances": balances, "total": sum(balances.values())}"""
        ),
    ),
    (
        "wrong-report-revision",
        _function(
            """ids = tuple(account_ids)
snapshot = ledger.snapshot()
balances = {account_id: snapshot.read(account_id) for account_id in ids}
return {"revision": ledger.current_revision, "balances": balances, "total": sum(balances.values())}"""
        ),
    ),
    (
        "hardcoded-public-total",
        _function(
            f"""ids = tuple(account_ids)
snapshot = ledger.snapshot()
balances = {{account_id: snapshot.read(account_id) for account_id in ids}}
return {{"revision": snapshot.revision, "balances": balances, "total": {PUBLIC_TOTAL}}}"""
        ),
    ),
    (
        "refuse-when-a-commit-is-scheduled",
        _function(
            """if ledger.has_pending_commits:
    raise RuntimeError("report unavailable while a writer is active")
ids = tuple(account_ids)
snapshot = ledger.snapshot()
balances = {account_id: snapshot.read(account_id) for account_id in ids}
return {"revision": snapshot.revision, "balances": balances, "total": sum(balances.values())}"""
        ),
    ),
    (
        "hardcoded-public-account-ids",
        _function(
            f"""ids = {PUBLIC_IDS!r}
snapshot = ledger.snapshot()
balances = {{account_id: snapshot.read(account_id) for account_id in ids}}
return {{"revision": snapshot.revision, "balances": balances, "total": sum(balances.values())}}"""
        ),
    ),
    (
        "reader-wide-writer-freeze",
        _function(
            """ids = tuple(account_ids)
snapshot = ledger.snapshot(exclusive=True)
balances = {account_id: snapshot.read(account_id) for account_id in ids}
return {"revision": snapshot.revision, "balances": balances, "total": sum(balances.values())}"""
        ),
    ),
)

# These two tempting workarounds were identified separately from the original suite.
# Pin the hidden phase that must kill each one, so a later broad-phase failure cannot
# conceal a regression in the property intended to catch it.
TARGETED_MUTANTS: tuple[tuple[str, str, str], ...] = (
    (
        "ttl-wait",
        _function(
            """ids = tuple(account_ids)
# Deterministically model "wait out the cache TTL" by burning scheduled live reads.
# Time passing still cannot make separate reads one atomic observation.
while ledger.has_pending_commits:
    ledger.read_committed(ids[0])
snapshot = ledger.snapshot()
balances = {account_id: snapshot.read(account_id) for account_id in ids}
return {"revision": snapshot.revision, "balances": balances, "total": sum(balances.values())}"""
        ),
        "check_snapshot",
    ),
    (
        "pre-commit-invalidate",
        _function(
            """ids = tuple(account_ids)
snapshot = ledger.snapshot()
balances = {}
for account_id in ids:
    if ledger.has_pending_commits:
        snapshot = ledger.snapshot()
    balances[account_id] = snapshot.read(account_id)
return {"revision": snapshot.revision, "balances": balances, "total": sum(balances.values())}"""
        ),
        "check_snapshot",
    ),
)


def _load(source: str) -> types.ModuleType:
    module = types.ModuleType("report_mutant")
    module.__dict__["__file__"] = "<report-mutant>"
    exec(compile(source, "<report-mutant>", "exec"), module.__dict__)  # noqa: S102
    return module


def main() -> int:
    reference = _load(REFERENCE)
    baseline = check_report.run(reference, SEED)
    if baseline:
        print("the reference does not pass its hidden suite:")
        for failure in baseline:
            print(f"  {failure}")
        return 1
    print("reference: passes")

    survivors: list[str] = []
    for name, source in MUTANTS:
        try:
            failures = check_report.run(_load(source), SEED)
        except Exception as error:  # noqa: BLE001 - an un-runnable mutant is killed
            failures = [type(error).__name__]
        if failures:
            print(f"killed  {name}")
        else:
            print(f"SURVIVED {name}")
            survivors.append(name)

    for name, source, phase in TARGETED_MUTANTS:
        try:
            failures = getattr(check_report, phase)(_load(source), SEED)
        except Exception as error:  # noqa: BLE001 - an un-runnable mutant is killed
            failures = [type(error).__name__]
        if failures:
            print(f"killed  {name} [{phase}]")
        else:
            print(f"SURVIVED {name} [{phase}]")
            survivors.append(name)

    print()
    if survivors:
        print(f"{len(survivors)} mutation(s) survived:")
        for name in survivors:
            print(f"  {name}")
        return 1
    print(f"all {len(MUTANTS) + len(TARGETED_MUTANTS)} mutations killed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
