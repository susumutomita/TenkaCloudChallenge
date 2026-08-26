# Pinned digest, not a floating tag: the fixtures a learner debugs must not change
# because a base image moved underneath them.
FROM python:3.13-slim@sha256:6771159cd4fa5d9bba1258caf0b82e6b73458c694d178ad97c5e925c2d0e1a91 AS base

RUN useradd --create-home --uid 10001 lab

WORKDIR /problem
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1

# Participant Workbench: public materials only, and NOT `tests/hidden/` or `verifier/`.
#
# Issue 543/537: this single stage used to carry the hidden suite and the process that
# runs it. All eight of this problem's checkpoints are graded by running
# `tests/hidden/check_schnorr.py` against the learner's file, so shipping that file
# handed the person being graded the exact assertions -- including the two counts the
# `fiat-shamir` and `serialization` hints charge a penalty to reveal, which the hidden
# phases' own call signatures spell out.
#
# `fixtures/` deliberately stays here. It derives the *statement* -- the toy group, the
# two domains, and the `"public"`-label secret and nonce the public tests sign with --
# not a graded value: the hidden phases key their own secrets off different labels,
# `show.py` prints this material already, and `tests/public/test_schnorr.py` imports it
# directly. Removing it would hide the question rather than the answer. Same judgement
# as `ac26-w1-underconstraint` (#567); contrast `ac26-w2-linear-shares`, whose fixtures
# module holds the answer table itself and therefore does not ship.
FROM base AS participant
COPY --chown=lab:lab fixtures/ ./fixtures/
COPY --chown=lab:lab tests/public/ ./tests/public/
COPY --chown=lab:lab participant/ ./participant/
COPY --chown=lab:lab starter/ ./starter/
COPY --chown=lab:lab show.py ./show.py

USER lab

CMD ["python", "participant/server.py"]

# Hidden grading runs in a separate, unpublished image reachable only over the
# Compose-internal network (see docker-compose.yml). The Workbench above has the public
# tests and the answer-sealing adapter, but no hidden checker and no scoring process.
FROM base AS verifier
COPY --chown=lab:lab fixtures/ ./fixtures/
COPY --chown=lab:lab tests/hidden/ ./tests/hidden/
COPY --chown=lab:lab verifier/ ./verifier/

USER lab

CMD ["python", "verifier/server.py"]

# Author-only target. Local mode remains honor-system verification for whoever controls
# Docker; the stage split prevents accidental answer delivery, not inspection by
# somebody controlling Docker. See TEMPLATE.md "Assurance scope" for the
# participant-facing boundary claim.
FROM participant AS author

COPY --chown=lab:lab tests/hidden/ ./tests/hidden/
COPY --chown=lab:lab verifier/ ./verifier/
COPY --chown=lab:lab reference/ ./reference/
COPY --chown=lab:lab mutation.py ./mutation.py
