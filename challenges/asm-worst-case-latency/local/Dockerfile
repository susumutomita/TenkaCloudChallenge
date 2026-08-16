# Pinned image and Debian snapshots: a timing lab must not change assembler,
# disassembler, compiler, or libc because a tag or package mirror moved.
FROM debian:12-slim@sha256:abd67ffcfa541b485a3dff59865ab629aa048a6c613e639d36e7456b0b229241 AS base

RUN sed -i \
      -e 's|URIs: http://deb.debian.org/debian$|URIs: http://snapshot.debian.org/archive/debian/20260803T000000Z|' \
      -e 's|URIs: http://deb.debian.org/debian-security$|URIs: http://snapshot.debian.org/archive/debian-security/20260803T000000Z|' \
      /etc/apt/sources.list.d/debian.sources \
    && printf 'Acquire::Check-Valid-Until "false";\n' > /etc/apt/apt.conf.d/99snapshot \
    && apt-get update \
    && apt-get install -y --no-install-recommends \
      gcc=4:12.2.0-3 \
      binutils=2.40-2 \
      libc6-dev=2.36-9+deb12u14 \
      python3=3.11.2-1+b1 \
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
# the hidden checks and the harness, and it does not carry the reference answer.
FROM base AS verifier
COPY --chown=lab:lab fixtures/ ./fixtures/
COPY --chown=lab:lab harness/ ./harness/
COPY --chown=lab:lab tests/hidden/ ./tests/hidden/
COPY --chown=lab:lab verifier/ ./verifier/
USER lab
CMD ["python3", "verifier/server.py"]

# Author/CI only. Local mode is honor-system verification: this stage prevents an
# accidental answer delivery, not a participant who controls Docker from
# inspecting it. See TEMPLATE.md "Assurance scope" for the boundary claim.
FROM participant AS author
COPY --chown=lab:lab tests/hidden/ ./tests/hidden/
COPY --chown=lab:lab verifier/ ./verifier/
COPY --chown=lab:lab reference/ ./reference/
COPY --chown=lab:lab mutation.py ./mutation.py
