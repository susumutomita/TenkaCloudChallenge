# Pinned digest, not a floating tag: the fixtures a learner debugs must not change because a
# base image moved underneath them.
#
# This is the OCI *index* digest, verified to resolve against Docker Hub on 2026-07-25. The
# digest the scaffolder copies from the template returns 404 for every platform, so no AC26
# problem built by it can build at all — see this problem's README. Verify a digest before
# pinning it: nothing in CI goes through Docker, so a dead pin passes every check.
FROM python:3.13-slim@sha256:6771159cd4fa5d9bba1258caf0b82e6b73458c694d178ad97c5e925c2d0e1a91 AS base

WORKDIR /problem
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1

# Participant Workbench: public materials only, and NOT `fixtures/`, `tests/hidden/` or
# `verifier/`.
#
# Issue 537/538 (Issue 543 option B2): this single stage used to carry the hidden suite and the
# process that runs it. `tests/hidden/check_design.py` states, in full, the rule each of this
# problem's eight checkpoints is graded on -- `_spec_requirements` is `required_properties`'
# answer written out, `_spec_admissible` is the `admissible` column of `compare_alternatives`,
# `_selection_failures` states the four conditions `select_primitive` is accepted on,
# `_graph_failures` states every condition an `architecture` must meet, `_plan_failures` states
# the attack plan's floor and its vocabulary, and `_matrix_failures` states each row's contract
# down to "a component can only be responsible for a property one of its own options provides".
# `fixtures/generate.py` is gone as well: it draws the whole population every checkpoint is
# graded over -- the six written briefs, their eighteen variants, and the twelve generated from
# the per-deploy seed. A submission transcribed from those two files, with no reasoning past
# copying, scored 4 of 8 checkpoints (155 of 300 points) from the stated rules alone, and 8 of
# 8 (300 of 300) once the remaining four artifacts were built to the conditions the same file
# writes out.
#
# `participant/lab.py` stays: the property vocabulary and the option table are the supplied
# half this problem deliberately hands over, and nothing in them is graded -- `starter/design.py`'s
# own docstring names `PROPERTIES`, `PRIMITIVES`, `ACTOR_TRUSTS` and `OPERATOR_ROLES`, so a
# submission has to be able to import it. `show.py` and the public tests read this deployment's
# brief and its review variant from the verifier's `GET /public` over the Compose-internal
# network (see participant/server.py, show.py, and tests/public/test_design.py).
FROM base AS participant
COPY tests/public/ ./tests/public/
COPY participant/ ./participant/
COPY starter/ ./starter/
COPY show.py ./show.py

CMD ["python", "participant/server.py"]

# Hidden grading runs in a separate, unpublished image reachable only over the
# Compose-internal network (see docker-compose.yml). The Workbench above has the public
# tests, the supplied vocabulary and the starter, but no brief population, no hidden checker,
# and no process that can decide a checkpoint.
#
# `participant/lab.py` is copied in as well, because `fixtures/generate.py` re-exports it and
# the hidden checker grades against the same table -- one implementation of the supplied
# vocabulary, graded and inspected, rather than two that can drift.
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
