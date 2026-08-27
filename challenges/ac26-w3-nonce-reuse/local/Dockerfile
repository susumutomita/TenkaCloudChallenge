# Pinned digest, not a floating tag: the fixtures a learner debugs must not change
# because a base image moved underneath them.
FROM python:3.13-slim@sha256:6771159cd4fa5d9bba1258caf0b82e6b73458c694d178ad97c5e925c2d0e1a91 AS base

WORKDIR /problem
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1

# Participant Workbench: public materials only, and NOT `fixtures/`, `tests/hidden/` or
# `verifier/`.
#
# Issue 537/538 (Issue 543 option B2): this single stage used to carry the hidden suite,
# the seed derivation and the process that runs them. Three things in
# `fixtures/generate.py` are answers rather than material:
#
#   * `audit_log` returns `victim_secret` and `victim_public` beside the records. The
#     `hunt` checkpoint is graded on recovering exactly that key and naming exactly that
#     public key, so the function that builds the log also hands over what the attack is
#     supposed to produce.
#   * `secret_key` derives every key in this deployment from `FLAG_SEED` and a label, and
#     the participant container has `FLAG_SEED` in its environment. The hidden phases are
#     three fixed labels, so a learner could compute their keys here and hard-code them
#     into a submission instead of attacking a log.
#   * `deterministic_nonce` is the `repair` checkpoint's answer, with a docstring saying
#     what has to go into the hash and why the message alone is not enough.
#
# `tests/hidden/check_recover.py` left too: its `_really_accepts` is the acceptance rule
# `detect` is graded on, and `check_detect`'s own failure branches state the two other
# conditions a reported pair must meet.
#
# What a learner does need is the supplied half -- the group, the Fiat-Shamir challenge,
# and the signing routine the previous two problems built -- plus `truncated_nonce`,
# which the `collision` checkpoint exists to have measured. Those moved to
# `participant/schnorr.py`, which both this stage and the verifier stage carry.
# `show.py` fetches this deployment's public half from the verifier's `GET /public` over
# the Compose-internal network (see participant/server.py and show.py).
FROM base AS participant
COPY tests/public/ ./tests/public/
COPY participant/ ./participant/
COPY starter/ ./starter/
COPY show.py ./show.py

CMD ["python", "participant/server.py"]

# Hidden grading runs in a separate, unpublished image reachable only over the
# Compose-internal network (see docker-compose.yml). The Workbench above has the public
# tests and the starter, but no seed derivation, no hidden checker, and no process that
# can decide a checkpoint.
#
# `participant/schnorr.py` is copied on its own rather than the whole directory: the
# submission has to be able to import it at grading time (the `collision` checkpoint
# measures `truncated_nonce`), and `fixtures/generate.py` re-exports the protocol from
# it, but the Workbench's own server and Portal support have no business running here.
FROM base AS verifier
COPY participant/schnorr.py ./participant/schnorr.py
COPY fixtures/ ./fixtures/
COPY tests/ ./tests/
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
COPY tests/ ./tests/
COPY verifier/ ./verifier/
COPY reference/ ./reference/
COPY mutation.py ./mutation.py
