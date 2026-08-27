# Pinned digest, not a floating tag: the fixtures a learner debugs must not change
# because a base image moved underneath them.
FROM python:3.13-slim@sha256:6771159cd4fa5d9bba1258caf0b82e6b73458c694d178ad97c5e925c2d0e1a91 AS base

RUN useradd --create-home --uid 10001 lab

WORKDIR /problem
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1

# Participant Workbench: public materials only, and NOT `fixtures/`, `tests/hidden/` or
# `verifier/`.
#
# Issue 537/538 (Issue 543 option B2): this used to be a single stage that carried all
# three, in the image a learner's own `make build` produced. Every one of this problem's
# six checkpoints is graded by running `tests/hidden/check_oblivious.py` against the
# learner's file, so shipping that file handed the person being graded the exact
# assertions -- including `check_receiver_privacy`, which states the condition on the
# receiver's blind, and `check_gate_privacy`, which states that the gate's two transfers
# must be independently masked. Those two are the properties the whole problem asks a
# learner to derive. `fixtures/generate.py` is gone as well: it derives every seeded
# setting the hidden suite grades against.
#
# `participant/ot.py` stays: it is the supplied key derivation the starter imports, the
# half this problem deliberately does not grade. `show.py` and the public tests now fetch
# this deployment's public half -- the group, the sender's key, the session on offer and
# the gate's share layout -- from the verifier's `GET /public` over the Compose-internal
# network instead (see participant/server.py, show.py, and tests/public/test_oblivious.py).
FROM base AS participant
COPY --chown=lab:lab tests/public/ ./tests/public/
COPY --chown=lab:lab participant/ ./participant/
COPY --chown=lab:lab starter/ ./starter/
COPY --chown=lab:lab show.py ./show.py

USER lab

CMD ["python", "participant/server.py"]

# Hidden grading runs in a separate, unpublished image reachable only over the
# Compose-internal network (see docker-compose.yml). The Workbench above has the public
# tests, the starter and the Portal editor API, but no seed derivation, no hidden checker,
# and no process that can decide a checkpoint.
#
# `participant/ot.py` is copied in below rather than left out: it is the supplied layer the
# fixture generator, the reference and the hidden checker all import, so that the key
# derivation a learner builds on and the one they are graded against cannot drift apart.
# The Portal server and its adapter are deliberately absent from this stage.
FROM base AS verifier
COPY --chown=lab:lab participant/ot.py ./participant/ot.py
COPY --chown=lab:lab fixtures/ ./fixtures/
COPY --chown=lab:lab tests/hidden/ ./tests/hidden/
COPY --chown=lab:lab verifier/ ./verifier/

USER lab

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

COPY --chown=lab:lab fixtures/ ./fixtures/
COPY --chown=lab:lab tests/hidden/ ./tests/hidden/
COPY --chown=lab:lab verifier/ ./verifier/
COPY --chown=lab:lab reference/ ./reference/
COPY --chown=lab:lab mutation.py ./mutation.py
