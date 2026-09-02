# Pinned digest, not a floating tag: the fixtures a learner debugs must not change
# because a base image moved underneath them.
FROM python:3.13-slim@sha256:6771159cd4fa5d9bba1258caf0b82e6b73458c694d178ad97c5e925c2d0e1a91 AS base

RUN useradd --create-home --uid 10001 lab

WORKDIR /problem
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1

# Participant Workbench: the Portal editor API, the starter, the public tests and the
# inspect script -- and NOT fixtures/.
#
# Issue 537/543 option B2: this problem's fixtures/generate.py computes the ten
# lines' expected values inside setting(seed), in the same function as the public
# numbers -- `setting(FLAG_SEED)["expected"]` is every graded answer with one import.
# The module therefore ships only in the verifier and author stages, and show.py /
# tests/public/ read the public half from the verifier's `GET /public` over the
# Compose-internal network (see participant/evidence.py).
FROM base AS participant
COPY --chown=lab:lab tests/public/ ./tests/public/
COPY --chown=lab:lab participant/ ./participant/
COPY --chown=lab:lab starter/ ./starter/
COPY --chown=lab:lab show.py ./show.py

USER lab

CMD ["python", "participant/server.py"]

# Hidden grading runs in a separate, unpublished image reachable only over the
# Compose-internal network (see docker-compose.yml). It alone carries fixtures/ (the
# expected-value derivation), tests/hidden/ and verifier/, and it serves the
# `GET /public` the Workbench reads this deployment's public half from.
FROM base AS verifier
COPY --chown=lab:lab fixtures/ ./fixtures/
COPY --chown=lab:lab tests/hidden/ ./tests/hidden/
COPY --chown=lab:lab verifier/ ./verifier/

USER lab

CMD ["python", "verifier/server.py"]

# Author-only target for `make reference-test`, which runs the mutation suite. It adds
# fixtures/, the grader, the hidden checks, the reference solution and the mutation
# harness back on top of the participant image.
#
# This is misdelivery prevention, not confidentiality: local mode remains honor-system
# verification for whoever controls Docker -- the stage split prevents accidental
# answer delivery, not inspection by somebody who builds this stage on purpose.
FROM participant AS author

COPY --chown=lab:lab fixtures/ ./fixtures/
COPY --chown=lab:lab tests/hidden/ ./tests/hidden/
COPY --chown=lab:lab verifier/ ./verifier/
COPY --chown=lab:lab reference/ ./reference/
COPY --chown=lab:lab mutation.py ./mutation.py
