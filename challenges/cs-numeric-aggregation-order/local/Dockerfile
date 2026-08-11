# Pinned runtime: a learner's evidence must not change when a floating tag moves.
FROM python:3.13-slim@sha256:6771159cd4fa5d9bba1258caf0b82e6b73458c694d178ad97c5e925c2d0e1a91 AS base

RUN useradd --create-home --uid 10001 lab
WORKDIR /problem
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1

# Participant Workbench: public materials only. In particular it contains neither
# tests/hidden, reference/, nor mutation.py.
FROM base AS participant
COPY --chown=lab:lab fixtures/ ./fixtures/
COPY --chown=lab:lab tests/public/ ./tests/public/
COPY --chown=lab:lab workbench/ ./workbench/
COPY --chown=lab:lab starter/ ./starter/
COPY --chown=lab:lab show.py ./show.py
USER lab
CMD ["python", "workbench/server.py"]

# Hidden verifier: a separate image and process on the Compose-internal network. It
# does not carry the reference answer or mutation machinery.
FROM base AS verifier
COPY --chown=lab:lab fixtures/ ./fixtures/
COPY --chown=lab:lab tests/hidden/ ./tests/hidden/
COPY --chown=lab:lab verifier/ ./verifier/
USER lab
CMD ["python", "verifier/server.py"]

# Author/CI only. Local mode is honor-system verification: this stage prevents an
# accidental answer delivery, not a participant who controls Docker from inspecting it.
# See TEMPLATE.md "Assurance scope" for the participant-facing boundary claim.
FROM participant AS author
COPY --chown=lab:lab tests/hidden/ ./tests/hidden/
COPY --chown=lab:lab verifier/ ./verifier/
COPY --chown=lab:lab reference/ ./reference/
# mutation suite が読む author 専用の mutant。 参加者 stage には入らない。
COPY --chown=lab:lab mutants/ ./mutants/
COPY --chown=lab:lab mutation.py ./mutation.py
