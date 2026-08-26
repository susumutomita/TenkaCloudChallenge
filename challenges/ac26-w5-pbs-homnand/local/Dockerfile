# Pinned digest, not a floating tag: the fixtures a learner debugs must not change
# because a base image moved underneath them.
#
# This is the digest ac26-w5-extract-key-switch and the two w7 capstones pin, checked with
# `docker manifest inspect` before it was copied here. The one the rest of the Week 5 chain
# carries no longer resolves, which is a catalog-wide problem rather than this problem's --
# do not copy a digest forward from a sibling without checking it still resolves.
FROM python:3.13-slim@sha256:6771159cd4fa5d9bba1258caf0b82e6b73458c694d178ad97c5e925c2d0e1a91 AS base

WORKDIR /problem
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1

# Participant Workbench: public materials only, and NOT `fixtures/`, `tests/hidden/` or
# `verifier/`.
#
# Issue 543/537: this single stage used to carry the hidden suite and the process that runs
# it. All eight of this problem's checkpoints are graded by running
# `tests/hidden/check_pipeline.py` against the learner's file, so shipping that file handed
# the person being graded the exact assertions.
#
# Issue 543's option B2 is why `fixtures/` is gone too. `fixtures/generate.py` has to
# implement working `lookup_accumulator`, `to_rotation_domain`, `blind_rotate`,
# `output_noise_bound`, `correctness_bound`, `refresh_report` and `nand_combine` to derive
# this deployment's trace rows and noise contract -- seven of the twelve names
# `starter/pipeline.py` asks the learner to write. While it shipped here every one of them
# was a single import away, with no comparison anywhere near them. `show.py` now fetches
# this deployment's public half from the verifier's `GET /public` over the Compose-internal
# network (see show.py and the VERIFIER_PUBLIC_URL wiring in docker-compose.yml).
#
# `participant/fhe.py` stays -- it is the supplied Week 5 stack (the ring and the encoding,
# LWE and RLWE, the gadget and RGSW, CMUX and rotation, extraction and key switching), which
# this problem explicitly supplies rather than grades because five earlier problems are
# where those are the exercise. `starter/pipeline.py` imports from it on its first line, and
# so do the public tests.
FROM base AS participant
COPY tests/public/ ./tests/public/
COPY participant/ ./participant/
COPY starter/ ./starter/
COPY show.py ./show.py

CMD ["python", "participant/server.py"]

# Hidden grading runs in a separate, unpublished image reachable only over the
# Compose-internal network (see docker-compose.yml). The Workbench above has the public
# tests and the answer-sealing adapter, but no fixture derivation, no hidden checker and no
# scoring process.
#
# `participant/fhe.py` is copied in below rather than left out: it is the supplied stack the
# fixture generator, the reference and the hidden checker all import, so that the arithmetic
# a learner builds on and the one they are graded against cannot drift apart. The Portal
# server and its adapter are deliberately absent from this stage.
FROM base AS verifier
COPY participant/fhe.py ./participant/fhe.py
COPY fixtures/ ./fixtures/
COPY tests/hidden/ ./tests/hidden/
COPY verifier/ ./verifier/

CMD ["python", "verifier/server.py"]

# Author-only target. Local mode remains honor-system verification for whoever controls
# Docker; the stage split prevents accidental answer delivery, not inspection by somebody
# controlling Docker. See TEMPLATE.md "Assurance scope" for the participant-facing boundary
# claim.
#
# This target is `FROM participant`, so dropping `fixtures/` above takes it out of the
# author image too unless it is copied back -- and mutation.py, the hidden suite and the
# seed sweep all need it.
FROM participant AS author

COPY fixtures/ ./fixtures/
COPY tests/hidden/ ./tests/hidden/
COPY verifier/ ./verifier/
COPY reference/ ./reference/
COPY mutation.py ./mutation.py
