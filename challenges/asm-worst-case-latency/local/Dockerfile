# Pinned digest, not a floating tag: a timing lab must not change because a base
# image moved. gcc and binutils are the measurement, so they are pinned with it.
FROM debian:12-slim@sha256:2ccc7e39b0a6f504d252f807da1fc4b5bcd838e83e4dec3e9001c1c376361b4a AS base

RUN apt-get update \
    && apt-get install -y --no-install-recommends gcc binutils libc6-dev python3 \
    && rm -rf /var/lib/apt/lists/*

RUN useradd --create-home --uid 10001 lab
WORKDIR /problem
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1

# Participant Workbench: the harness, the starter, the public tests. Not the
# reference candidate and not the mutation suite.
FROM base AS participant
COPY --chown=lab:lab fixtures/ ./fixtures/
COPY --chown=lab:lab harness/ ./harness/
COPY --chown=lab:lab tests/public/ ./tests/public/
COPY --chown=lab:lab workbench/ ./workbench/
COPY --chown=lab:lab starter/ ./starter/
COPY --chown=lab:lab show.py ./show.py
USER lab
CMD ["python3", "workbench/server.py"]

# Hidden verifier: a separate image on the Compose-internal network. It carries
# the grader and the harness, and it does not carry the reference answer.
FROM base AS verifier
COPY --chown=lab:lab fixtures/ ./fixtures/
COPY --chown=lab:lab harness/ ./harness/
COPY --chown=lab:lab verifier/ ./verifier/
USER lab
CMD ["python3", "verifier/server.py"]

# Author/CI only. Local mode is honor-system verification: this stage prevents an
# accidental answer delivery, not a participant who controls Docker from
# inspecting it. See TEMPLATE.md "Assurance scope" for the boundary claim.
FROM participant AS author
COPY --chown=lab:lab verifier/ ./verifier/
COPY --chown=lab:lab reference/ ./reference/
COPY --chown=lab:lab mutation.py ./mutation.py
