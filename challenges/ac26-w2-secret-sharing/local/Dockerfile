# Pinned digest, not a floating tag: the fixtures a learner debugs must not change
# because a base image moved underneath them.
FROM python:3.13-slim@sha256:6771159cd4fa5d9bba1258caf0b82e6b73458c694d178ad97c5e925c2d0e1a91 AS base

WORKDIR /problem
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1

# Participant Workbench: public materials only, and NOT `fixtures/`, `tests/hidden/` or
# `verifier/`.
#
# Issue 537/538 (Issue 543 option B2): this single stage used to carry the hidden suite
# and the process that runs it. Four of this problem's five checkpoints are graded by
# running `tests/hidden/check_sharing.py` against the learner's file, so shipping that
# file handed the person being graded the exact assertions; the fifth, `threshold`, is
# decided by `_check_threshold` in `verifier/server.py`, which shipped here too.
# `fixtures/generate.py` is gone as well: its `reference_shares` builds a correct split
# of this deployment's secret, which is the `share` half of `share-and-reconstruct`.
# `show.py` and the public tests now fetch this deployment's public half -- the modulus,
# the party count, the drawn randomness and the n-1 shares -- from the verifier's
# `GET /public` over the Compose-internal network instead (see participant/server.py,
# show.py, and tests/public/test_sharing.py).
FROM base AS participant
COPY tests/public/ ./tests/public/
COPY participant/ ./participant/
COPY starter/ ./starter/
COPY show.py ./show.py

CMD ["python", "participant/server.py"]

# Hidden grading runs in a separate, unpublished image reachable only over the
# Compose-internal network (see docker-compose.yml). The Workbench above has the public
# tests and the answer-sealing adapter, but no seed derivation, no reference split, and
# no hidden checker.
FROM base AS verifier
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
