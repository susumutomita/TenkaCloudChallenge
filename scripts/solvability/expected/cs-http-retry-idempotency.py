"""Direct-answer mirrors for cs-http-retry-idempotency."""


def _uncertain_expected(server, seed):
    return [server.public_operation(seed)["requestId"], "unknown"]


def _audit_expected(server, seed):
    return [index for index, row in enumerate(server.audit_log(seed)) if row["attempt"] == 2]


EXPECTED = {
    "environment": lambda server, seed: server.health_token(seed),
    "uncertain": _uncertain_expected,
    "audit": _audit_expected,
}


def _uncertain_visible(server, seed):
    operation = server.public_operation(seed)
    return {"requestId": operation["requestId"], "clientObserved": "timeout"}


def _audit_visible(server, seed):
    rows = server.audit_log(seed)
    return {
        "rowCount": len(rows),
        "attempt2ChargeIds": [row["chargeId"] for row in rows if row["attempt"] == 2],
    }


VISIBLE = {
    "environment": lambda server, seed: {"healthToken": server.health_token(seed)},
    "uncertain": _uncertain_visible,
    "audit": _audit_visible,
}
