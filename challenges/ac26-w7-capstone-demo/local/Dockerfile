# Pinned digest, not a floating tag: the fixtures a learner debugs must not change because a
# base image moved underneath them.
#
# This is the OCI *index* digest, verified to resolve against Docker Hub on 2026-07-25. The
# digest the scaffolder copies from the template returns 404 for every platform, so no AC26
# problem built by it can build at all. Verify a digest before pinning it: nothing in CI goes
# through Docker, so a dead pin passes every check.
FROM python:3.13-slim@sha256:6771159cd4fa5d9bba1258caf0b82e6b73458c694d178ad97c5e925c2d0e1a91 AS base

WORKDIR /problem
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1

# Participant Workbench: public materials only, and NOT `fixtures/`, `tests/hidden/` or
# `verifier/`.
#
# Issue 537/538 (Issue 543 option B2): this single stage used to carry the hidden suite and the
# process that runs it. `tests/hidden/check_capstone.py` states, phase by phase, what every one
# of this problem's eight checkpoints is graded on -- `_spec_well_formed` is the whole
# transcript rule, `_spec_view` is `view`'s answer written out, `_leaks` is the privacy
# experiment, `check_threshold` states where the threshold sits, `check_scope` compares the
# manifest against the two property sets by name, and `_mutants` enumerates the nine defects
# `detects` is graded against. `fixtures/generate.py` is gone as well: `hidden_settings` draws
# the six settings -- other party counts, other fields, the two edge input vectors -- that
# every checkpoint is graded on. A submission transcribed from those two files, with no
# reasoning past copying, scored all eight checkpoints, 300 of 300 points.
#
# `participant/lab.py` stays: the setting object, the vocabulary, the tiny settings and the
# randomness contract are the supplied half this problem deliberately hands over, and nothing
# in it is graded -- `starter/capstone.py`'s own stubs name `tiny_settings` and
# `randomness_space`, so a submission has to be able to import it. `show.py` and the public
# tests read this deployment's setting from the verifier's `GET /public` over the
# Compose-internal network (see participant/server.py, show.py, and
# tests/public/test_capstone.py).
FROM base AS participant
COPY tests/public/ ./tests/public/
COPY participant/ ./participant/
COPY starter/ ./starter/
COPY show.py ./show.py

CMD ["python", "participant/server.py"]

# Hidden grading runs in a separate, unpublished image reachable only over the
# Compose-internal network (see docker-compose.yml). The Workbench above has the public
# tests, the supplied lab layer and the starter, but no seed derivation, no hidden checker,
# and no process that can decide a checkpoint.
#
# `participant/lab.py` is copied in as well, because `fixtures/generate.py` re-exports it and
# the hidden checker builds its settings on it -- one implementation of the supplied layer,
# graded and inspected, rather than two that can drift.
FROM base AS verifier
COPY participant/lab.py ./participant/lab.py
COPY fixtures/ ./fixtures/
COPY tests/ ./tests/
COPY verifier/ ./verifier/

CMD ["python", "verifier/server.py"]

# Author-only target. Local mode remains honor-system verification for whoever controls
# Docker; the stage split prevents accidental answer delivery, not inspection by somebody
# controlling Docker. See TEMPLATE.md "Assurance scope" for the participant-facing boundary
# claim.
#
# This target is `FROM participant`, so dropping `fixtures/`, `tests/hidden/` and `verifier/`
# above takes them out of the author image too unless they are copied back -- and mutation.py,
# the hidden suite and the reference all need them.
FROM participant AS author

COPY fixtures/ ./fixtures/
COPY tests/ ./tests/
COPY verifier/ ./verifier/
COPY reference/ ./reference/
COPY mutation.py ./mutation.py
