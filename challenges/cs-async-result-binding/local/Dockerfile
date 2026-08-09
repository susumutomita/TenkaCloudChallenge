# syntax=docker/dockerfile:1
# Pinned runtime: a scheduler or base-image update must not silently change a lab fixture.
FROM python:3.13-slim@sha256:6771159cd4fa5d9bba1258caf0b82e6b73458c694d178ad97c5e925c2d0e1a91 AS base

RUN useradd --create-home --uid 10001 lab
WORKDIR /problem
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1

FROM base AS participant
COPY --chown=lab:lab fixtures/ ./fixtures/
COPY --chown=lab:lab tests/public/ ./tests/public/
COPY --chown=lab:lab portal/ ./portal/
COPY --chown=lab:lab starter/ ./starter/
COPY --chown=lab:lab sandbox.py show.py ./
USER lab
EXPOSE 8080
CMD ["python", "portal/server.py"]

FROM base AS verifier
COPY --chown=lab:lab fixtures/ ./fixtures/
COPY --chown=lab:lab tests/hidden/ ./tests/hidden/
COPY --chown=lab:lab verifier/ ./verifier/
COPY --chown=lab:lab sandbox.py ./sandbox.py
USER lab
EXPOSE 8081
CMD ["python", "verifier/server.py"]

# Author-only target. Neither reference nor mutation sources are present in the
# participant or deployed verifier stages. This is misdelivery prevention, not a
# confidentiality boundary; see TEMPLATE.md "Assurance scope".
FROM participant AS author
COPY --chown=lab:lab tests/hidden/ ./tests/hidden/
COPY --chown=lab:lab reference/ ./reference/
COPY --chown=lab:lab mutation.py ./mutation.py
USER lab
