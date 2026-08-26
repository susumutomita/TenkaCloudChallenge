# Pinned digest, not a floating tag: the fixtures a learner debugs must not change
# because a base image moved underneath them.
FROM python:3.13-slim@sha256:6771159cd4fa5d9bba1258caf0b82e6b73458c694d178ad97c5e925c2d0e1a91 AS base

WORKDIR /problem
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1

# Participant Workbench: public materials only, and NOT `fixtures/`, `tests/hidden/` or
# `verifier/`.
#
# Issue 537/538 (Issue 543 option B2): this single stage used to carry the hidden suite
# and the process that runs it. All three of this problem's checkpoints are graded by
# running `tests/hidden/check_assertion.py` against the learner's file, so shipping that
# file handed the person being graded the exact assertions -- including the one-reason
# verdict strings `starter/assertion.py` only describes in prose.
#
# `fixtures/` is gone for the same reason. `fixtures/generate.py` defines `signed_message`
# under the exact name the starter's own stub asks the learner to write, and `fixture()`
# labels every assertion by kind (`honest`, `no-uv`, `bad-signature`, `wrong-rp`) for any
# seed a caller names -- and the hidden suite's seeds are derived from the `FLAG_SEED` a
# learner already has. Together those two answered all three checkpoints from a lookup
# table, with no WebAuthn reasoning at all. `show.py` and the public tests now fetch this
# deployment's public half from the verifier's `GET /public` over the Compose-internal
# network (see show.py, tests/public/test_assertion.py, and the VERIFIER_PUBLIC_URL wiring
# in docker-compose.yml).
#
# The supplied P-256 arithmetic a learner builds on is not affected: it is written out in
# `starter/assertion.py` itself, so nothing had to be carved out into its own module.
FROM base AS participant
COPY tests/public/ ./tests/public/
COPY participant/ ./participant/
COPY starter/ ./starter/
COPY show.py ./show.py

CMD ["python", "participant/server.py"]

# Hidden grading runs in a separate, unpublished image reachable only over the
# Compose-internal network (see docker-compose.yml). The Workbench above has the public
# tests and the Portal editor API, but no fixture derivation, no hidden checker and no
# scoring process.
FROM base AS verifier
COPY fixtures/ ./fixtures/
COPY tests/hidden/ ./tests/hidden/
COPY verifier/ ./verifier/

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

COPY fixtures/ ./fixtures/
COPY tests/hidden/ ./tests/hidden/
COPY verifier/ ./verifier/
COPY reference/ ./reference/
COPY mutation.py ./mutation.py
