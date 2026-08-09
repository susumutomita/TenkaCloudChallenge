"""Direct-answer mirrors for cs-async-result-binding."""


EXPECTED = {
    # Deliberately copied: this checkpoint proves that the seeded runtime started.
    "environment": lambda server, seed: server.health_token(seed),
    "audit": lambda server, seed: server.audit_answer(seed),
}


def _audit_visible(server, seed):
    evidence = server.audit_evidence(seed)
    return {
        "storedIndices": [row["index"] for row in evidence["storedRows"]],
        "completionPositions": [row["position"] for row in evidence["completionTrace"]],
        "rowCount": len(evidence["jobs"]),
    }


VISIBLE = {
    "environment": lambda server, seed: {"healthToken": server.health_token(seed)},
    "audit": _audit_visible,
}
