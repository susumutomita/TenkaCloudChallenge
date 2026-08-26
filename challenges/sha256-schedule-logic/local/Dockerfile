# Pinned digest, not a floating tag: the fixtures a learner debugs must not change
# because a base image moved underneath them.
FROM python:3.13-slim@sha256:6771159cd4fa5d9bba1258caf0b82e6b73458c694d178ad97c5e925c2d0e1a91 AS base

RUN useradd --create-home --uid 10001 lab

WORKDIR /problem
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1

# Participant Workbench: public materials only, and NOT `fixtures/` or `verifier/`.
#
# Issue 537/538: this single stage used to also carry the answer-checking verifier, so
# `_check_rotate` and `_check_mux` compared a submission directly against
# `rotate_case(SEED)` / `mux_case(SEED)` in `fixtures/generate.py`, and `_check_dependency`
# compared against `first_affected_index()`, defined directly in `verifier/server.py` --
# both reachable from inside a learner's own container regardless of where the comparison
# itself lived. `show.py` and the public tests now fetch this deployment's public
# evidence from the verifier's `GET /public` at runtime instead (see participant/server.py,
# show.py, and tests/public/test_schedule.py) -- `fixtures/` is not copied into this
# stage at all.
FROM base AS participant
COPY --chown=lab:lab tests/public/ ./tests/public/
COPY --chown=lab:lab participant/ ./participant/
COPY --chown=lab:lab starter/ ./starter/
COPY --chown=lab:lab show.py ./show.py

USER lab

CMD ["python", "participant/server.py"]

# Hidden grading runs in a separate, unpublished image reachable only over the
# Compose-internal network (see docker-compose.yml). The Workbench above has the public
# tests and the answer-sealing adapter, but no expected-value derivation and no hidden
# checker.
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

COPY --chown=lab:lab fixtures/ ./fixtures/
COPY --chown=lab:lab tests/hidden/ ./tests/hidden/
COPY --chown=lab:lab verifier/ ./verifier/
COPY --chown=lab:lab reference/ ./reference/
COPY --chown=lab:lab mutation.py ./mutation.py
