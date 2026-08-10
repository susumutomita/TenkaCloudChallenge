"""Hidden case construction for the snapshot and transfer phases.

The participant image receives the public ledger model and evidence generator, but
Docker never copies this module into that image. This keeps unseen schedules out of
the public artifact while reusing the same deterministic revision model.
"""

from __future__ import annotations

from fixtures.generate import ReportCase, _history


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
