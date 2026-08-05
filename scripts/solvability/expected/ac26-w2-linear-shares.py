"""Mirror for ac26-w2-linear-shares' `no-communication` table.

The grader compares only the zero / non-zero split, so the exact round counts in
`EXPECTED_ROUNDS` are one accepted answer among many.
"""

EXPECTED = {
    "no-communication": lambda server, seed: {
        operation: server.OPERATION_ROUNDS[operation] for operation in server.operations(seed)
    }
}


# A table of round counts, not a value read off the screen. Nothing shown can equal it.
VISIBLE = {"no-communication": lambda _server, _seed: {}}
