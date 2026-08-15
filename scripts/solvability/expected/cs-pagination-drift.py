"""Direct-answer mirrors for cs-pagination-drift."""


def _missing_survivors(server, seed):
    """Replay the recorded trace against the specification of the audit answer.

    Derived here from the trace's own record — initial ids, served pages, final ids —
    rather than by calling the fixture's answer helper, so the mirror checks the
    question as the participant sees it instead of re-using the grader's derivation.
    """
    trace = server.pagination_trace(seed)
    served = {row_id for page in trace["pages"] for row_id in page["returnedIds"]}
    survivors = set(trace["initialIds"]) & set(trace["finalIds"])
    return sorted(survivors - served)


def _observe_expected(server, seed):
    return [server.reported_listing(seed)["listingId"], "duplicate-rows"]


EXPECTED = {
    "environment": lambda server, seed: server.health_token(seed),
    "observe": _observe_expected,
    "audit": _missing_survivors,
}


def _observe_visible(server, seed):
    listing = server.reported_listing(seed)
    return {"listingId": listing["listingId"], "table": listing["table"]}


def _audit_visible(server, seed):
    trace = server.pagination_trace(seed)
    return {
        "pageCount": len(trace["pages"]),
        "initialCount": len(trace["initialIds"]),
        "finalCount": len(trace["finalIds"]),
    }


VISIBLE = {
    "environment": lambda server, seed: {"healthToken": server.health_token(seed)},
    "observe": _observe_visible,
    "audit": _audit_visible,
}
