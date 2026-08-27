# Pinned digest, not a floating tag: the fixtures a learner debugs must not change
# because a base image moved underneath them.
FROM python:3.13-slim@sha256:6771159cd4fa5d9bba1258caf0b82e6b73458c694d178ad97c5e925c2d0e1a91 AS base

WORKDIR /problem
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1

# Participant Workbench: public materials only, and NOT `fixtures/`, `tests/hidden/` or
# `verifier/`.
#
# Issue 537/538 (Issue 543 option B2): this single stage used to carry the hidden suite and
# the process that runs it. `tests/hidden/check_air.py` states, checkpoint by checkpoint,
# the rules `starter/air.py` deliberately withholds: `check_transition` requires
# `steps - 1` residuals -- the count the starter says to work out first, "it is not the
# number of rows" -- and pins the first non-zero one to the tampered step; that file's own
# module docstring says "the transition out of row i breaks row i+1", which is the whole of
# what `first_violation` is graded on; and `check_underconstrained` writes out all four
# conditions a witness is accepted on, down to naming the constraint that had to be
# missing. `fixtures/generate.py` left this stage too: its `honest_trace` is, by its own
# docstring, "the reference answer for the trace checkpoint". A submission transcribed from
# those two files, with no reasoning past copying, scored 5 of 8 checkpoints, 185 of 300
# points.
#
# `show.py` and the public tests now read this deployment's public half -- the setting, the
# evaluation domain and the public label's trace, all of which `make inspect` has always
# printed -- from the verifier's `GET /public` over the Compose-internal network (see
# participant/server.py, show.py and tests/public/test_air.py).
#
# There is no supplied half to carve out here: every graded function receives its setting,
# its trace and its domain as arguments, so nothing in `fixtures/` had to move to
# `participant/`. Compare ac26-w2-private-aggregate, whose opening handle had to stay.
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
# Docker; the stage split prevents accidental answer delivery, not inspection by somebody
# controlling Docker. See TEMPLATE.md "Assurance scope" for the participant-facing boundary
# claim.
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
