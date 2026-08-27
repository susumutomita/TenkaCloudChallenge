# Pinned digest, not a floating tag: the statements and images a learner binds to must not
# change because a base image moved underneath them.
#
# This is the digest the three ac26-w6-cosnark problems, ac26-w6-zkvm-exploit-predicate and the
# two w7 capstones pin, checked with `docker manifest inspect` before it was copied here. Some
# older Week 5 problems carry a digest that no longer resolves, which is a catalog-wide problem
# rather than this problem's -- do not copy a digest forward from a sibling without checking it
# resolves.
FROM python:3.13-slim@sha256:6771159cd4fa5d9bba1258caf0b82e6b73458c694d178ad97c5e925c2d0e1a91 AS base

WORKDIR /problem
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1

# Participant Workbench: public materials only, and NOT `fixtures/`, `tests/hidden/` or
# `verifier/`.
#
# Issue 537/538 (Issue 543 option B2): this single stage used to carry the hidden suite and the
# process that runs it. `tests/hidden/check_guest.py` holds a complete and correct
# implementation of four of the eight graded functions -- `_encode` is `encode_statement`,
# `_run` is `run_guest`, `_journal` is `seal_journal` and `_leaks` is the policy `leak_report`
# applies -- and `_not_statements`/`_not_witnesses` enumerate every refusal three more of them
# are graded on. `fixtures/generate.py` shipped beside it with `_machine` (the same run again),
# `replay_truth` (which of the fifteen receipts a verifier may accept) and `disclosure_truth`
# (which `(channel, name)` pairs each of the ten audited runs gave away). A submission
# transcribed from those two files, with no reasoning past copying, scored 8 of 8 checkpoints
# (300 of 300 points).
#
# `participant/lab.py` stays. It is the supplied half this problem deliberately hands over --
# the vocabulary, the semantics profiles, the commitment, the image decoder, the two encoders
# and the toy runner, every one of which `starter/guest.py`'s own docstring names, so a
# submission has to be able to import it. `show.py` and the public tests read this deployment's
# statement, image, siblings, witness, colliding pair and audited runs from the verifier's
# `GET /public` over the Compose-internal network (see participant/server.py, show.py, and
# tests/public/test_guest.py).
FROM base AS participant
COPY tests/public/ ./tests/public/
COPY participant/ ./participant/
COPY starter/ ./starter/
COPY show.py ./show.py

CMD ["python", "participant/server.py"]

# Hidden grading runs in a separate, unpublished image reachable only over the
# Compose-internal network (see docker-compose.yml). The Workbench above has the public tests,
# the supplied lab layer and the starter, but no replay verdicts, no disclosure verdicts, no
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
