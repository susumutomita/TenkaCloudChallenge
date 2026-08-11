"""Direct-answer mirrors for cs-atomic-file-publish."""


def _observe_expected(server, seed):
    return [server.published_document(seed)["path"], "partial"]


def _audit_expected(server, seed):
    return [
        index
        for index, row in enumerate(server.reader_observations(seed))
        if row.get("parsed") is False
    ]


EXPECTED = {
    "environment": lambda server, seed: server.health_token(seed),
    "observe": _observe_expected,
    "audit": _audit_expected,
}


def _observe_visible(server, seed):
    document = server.published_document(seed)
    return {"path": document["path"], "bytes": document["bytes"]}


def _audit_visible(server, seed):
    rows = server.reader_observations(seed)
    return {
        "rowCount": len(rows),
        "unparsedByteCounts": [row["bytesRead"] for row in rows if row.get("parsed") is False],
    }


VISIBLE = {
    "environment": lambda server, seed: {"healthToken": server.health_token(seed)},
    "observe": _observe_visible,
    "audit": _audit_visible,
}
