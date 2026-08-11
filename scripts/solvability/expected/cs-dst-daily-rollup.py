"""Direct-answer mirrors for cs-dst-daily-rollup."""


def _observe_expected(server, seed):
    return [server.reported_zone(seed)["reportId"], "not-24-hours"]


def _audit_expected(server, seed):
    return [
        index
        for index, row in enumerate(server.daily_report(seed))
        if row["reportedTotal"] != row["ledgerTotal"]
    ]


EXPECTED = {
    "environment": lambda server, seed: server.health_token(seed),
    "observe": _observe_expected,
    "audit": _audit_expected,
}


def _observe_visible(server, seed):
    zone = server.reported_zone(seed)
    return {
        "reportId": zone["reportId"],
        "timezone": zone["timezone"],
        "rows": server.daily_report(seed)[:4],
    }


def _audit_visible(server, seed):
    rows = server.daily_report(seed)
    return {
        "timezone": server.reported_zone(seed)["timezone"],
        "rowCount": len(rows),
        "reportedTotals": [row["reportedTotal"] for row in rows],
        "ledgerTotals": [row["ledgerTotal"] for row in rows],
    }


VISIBLE = {
    "environment": lambda server, seed: {"healthToken": server.health_token(seed)},
    "observe": _observe_visible,
    "audit": _audit_visible,
}
