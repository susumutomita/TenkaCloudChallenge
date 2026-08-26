# Pinned digest, not a floating tag: the fixtures a learner debugs must not change
# because a base image moved underneath them.
FROM python:3.13-slim@sha256:6771159cd4fa5d9bba1258caf0b82e6b73458c694d178ad97c5e925c2d0e1a91 AS base

WORKDIR /problem

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1

# Participant Workbench: the Portal editor API, the starter, the public tests, and the
# input generators the problem statement is made of -- and NOT the grader.
#
# Issue 525/543/537: this used to be the only stage, and it carried `verifier/` too.
# #533 moved the four answer functions out of `fixtures/generate.py`, but the
# derivation they moved into (`verifier/server.py`'s `_expected_root_cause`) shipped
# right here, keyed by the `FLAG_SEED` the learner's own container already has --
# so `root-cause`'s accepted JSON was one `import` away from a learner reading the
# image their own `make build` produced. `verifier/` and `tests/hidden/` are not
# copied into this stage at all any more.
#
# `fixtures/` deliberately stays: after #533 it returns INPUTS only (the deployed
# circuit, the parameters, the two honest witnesses), which is exactly what
# `make inspect` prints. Removing it would hide the problem statement, not an answer.
FROM base AS participant

COPY fixtures/ ./fixtures/
COPY tests/public/ ./tests/public/
COPY participant/ ./participant/
COPY starter/ ./starter/
COPY show.py ./show.py

CMD ["python", "participant/server.py"]

# Hidden grading runs in a separate image that docker-compose.yml never publishes to
# the host: it is reachable only from the Workbench, over the internal `lab` network.
# It has no Portal editor API and serves nothing but `POST /verify` and `GET /healthz`.
FROM base AS verifier

COPY fixtures/ ./fixtures/
COPY tests/hidden/ ./tests/hidden/
COPY verifier/ ./verifier/

CMD ["python", "verifier/server.py"]

# Author-only target for `make reference-test`, which runs the mutation suite. It adds
# the grader, the hidden checks, the reference solution and the mutation harness back
# on top of the participant image.
#
# This is misdelivery prevention, not confidentiality. Whoever builds the author stage
# can read everything in it, and a participant can build it too.
# See TEMPLATE.md "Assurance scope" -- the boundary claim there has not changed.
FROM participant AS author

COPY tests/hidden/ ./tests/hidden/
COPY verifier/ ./verifier/
COPY reference/ ./reference/
COPY mutation.py ./mutation.py
