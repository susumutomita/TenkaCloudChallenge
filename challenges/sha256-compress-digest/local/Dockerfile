# Pinned digest, not a floating tag: the fixtures a learner debugs must not change
# because a base image moved underneath them.
FROM python:3.13-slim@sha256:6771159cd4fa5d9bba1258caf0b82e6b73458c694d178ad97c5e925c2d0e1a91 AS participant

WORKDIR /problem

COPY given/ ./given/
COPY fixtures/ ./fixtures/
COPY tests/ ./tests/
COPY verifier/ ./verifier/
COPY workbench/ ./workbench/
COPY starter/ ./starter/
COPY show.py ./show.py

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1

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

COPY reference/ ./reference/
COPY mutation.py ./mutation.py
