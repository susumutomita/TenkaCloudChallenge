# Pinned digest, not a floating tag: the architectures a learner diagnoses must not change
# because a base image moved underneath them.
#
# This is the digest the three ac26-w6-cosnark problems, both zkvm problems and the two w7
# capstones pin, checked with `docker manifest inspect` before it was copied here. Some older
# Week 5 problems carry a digest that no longer resolves, which is a catalog-wide problem rather
# than this problem's -- do not copy a digest forward from a sibling without checking it
# resolves.
FROM python:3.13-slim@sha256:6771159cd4fa5d9bba1258caf0b82e6b73458c694d178ad97c5e925c2d0e1a91 AS base

WORKDIR /problem
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1

# Participant Workbench: public materials only, and NOT `fixtures/`, `tests/hidden/` or
# `verifier/`.
#
# Issue 537/538 (Issue 543 option B2): this single stage used to carry the hidden suite and the
# process that runs it. `fixtures/generate.py` holds this problem's entire ground truth under
# other names -- `constrained` is `carried`, `underwritten` is `underwrites`, `load_bearing` is
# `property_map`, `violations` is `contract_violations`, `first_broken` is `first_failure`,
# `selection_truth` is `select`, and `_one_change_neighbours` with `local_checks_pass`,
# `properties_at_risk` and `_whole` is the whole search `counterexample` and `repair` are graded
# on -- beside `BREAKS`, which names per variant, and identically on every seed, which node or
# edge each deployment broke and which attribute it changed. `tests/hidden/check_stack.py`
# shipped with it. A submission transcribed from those two files, with no reasoning past copying,
# scored 8 of 8 checkpoints (300 of 300 points).
#
# `participant/lab.py` stays. It is the supplied half this problem deliberately hands over --
# the closed vocabularies, the three levels of contract, the eleven boundary classes and what
# breaking one costs, and four accessors for walking a typed graph, every one of which
# `starter/stack.py`'s own docstring names, so a submission has to be able to import it.
# `show.py` and the public tests read this deployment's three sound architectures, its thirteen
# deployments to diagnose and its eight briefs from the verifier's `GET /public` over the
# Compose-internal network (see participant/server.py, show.py, and tests/public/test_stack.py).
FROM base AS participant
COPY tests/public/ ./tests/public/
COPY participant/ ./participant/
COPY starter/ ./starter/
COPY show.py ./show.py

CMD ["python", "participant/server.py"]

# Hidden grading runs in a separate, unpublished image reachable only over the
# Compose-internal network (see docker-compose.yml). The Workbench above has the public tests,
# the supplied lab layer and the starter, but no break table, no ground-truth functions, no
# hidden checker, and no process that can decide a checkpoint.
#
# `participant/lab.py` is copied in as well, because `fixtures/generate.py` re-exports it and
# the hidden checker grades against the same vocabulary -- one implementation of the supplied
# half, graded and inspected, rather than two that can drift. It is also what the runner
# preloads ahead of the Issue 591 guard so a submission's own top-level import resolves.
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
