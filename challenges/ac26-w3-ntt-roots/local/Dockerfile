# Pinned digest, not a floating tag: the fixtures a learner debugs must not change
# because a base image moved underneath them.
FROM python:3.13-slim@sha256:6771159cd4fa5d9bba1258caf0b82e6b73458c694d178ad97c5e925c2d0e1a91 AS base

WORKDIR /problem
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1

# Participant Workbench: public materials only, and NOT `fixtures/`, `tests/hidden/` or
# `verifier/`.
#
# Issue 537/538 (Issue 543 option B2): this single stage used to carry the hidden suite
# and the process that runs it. `tests/hidden/check_ntt.py` holds `has_order` -- "order
# exactly n" written out from the definition: a power that returns 1, and no smaller one
# that does, with the prime factorisation it needs beside it. It holds `naive_omega`,
# named there as "the rule the broken starter uses", and its `_roundtrip_failures` states
# the `invalid_omega` rejection that `inverse_transform` is graded on.
# `starter/ntt.py` tells the learner that whatever establishes the order has to be added
# by them, because "nothing else in the image computes it for you" -- and that sentence
# was false while this file shipped next to it. `fixtures/generate.py` is gone as well.
# `show.py` now fetches this deployment's public half -- the field family, the legal
# orders in each, and the one worked transform -- from the verifier's `GET /public` over
# the Compose-internal network (see participant/server.py and show.py).
#
# The public tests need no payload: every parameter set in `tests/public/test_ntt.py` is
# written out in that file itself.
#
# There is no supplied half to carve out here: `starter/ntt.py` asks the learner to build
# every name the hidden suite calls, and `fixtures/generate.py` is orientation material
# only -- it deliberately derives no root of unity. Compare ac26-w2-private-aggregate,
# whose opening handle had to stay in `participant/`.
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
