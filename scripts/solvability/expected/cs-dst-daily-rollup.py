"""Direct-answer mirrors for cs-dst-daily-rollup."""


def _evidence(seed):
    """The participant surface, read from the builder the Portal and CLI both use.

    Imported per call rather than at module scope: the audit purges and re-imports
    `fixtures` whenever the seed changes, so a module-level binding would go stale.
    """
    from fixtures.generate import evidence

    return evidence(seed)


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
    """Mirrors fixtures.generate.evidence()["observe"] field for field.

    The window now runs through the disputed day inclusive, and names that day, so the
    audit answer is the field to watch: observe shows the row that lost, never the row
    that gained.
    """
    observe = _evidence(seed)["observe"]
    return {
        "reportId": observe["report"]["reportId"],
        "timezone": observe["report"]["timezone"],
        "disputedDay": observe["report"]["disputedDay"],
        "shownIndexes": [row["index"] for row in observe["rows"]],
        "rows": observe["rows"],
    }


def _audit_visible(server, seed):
    rows = _evidence(seed)["audit"]["rows"]
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
