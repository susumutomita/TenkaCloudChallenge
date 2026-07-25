# Pinned digest, not a floating tag: the fixtures a learner debugs must not change
# because a base image moved underneath them.
#
# This is the digest ac26-w5-extract-key-switch and the two w7 capstones pin, checked with
# `docker manifest inspect` before it was copied here. The one the rest of the Week 5 chain
# carries no longer resolves, which is a catalog-wide problem rather than this problem's --
# do not copy a digest forward from a sibling without checking it still resolves.
FROM python:3.13-slim@sha256:6771159cd4fa5d9bba1258caf0b82e6b73458c694d178ad97c5e925c2d0e1a91

WORKDIR /problem

# reference/ ships inside the image (the mutation suite needs it) and is not bind-mounted,
# so it does not land in the learner's git checkout as a file they did not go looking for.
# That is tidiness, not confidentiality: the participant builds and runs this image, so
# nothing inside it is hidden from them. See TEMPLATE.md "Assurance scope".
COPY fixtures/ ./fixtures/
COPY tests/ ./tests/
COPY verifier/ ./verifier/
COPY reference/ ./reference/
COPY starter/ ./starter/
COPY show.py ./show.py
COPY mutation.py ./mutation.py

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1

CMD ["python", "verifier/server.py"]
