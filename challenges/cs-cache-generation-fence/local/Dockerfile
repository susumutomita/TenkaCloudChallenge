# Pinned digest, not a floating tag: the fixtures a learner debugs must not change
# because a base image moved underneath them.
FROM python:3.13-slim@sha256:6771159cd4fa5d9bba1258caf0b82e6b73458c694d178ad97c5e925c2d0e1a91 AS base

RUN useradd --create-home --uid 10001 lab

WORKDIR /problem
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1

# Participant Workbench: public materials only. Hidden checks, the verifier,
# reference implementation, and mutation suite are not copied into this stage.
FROM base AS participant
COPY --chown=lab:lab fixtures/ ./fixtures/
COPY --chown=lab:lab tests/public/ ./tests/public/
COPY --chown=lab:lab participant/ ./participant/
COPY --chown=lab:lab starter/ ./starter/
COPY --chown=lab:lab show.py ./show.py

USER lab

CMD ["python", "participant/server.py"]

FROM base AS verifier
# Hidden verifier: a separate image and process reachable only over the internal
# Compose network. It contains neither the starter nor the reference/mutation assets.
COPY --chown=lab:lab fixtures/ ./fixtures/
COPY --chown=lab:lab tests/hidden/ ./tests/hidden/
COPY --chown=lab:lab verifier/ ./verifier/
USER lab
CMD ["python", "verifier/server.py"]

FROM participant AS author
# Author/CI only. Local mode remains honor-system verification: the stage split
# prevents accidental answer delivery, not inspection by somebody controlling Docker.

COPY --chown=lab:lab tests/hidden/ ./tests/hidden/
COPY --chown=lab:lab reference/ ./reference/
COPY --chown=lab:lab mutation.py ./mutation.py
