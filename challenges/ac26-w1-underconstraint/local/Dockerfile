# Pinned digest, not a floating tag: the fixtures a learner debugs must not change
# because a base image moved underneath them.
FROM python:3.13-slim@sha256:6771159cd4fa5d9bba1258caf0b82e6b73458c694d178ad97c5e925c2d0e1a91 AS base

WORKDIR /problem

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1

# Participant Workbench: the Portal editor API, the starter, the public tests and the
# supplied residual evaluator -- and NOT the grader, and NOT the generators.
#
# Issue 525/543/537: this used to be the only stage, and it carried `verifier/` too.
# #533 moved the four answer functions out of `fixtures/generate.py`, but the
# derivation they moved into (`verifier/server.py`'s `_expected_root_cause`) shipped
# right here, keyed by the `FLAG_SEED` the learner's own container already has --
# so `root-cause`'s accepted JSON was one `import` away from a learner reading the
# image their own `make build` produced. `verifier/` and `tests/hidden/` are not
# copied into this stage at all any more.
#
# `fixtures/` used to stay here as well, on the grounds that after #533 it returned
# INPUTS only. That was wrong, and this is the Issue 543 option B2 split that fixes it:
# `_ISZERO_HALVES` is both halves of the is-zero gadget as dicts, under the exact
# `c-iszero-a` / `c-iszero-b` ids the checkpoints require, so `intended_circuit()` was a
# copy out of that file and `audit` and `repair` fell out of it as a set difference
# against the deployed circuit. Measured on the shipped image: transcription alone
# scored 3 of 6 checkpoints (160 of 300 points), and transcription plus a scan over the
# supplied evaluator scored 5 of 6 (260 of 300) -- every checkpoint a code submission
# can reach, the same score as the reference.
#
# `participant/evaluator.py` stays. It is the supplied half this problem deliberately
# hands over -- its own docstring says so, ac26-w1-constraint-lab is where a learner
# builds it -- so the public tests and a submission both have to be able to import it.
# `show.py`, the Portal's inspect endpoint and the public tests read this deployment's
# parameters, deployed circuit and honest witnesses from the verifier's `GET /public`
# over the Compose-internal network (see participant/evidence.py).
FROM base AS participant

COPY tests/public/ ./tests/public/
COPY participant/ ./participant/
COPY starter/ ./starter/
COPY show.py ./show.py

CMD ["python", "participant/server.py"]

# Hidden grading runs in a separate image that docker-compose.yml never publishes to
# the host: it is reachable only from the Workbench, over the internal `lab` network.
# It has no Portal editor API and serves `POST /verify`, `GET /healthz` and the
# `GET /public` the Workbench reads this deployment's public half from.
#
# `participant/evaluator.py` is copied in as well, because the hidden checker grades
# through the same residual evaluator the learner is handed -- one implementation,
# graded and inspected, rather than two that can drift. It is also what the runner
# preloads ahead of the Issue 591 guard so a submission's own import resolves.
FROM base AS verifier

COPY participant/evaluator.py ./participant/evaluator.py
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
