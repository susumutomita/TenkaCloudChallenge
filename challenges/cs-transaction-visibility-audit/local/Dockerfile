# A pinned stdlib-only runtime keeps seeded evidence stable across rebuilds.
FROM python:3.13-slim@sha256:6771159cd4fa5d9bba1258caf0b82e6b73458c694d178ad97c5e925c2d0e1a91 AS base

RUN useradd --create-home --uid 10001 lab

WORKDIR /problem

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1

FROM base AS participant

COPY --chown=lab:lab fixtures/ ./fixtures/
COPY --chown=lab:lab tests/public/ ./tests/public/
COPY --chown=lab:lab verifier/ ./verifier/
COPY --chown=lab:lab starter/ ./starter/
COPY --chown=lab:lab show.py ./show.py

USER lab

CMD ["python", "verifier/server.py"]

# Hidden grading runs in a separate, unpublished image. The participant Workbench has
# public tests and the submission adapter, but no hidden checker or worked answer.
FROM base AS verifier

COPY --chown=lab:lab fixtures/ ./fixtures/
COPY --chown=lab:lab tests/hidden/ ./tests/hidden/
COPY --chown=lab:lab verifier/ ./verifier/

USER lab

CMD ["python", "verifier/server.py"]

# Author-only target. Local mode remains honor-system verification for whoever controls
# Docker, but the normal participant image cannot accidentally deliver hidden checks,
# worked answers, or the mutation catalog. See TEMPLATE.md "Assurance scope".
FROM participant AS author

COPY --chown=lab:lab tests/hidden/ ./tests/hidden/
COPY --chown=lab:lab reference/ ./reference/
COPY --chown=lab:lab mutation.py ./mutation.py
