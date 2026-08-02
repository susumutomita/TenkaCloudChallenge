# Pinned digest, not a floating tag: the numbers a learner adds up on paper must not
# change because a base image moved underneath them.
FROM python:3.13-slim@sha256:6771159cd4fa5d9bba1258caf0b82e6b73458c694d178ad97c5e925c2d0e1a91 AS participant

WORKDIR /problem

COPY fixtures/ ./fixtures/
COPY lab/ ./lab/
COPY tests/ ./tests/
COPY verifier/ ./verifier/
COPY shares.py ./shares.py

# The whole problem is played from the container terminal, which sends one line at a
# time and has no TTY. `shares <command>` therefore has to work from whatever directory
# that terminal opens in, so the entry point goes on PATH and shares.py resolves its
# imports from its own location rather than from the working directory.
RUN printf '#!/bin/sh\nexec python /problem/shares.py "$@"\n' > /usr/local/bin/shares \
    && chmod 0755 /usr/local/bin/shares

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1

CMD ["python", "verifier/server.py"]

# Two stages, because two different audiences build this image.
#
# `participant` is what a learner runs. It carries the fixtures, the lab (the one-line
# rule language, the four judgements and the progress store), the public self-check and
# the verifier -- and NOT the reference answers or the mutation suite, because a learner
# has no use for either and shipping them is a way to hand over an answer by accident.
#
# The judge is in the participant stage on purpose: the participant runs it, in their own
# terminal, against their own readings. It states what each stage has to satisfy; it holds
# none of the four answers. See TEMPLATE.md "Assurance scope" for what the arrangement
# does and does not claim.
#
# `author` adds the answers back for `make reference-test`, which is the authoring and CI
# path. Nothing in the participant path loads `reference/`: only mutation.py does, which
# is why the split is clean rather than a compromise.
#
# This is misdelivery prevention, not confidentiality. Whoever builds the author stage can
# read everything in it, and a participant can build it too. See TEMPLATE.md "Assurance
# scope" -- the boundary claim there has not changed.
FROM participant AS author

COPY reference/ ./reference/
COPY mutation.py ./mutation.py
