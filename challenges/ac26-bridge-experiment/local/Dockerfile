# Pinned digest, not a floating tag: the fixtures a learner debugs must not change
# because a base image moved underneath them.
FROM python:3.13-slim@sha256:4efa69bf17cfbd83a9942e60e2642335c3b397448e5b4a1cf1e2ea7bfcd1b8dd

WORKDIR /problem

# reference/ ships inside the image (the mutation suite needs it) but is never
# mounted to the host, so a learner cannot read the answer out of their checkout.
COPY fixtures/ ./fixtures/
COPY tests/ ./tests/
COPY verifier/ ./verifier/
COPY reference/ ./reference/
COPY starter/ ./starter/
COPY show.py ./show.py
COPY mutation.py ./mutation.py

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1

CMD ["python", "verifier/server.py"]
