# Pinned digest, not a floating tag: the fixtures a learner debugs must not change
# because a base image moved underneath them.
FROM python:3.13-slim@sha256:6771159cd4fa5d9bba1258caf0b82e6b73458c694d178ad97c5e925c2d0e1a91 AS base

RUN useradd --create-home --uid 10001 lab
RUN python -c "import ctypes; ctypes.CDLL('libseccomp.so.2')"

WORKDIR /problem
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1

# Only starter files, public tests and the Portal API reach the participant image.
# Expected-value generation stays in the verifier; public evidence is fetched over
# the Compose-internal network by participant/evidence.py.
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
