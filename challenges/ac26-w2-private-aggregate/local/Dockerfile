# Pinned digest, not a floating tag: the fixtures a learner debugs must not change
# because a base image moved underneath them.
FROM python:3.13-slim@sha256:6771159cd4fa5d9bba1258caf0b82e6b73458c694d178ad97c5e925c2d0e1a91 AS base

WORKDIR /problem
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1

# Participant Workbench: public materials only, and NOT `fixtures/`, `tests/hidden/` or
# `verifier/`.
#
# Issue 537/538 (Issue 543 option B2): this single stage used to carry the hidden suite
# and the process that runs it. Every one of this problem's eight checkpoints is graded by
# running `tests/hidden/check_aggregate.py` against the learner's file, so shipping that
# file handed the person being graded the exact assertions -- `check_plan`, which states
# the three numbers `plan()` must return; `check_cost`, which states the round count and
# the opening count it accepts; and `check_privacy`, which states the exact multiset a run
# may reveal. `fixtures/generate.py` is gone as well: it derives every setting a checkpoint
# is graded against, including the secret counts and severities behind `plain_score`.
# `show.py` and the public tests now fetch this deployment's public half -- the modulus,
# the organization count, the bias, the shared inputs and the triples -- from the
# verifier's `GET /public` over the Compose-internal network instead (see
# participant/server.py, show.py, and tests/public/test_aggregate.py).
#
# The opening handle a learner is handed is not part of that and stays here, in
# `participant/protocol.py`, which `fixtures/generate.py` imports rather than restates.
FROM base AS participant
COPY tests/public/ ./tests/public/
COPY participant/ ./participant/
COPY starter/ ./starter/
COPY show.py ./show.py

CMD ["python", "participant/server.py"]

# Hidden grading runs in a separate, unpublished image reachable only over the
# Compose-internal network (see docker-compose.yml). The Workbench above has the public
# tests and the starter, but no seed derivation, no hidden checker, and no process that
# can decide a checkpoint.
FROM base AS verifier
COPY participant/protocol.py ./participant/protocol.py
COPY fixtures/ ./fixtures/
COPY tests/hidden/ ./tests/hidden/
COPY verifier/ ./verifier/

CMD ["python", "verifier/server.py"]

# Author-only target. Local mode remains honor-system verification for whoever controls
# Docker; the stage split prevents accidental answer delivery, not inspection by
# somebody controlling Docker. See TEMPLATE.md "Assurance scope" for the
# participant-facing boundary claim.
#
# This target is `FROM participant`, so dropping `fixtures/` above takes it out of the
# author image too unless it is copied back -- and mutation.py, the hidden suite and the
# reference all need it.
FROM participant AS author

COPY fixtures/ ./fixtures/
COPY tests/hidden/ ./tests/hidden/
COPY verifier/ ./verifier/
COPY reference/ ./reference/
COPY mutation.py ./mutation.py
