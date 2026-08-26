# Pinned digest, not a floating tag: the fixtures a learner debugs must not change
# because a base image moved underneath them.
FROM python:3.13-slim@sha256:6771159cd4fa5d9bba1258caf0b82e6b73458c694d178ad97c5e925c2d0e1a91 AS base

RUN useradd --create-home --uid 10001 lab

WORKDIR /problem
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1

# Participant Workbench: public materials only, and NOT `fixtures/`, `tests/hidden/` or
# `verifier/`.
#
# Issue 543/537: this single stage used to carry the hidden suite and the process that
# runs it. All eight of this problem's checkpoints are graded by running
# `tests/hidden/check_cmux.py` against the learner's file, so shipping that file handed
# the person being graded the exact assertions.
#
# Issue 543's option B2 is why `fixtures/` is gone too. `fixtures/generate.py` has to
# implement working `rlwe_add`, `rlwe_sub`, `cmux`, `monomial_rotate`,
# `rotate_ciphertext`, `conditional_rotate`, `blind_rotate` and `blind_rotate_trace` to
# derive this deployment's rotation table, CMUX rows and blind-rotation trace -- the eight
# names `starter/cmux.py` asks the learner to write. While it shipped here every one of
# them was a single import away, with no comparison anywhere near them. `show.py` and the
# public tests now fetch this deployment's public half from the verifier's `GET /public`
# over the Compose-internal network (see show.py, tests/public/test_cmux.py, and the
# VERIFIER_PUBLIC_URL wiring in docker-compose.yml).
#
# `participant/ring.py` stays -- it is the ring, RLWE, RGSW and external product this
# problem explicitly supplies rather than grades (`ac26-w5-lwe-rlwe` and
# `ac26-w5-rgsw-external` are where those are the exercise), and `starter/cmux.py` imports
# from it on its first line.
FROM base AS participant
COPY --chown=lab:lab tests/public/ ./tests/public/
COPY --chown=lab:lab participant/ ./participant/
COPY --chown=lab:lab starter/ ./starter/
COPY --chown=lab:lab show.py ./show.py

USER lab

CMD ["python", "participant/server.py"]

# Hidden grading runs in a separate, unpublished image reachable only over the
# Compose-internal network (see docker-compose.yml). The Workbench above has the public
# tests and the answer-sealing adapter, but no fixture derivation, no hidden checker and
# no scoring process.
#
# The single file below is not the participant package: it holds the supplied ring, RLWE,
# RGSW and external product, which the fixture generator, the reference and the hidden
# checker all import so that the arithmetic a learner builds on and the one they are graded
# against cannot drift apart. The Portal server and its adapter are deliberately absent
# from this stage.
FROM base AS verifier
COPY --chown=lab:lab participant/ring.py ./participant/ring.py
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
# seed sweep all need it.
FROM participant AS author

COPY --chown=lab:lab fixtures/ ./fixtures/
COPY --chown=lab:lab tests/hidden/ ./tests/hidden/
COPY --chown=lab:lab verifier/ ./verifier/
COPY --chown=lab:lab reference/ ./reference/
COPY --chown=lab:lab mutation.py ./mutation.py
