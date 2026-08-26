# Pinned digest, not a floating tag: the fixtures a learner debugs must not change
# because a base image moved underneath them.
FROM python:3.13-slim@sha256:6771159cd4fa5d9bba1258caf0b82e6b73458c694d178ad97c5e925c2d0e1a91 AS base

RUN useradd --create-home --uid 10001 lab

WORKDIR /problem
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1

# Participant Workbench: public materials only, and NOT `fixtures/`. Issue 543/537:
# this single stage used to also carry the answer-checking verifier, so
# `privacy-leak`'s expected value was importable from inside a learner's own
# container, straight out of `fixtures/generate.py`. `fixtures/generate.py`'s
# `instance`, `boundary_instance` and `verify` are plain, seed-keyed functions, and a
# learner already has the seed (`FLAG_SEED`, their own container's environment), so
# leaving `fixtures/` reachable here handed over the witness -- and the undisclosed
# boundary instance behind `incompleteness` -- regardless of where the comparison
# itself lived. `show.py` and the Workbench now fetch this deployment's public
# evidence from the verifier's `GET /public` at runtime instead (see
# participant/server.py, show.py, and tests/public/test_properties.py); running the
# submitted `classify.py` / `counterexamples.py` against the real instances for
# `POST /api/prepare` is proxied to the verifier's `POST /prepare` the same way
# `/verify` is -- `fixtures/` is not copied into this stage at all.
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
