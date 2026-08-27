# Pinned digest, not a floating tag: the fixtures a learner debugs must not change
# because a base image moved underneath them.
FROM python:3.13-slim@sha256:6771159cd4fa5d9bba1258caf0b82e6b73458c694d178ad97c5e925c2d0e1a91 AS base

WORKDIR /problem
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1

# Participant Workbench: public materials only, and NOT `fixtures/`, `tests/hidden/` or
# `verifier/`.
#
# Issue 537/538 (Issue 543 option B2): this single stage used to carry the hidden suite
# and the process that runs it. `tests/hidden/check_pipeline.py` holds
# `_reference_first_fault` -- a complete and correct implementation of every layer
# contract this problem asks a learner to write, from the input boundary's four
# conditions through to the low-degree stage -- and `check_graph`, `check_assumptions`
# and `check_diagnose` write out the graph construction, the assumption matrix and the
# layer order beside it. `fixtures/generate.py` is gone as well: it carries
# `UNSUPPORTED_CLAIMS`, the `cost` checkpoint's ground truth, and `FAULTS`, which maps
# every injected fault to the layer `first_fault` must report and to the single field
# `repair` may touch. A submission transcribed from those two files, with no reasoning
# past copying, scored 7 of this problem's 8 checkpoints.
#
# `show.py` and the public tests now fetch this deployment's public half -- the two
# pipeline definitions, one honest run of A, one run of B with something wrong, and the
# claims to sort -- from the verifier's `GET /public` over the Compose-internal network
# (see participant/server.py, show.py, and tests/public/test_pipeline.py).
#
# There is no supplied half to carve out: every graded function is handed its definition
# and its run as arguments, so the verifier stage below copies no participant file.
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
