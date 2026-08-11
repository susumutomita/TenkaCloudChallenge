"""Direct-answer mirrors for cs-numeric-aggregation-order."""


def _majority_total(server, seed):
    runs = server.reconciliation_runs(seed)
    return max(
        {row["reportedTotal"] for row in runs},
        key=lambda total: sum(1 for row in runs if row["reportedTotal"] == total),
    )


def _observe_expected(server, seed):
    return [server.disputed_report(seed)["reportId"], "order-dependent"]


def _audit_expected(server, seed):
    majority = _majority_total(server, seed)
    return [
        index
        for index, row in enumerate(server.reconciliation_runs(seed))
        if row["reportedTotal"] != majority
    ]


EXPECTED = {
    "environment": lambda server, seed: server.health_token(seed),
    "observe": _observe_expected,
    "audit": _audit_expected,
}


def _observe_visible(server, seed):
    report = server.disputed_report(seed)
    return {"reportId": report["reportId"], "lineItems": report["lineItems"]}


def _audit_visible(server, seed):
    runs = server.reconciliation_runs(seed)
    return {
        "runCount": len(runs),
        "distinctTotals": sorted({row["reportedTotal"] for row in runs}),
    }


VISIBLE = {
    "environment": lambda server, seed: {"healthToken": server.health_token(seed)},
    "observe": _observe_visible,
    "audit": _audit_visible,
}
