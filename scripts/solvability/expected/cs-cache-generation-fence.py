"""Direct-answer mirrors for cs-cache-generation-fence."""


EXPECTED = {
    "environment": lambda server, seed: server.health_token(seed),
    "audit": lambda server, seed: server.audit_trace(seed)[1],
}


def _audit_visible(server, seed):
    events, _answer = server.audit_trace(seed)
    return {
        "cacheHitIndices": [
            index for index, event in enumerate(events) if event.get("op") == "cache_hit"
        ],
        "rowCount": len(events),
    }


VISIBLE = {
    "environment": lambda server, seed: {"healthToken": server.health_token(seed)},
    "audit": _audit_visible,
}
