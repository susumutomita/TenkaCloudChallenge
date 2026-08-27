# Pinned digest, not a floating tag: the fixtures a learner debugs must not change
# because a base image moved underneath them.
FROM python:3.13-slim@sha256:6771159cd4fa5d9bba1258caf0b82e6b73458c694d178ad97c5e925c2d0e1a91 AS base

WORKDIR /problem
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1

# Participant Workbench: public materials only, and NOT `fixtures/`, `tests/hidden/` or
# `verifier/`.
#
# Issue 537/538 (Issue 543 option B2): this single stage used to carry the hidden suite
# and the process that runs it. `tests/hidden/check_curve.py` holds `_ReferenceCurve` --
# a complete and correct group law, with the identity kept distinct from every affine
# point, the inverse, the chord formula, the tangent formula, the vertical-tangent case
# at y = 0, and double-and-add including a negative scalar. Those are exactly the five
# things `starter/curve.py` says this problem will not let a learner skip, so shipping
# that file handed the person being graded the whole answer, not a hint toward it.
# `fixtures/generate.py` is gone as well: it derives the curve, the sample points and the
# scalars behind the `h0`, `h1`, `h2` and `properties` labels every checkpoint is graded
# on. `show.py` and the public tests now fetch this deployment's public half -- the
# curve, its affine points and its vertical-tangent points -- from the verifier's
# `GET /public` over the Compose-internal network instead (see participant/server.py,
# show.py, and tests/public/test_curve.py).
#
# There is no supplied half to carve out here: `starter/curve.py` asks the learner to
# build every name the hidden suite calls, and `fixtures/generate.py` is seed derivation
# and point enumeration only. Compare ac26-w2-private-aggregate, whose opening handle had
# to stay in `participant/`.
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
