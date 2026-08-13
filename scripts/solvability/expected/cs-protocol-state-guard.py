"""Direct-answer mirrors for cs-protocol-state-guard."""

# The documented protocol, written out here so the mirror checks the specification
# rather than re-using the verifier's own derivation of the answer.
ALLOWED = {
    ("new", "HELLO"): "greeted",
    ("greeted", "AUTH"): "ready",
    ("ready", "DATA"): "ready",
    ("ready", "BYE"): "closed",
}


def _out_of_order(server, seed):
    state = "new"
    wrong = []
    for index, row in enumerate(server.session_transcript(seed)):
        destination = ALLOWED.get((state, str(row["received"])))
        if destination is None:
            wrong.append(index)
        else:
            state = destination
    return wrong


def _observe_expected(server, seed):
    return [server.reported_session(seed)["sessionId"], "accepted-out-of-order"]


EXPECTED = {
    "environment": lambda server, seed: server.health_token(seed),
    "observe": _observe_expected,
    "audit": _out_of_order,
}


def _observe_visible(server, seed):
    session = server.reported_session(seed)
    return {"sessionId": session["sessionId"], "peer": session["peer"]}


def _audit_visible(server, seed):
    transcript = server.session_transcript(seed)
    return {
        "exchangeCount": len(transcript),
        "receivedTypes": [row["received"] for row in transcript],
    }


VISIBLE = {
    "environment": lambda server, seed: {"healthToken": server.health_token(seed)},
    "observe": _observe_visible,
    "audit": _audit_visible,
}
