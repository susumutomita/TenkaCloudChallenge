# Pinned digest, not a floating tag: the fixtures a learner debugs must not change
# because a base image moved underneath them.
#
# This is the digest ac26-w6-cosnark-beaver, ac26-w5-pbs-homnand and the two w7 capstones
# pin, checked with `docker manifest inspect` before it was copied here. Some older Week 5
# problems carry a digest that no longer resolves, which is a catalog-wide problem rather than
# this problem's -- do not copy a digest forward from a sibling without checking it resolves.
FROM python:3.13-slim@sha256:6771159cd4fa5d9bba1258caf0b82e6b73458c694d178ad97c5e925c2d0e1a91 AS base

WORKDIR /problem
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1

# Participant Workbench: public materials only, and NOT `fixtures/`, `tests/hidden/` or
# `verifier/`.
#
# Issue 537/538 (Issue 543 option B2): this single stage used to carry the hidden suite and
# the process that runs it. `tests/hidden/check_prover.py` states, phase by phase, what every
# one of this problem's eight checkpoints is graded on -- `_Scenario.canonical` is the
# parser's answer and the `malformed` list beside it is the whole of what that stage must
# refuse, `check_witness` writes out the reported keys and the five tamperings,
# `_trace_failures` computes `operations`, `rounds`, `messages`, `parties` and `localOnly` in
# the report's own terms, and `check_audit` gives the five values an honest run reports beside
# the three runtimes named for what each one catches. `fixtures/generate.py` is gone as well:
# `setting`, `coefficients`, `witness` and `relation` are what the hidden labels `h0`..`h3`
# are drawn from, and therefore what every checkpoint is graded on. A submission transcribed
# from those two files, with no reasoning past copying, scored all eight checkpoints, 300 of
# 300 points.
#
# `participant/mpc.py` stays: the shares, the instrumented runtime and the participant facade
# are the supplied half this problem deliberately hands over -- two earlier problems' answers
# -- and nothing here is graded. `show.py` and the public tests read this deployment's
# setting, row and witness from the verifier's `GET /public` over the Compose-internal network
# (see participant/server.py, show.py, and tests/public/test_prover.py).
FROM base AS participant
COPY tests/public/ ./tests/public/
COPY participant/ ./participant/
COPY starter/ ./starter/
COPY show.py ./show.py

CMD ["python", "participant/server.py"]

# Hidden grading runs in a separate, unpublished image reachable only over the
# Compose-internal network (see docker-compose.yml). The Workbench above has the public
# tests, the supplied layer and the starter, but no seed derivation, no hidden checker, and
# no process that can decide a checkpoint.
#
# `participant/mpc.py` is copied in as well, because `fixtures/generate.py` re-exports it and
# the hidden checker builds its scenarios on it -- one implementation of the sharing layer,
# graded and inspected, rather than two that can drift.
FROM base AS verifier
COPY participant/mpc.py ./participant/mpc.py
COPY fixtures/ ./fixtures/
COPY tests/hidden/ ./tests/hidden/
COPY verifier/ ./verifier/

CMD ["python", "verifier/server.py"]

# Author-only target. Local mode remains honor-system verification for whoever controls
# Docker; the stage split prevents accidental answer delivery, not inspection by somebody
# controlling Docker. See TEMPLATE.md "Assurance scope" for the participant-facing boundary
# claim.
#
# This target is `FROM participant`, so dropping `fixtures/` above takes it out of the author
# image too unless it is copied back -- and mutation.py, the hidden suite and the reference
# all need it.
FROM participant AS author

COPY fixtures/ ./fixtures/
COPY tests/hidden/ ./tests/hidden/
COPY verifier/ ./verifier/
COPY reference/ ./reference/
COPY mutation.py ./mutation.py
