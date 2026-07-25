# Pinned digest, not a floating tag: the fixtures a learner debugs must not change because a
# base image moved underneath them.
#
# This is the OCI *index* digest, verified to resolve against Docker Hub on 2026-07-25. The
# digest the scaffolder copies from the template returns 404 for every platform, so no AC26
# problem built by it can build at all. Verify a digest before pinning it: nothing in CI goes
# through Docker, so a dead pin passes every check.
FROM python:3.13-slim@sha256:6771159cd4fa5d9bba1258caf0b82e6b73458c694d178ad97c5e925c2d0e1a91

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
