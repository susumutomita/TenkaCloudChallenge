"""Direct-answer mirrors for cs-transaction-visibility-audit."""


EXPECTED = {
    "audit": lambda server, seed: server.audit_expected(seed),
    "counterexample": lambda server, seed: server.counterexample_expected(seed),
}


def _audit_visible(server, seed):
    fixture = server.audit_fixture(seed)
    return {
        "committedStates": fixture["committed"],
        "reportTraces": fixture["reports"],
    }


def _counterexample_visible(server, seed):
    fixture = server.counterexample_fixture(seed)
    return {
        "readOrder": fixture["readOrder"],
        "commitAfterRead": fixture["commitAfterRead"],
        "candidateTransfers": fixture["candidates"],
    }


VISIBLE = {
    "audit": _audit_visible,
    "counterexample": _counterexample_visible,
}
