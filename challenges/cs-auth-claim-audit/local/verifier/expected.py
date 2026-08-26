"""Hidden derivation of the `audit` checkpoint's answer.

Issue 543/537: `decision_log` used to return `(entries, wrong)`, and `wrong` -- the row
indices a correct gateway would have refused -- was one call away from inside a
learner's own container once `fixtures/` shipped there. `fixtures/` does not ship in
the participant Docker stage at all any more (see ../Dockerfile), and even so, the
computation that names an allowed row as wrong stays out of the public
`fixtures.generate.decision_log` -- only `_decision_log_full`, which only this module
imports, holds it.

Recomputing `wrong` is not trivial arithmetic over a couple of disclosed numbers the
way `window`'s answer is (contrast with `_check_predict`-shaped checkpoints, which
compare against arithmetic over values the problem statement already hands the
learner): it requires recomputing each row's HMAC against the disclosed keys, its
time validity, its scope, and its tenant match -- the audit itself. That is exactly
what `scripts/cs-auth-claim-audit.test.ts`'s independent TypeScript reimplementation
checks against, over many seeds, without ever importing this module.
"""

from __future__ import annotations

from fixtures.generate import _decision_log_full


def audit_wrong_rows(seed: str) -> list[int]:
    """The 0-based indices of allowed rows a correct gateway would have refused."""
    return _decision_log_full(seed)[1]
