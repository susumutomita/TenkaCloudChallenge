"""Hidden access to the fourteen co-SNARK drill lines' values.

Like its siblings ac26-w6-zkvm-trace-drill and ac26-w6-nullifier-drill (and the earlier
ac26-w5-rotation-drill / ac26-w5-negacyclic-drill), this problem's `fixtures/generate.py`
derives the expected values inside `setting(seed)` itself, next to the public numbers —
the module is the single source for both. The boundary therefore moves with the module
instead of inside it (Issue 537/543 option B2): `fixtures/` ships only in this verifier
image and the author stage, never in the participant Workbench image, whose show.py and
public tests read the public half from this process's `GET /public` (see server.py and
../Dockerfile).

This module is the one place grading code reads the expected values from, so the seam
stays the same shape as every other drill's: `expected_for(seed)[line]`.
"""

from __future__ import annotations

from fixtures.generate import setting


def expected_for(seed: str) -> dict[str, object]:
    """Every one of the fourteen lines' values, keyed by line id.

    Six of the fourteen (`witness`, `reconstruct`, `noleak`, `triple`, `expand`,
    `nolink`) are ungraded — the platform's per-problem checkpoint maximum is eight —
    but `tests/hidden/check_co_snark_drill.py` still checks the reference implementation
    produces them, so they are returned here too rather than only
    `fixtures.generate.GRADED`.
    """
    return setting(seed)["expected"]
