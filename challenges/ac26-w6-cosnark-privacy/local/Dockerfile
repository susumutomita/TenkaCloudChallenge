# Pinned digest, not a floating tag: the specimens a learner audits must not change because
# a base image moved underneath them.
#
# This is the digest ac26-w6-cosnark-linear, ac26-w6-cosnark-beaver and the two w7 capstones
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
# the process that runs it. `tests/hidden/check_prover.py` holds the rules every checkpoint is
# graded against -- `_expected_class` is `classify`'s answer, `_authorized` is `open-set`'s,
# `_expected_leakage` is `leakage`'s -- and `fixtures/specimens.py` shipped beside it with
# `GROUND_TRUTH`, which names per specimen the capabilities reached beyond the protocol's own,
# how many openings were unauthorized, the disclosed `(channel, name)` pairs and the
# recoverable secret, for exactly the eight provers the problem asks about. `fixtures/
# generate.py` is gone as well: `setting`, `coefficients`, `witness`, `relation` and
# `value_catalog` are what the hidden labels `h0`..`h3` are drawn from, and therefore what
# every checkpoint is graded on.
#
# `participant/` stays. The sharing runtime, the disclosure sink, the policy vocabulary and
# the two answers this problem hands over (`participant/mpc.py`) are supplied material; so is
# the bench (`participant/lab.py`); and the eight specimens (`participant/specimens.py`) are
# runnable objects the learner audits, which is why they ship without the table of answers
# about them. `show.py` and the public tests read this deployment's setting, row, witness and
# catalog from the verifier's `GET /public` over the Compose-internal network (see
# participant/server.py, participant/lab.py, show.py, and tests/public/test_prover.py).
FROM base AS participant
COPY tests/public/ ./tests/public/
COPY participant/ ./participant/
COPY starter/ ./starter/
COPY show.py ./show.py

CMD ["python", "participant/server.py"]

# Hidden grading runs in a separate, unpublished image reachable only over the
# Compose-internal network (see docker-compose.yml). The Workbench above has the public
# tests, the supplied layer, the specimens and the starter, but no seed derivation, no
# ground truth, no hidden checker, and no process that can decide a checkpoint.
#
# `participant/` is copied in as well, because `fixtures/generate.py` re-exports the supplied
# layer, `fixtures/specimens.py` re-exports the specimens, and the hidden checker builds its
# scenarios on `participant/lab.py`. One implementation, graded and inspected, rather than two
# that can drift.
FROM base AS verifier
COPY participant/mpc.py ./participant/mpc.py
COPY participant/specimens.py ./participant/specimens.py
COPY participant/lab.py ./participant/lab.py
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
