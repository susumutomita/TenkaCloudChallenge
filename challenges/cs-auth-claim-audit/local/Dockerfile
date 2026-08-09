# Pinned digest, not a floating tag: the fixtures a learner debugs must not change
# because a base image moved underneath them.
FROM python:3.13-slim@sha256:6771159cd4fa5d9bba1258caf0b82e6b73458c694d178ad97c5e925c2d0e1a91 AS participant

RUN useradd --create-home --uid 10001 lab

WORKDIR /problem

COPY --chown=lab:lab fixtures/ ./fixtures/
COPY --chown=lab:lab tests/ ./tests/
COPY --chown=lab:lab verifier/ ./verifier/
COPY --chown=lab:lab starter/ ./starter/
COPY --chown=lab:lab show.py ./show.py

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1

USER lab

CMD ["python", "verifier/server.py"]

# Two stages, because two different audiences build this image.
#
# `participant` is what `make build` produces and what a learner runs. It carries
# the fixtures, the public and hidden tests, the verifier and the starter -- and
# NOT the reference solution or the mutation suite, because a learner has no use
# for either and shipping them is a way to hand over an answer by accident.
#
# `author` adds them back for `make reference-test`, which is the authoring and CI
# path. Nothing in the participant path loads `reference/`: only mutation.py does,
# which is why the split is clean rather than a compromise.
#
# This is misdelivery prevention, not confidentiality. Whoever builds the author
# stage can read everything in it, and a participant can build it too. See
# TEMPLATE.md "Assurance scope" -- the boundary claim there has not changed.
FROM participant AS author

COPY --chown=lab:lab reference/ ./reference/
COPY --chown=lab:lab mutation.py ./mutation.py
