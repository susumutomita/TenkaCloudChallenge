# Pinned digest, not a floating tag: the fixtures a learner debugs must not change
# because a base image moved underneath them.
FROM python:3.13-slim@sha256:6771159cd4fa5d9bba1258caf0b82e6b73458c694d178ad97c5e925c2d0e1a91 AS base

RUN useradd --create-home --uid 10001 lab
RUN python -c "import ctypes; ctypes.CDLL('libseccomp.so.2')"

WORKDIR /problem
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1

# Participant Workbench: public materials only, and NOT `fixtures/`, `tests/hidden/` or
# `verifier/`.
#
# Issue 537/538 (Issue 543 option B2): this single stage used to carry the hidden suite
# and the process that runs it. Every one of this problem's five checkpoints is graded by
# running `tests/hidden/check_beaver.py` against the learner's file, so shipping that file
# handed the person being graded the exact assertions -- including `check_combine`, which
# names the folding rule the whole problem asks them to derive, and `check_rounds`, which
# states its acceptance rule outright. `fixtures/generate.py` is gone as well: its
# `setting()` returns x, y, a, b and c in the clear, so a learner holding it could build a
# sharing of this deployment's product without running the protocol at all.
# `show.py` and the public tests now fetch this deployment's public half -- the modulus,
# the party count, the triple's shares and the shares of x -- from the verifier's
# `GET /public` over the Compose-internal network instead (see participant/server.py,
# show.py, and tests/public/test_beaver.py).
FROM base AS participant
COPY --chown=lab:lab tests/public/ ./tests/public/
COPY --chown=lab:lab participant/ ./participant/
COPY --chown=lab:lab starter/ ./starter/
COPY --chown=lab:lab show.py ./show.py

USER lab
CMD ["python", "participant/server.py"]

# Hidden grading runs in a separate, unpublished image reachable only over the
# Compose-internal network (see docker-compose.yml). The Workbench above has the public
# tests and the starter, but no fixture generator or hidden checker. It retains the
# existing parent-owned seed/tcw1 preparation contract.
FROM base AS verifier
COPY --chown=lab:lab participant/execution.py participant/isolation.py participant/worker.py ./participant/
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
