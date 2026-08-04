"""Mirror for ac26-w2-linear-shares' `no-communication` table.

The grader compares only the zero / non-zero split, so the exact round counts in
`EXPECTED_ROUNDS` are one accepted answer among many.
"""

EXPECTED = {
    "no-communication": lambda server, _seed: {
        operation: server.EXPECTED_ROUNDS[operation] for operation in server.OPERATIONS
    }
}
