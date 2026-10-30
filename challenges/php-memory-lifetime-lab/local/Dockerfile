# Build tiny teaching binaries (buggy/fixed ± AddressSanitizer).
FROM debian:bookworm-slim@sha256:99c0b25c46d0214d5a2091092e7908907dcaecd6a962cde0ac700acee222b6f3 AS cbuild
RUN apt-get update \
  && apt-get install -y --no-install-recommends gcc make libc6-dev \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /src
COPY c/ /src/
RUN mkdir -p /out && make BINDIR=/out && ls -la /out

FROM node:22.23.4-bookworm-slim@sha256:4b150b48b4116e2a22f2c39cc27025fbf4f153e2078fd3b14d159fdb5c7279da AS surface
RUN apt-get update \
  && apt-get install -y --no-install-recommends gdb libasan8 \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /lab
COPY --from=cbuild /out/ /lab/bin/
COPY app/ /lab/app/
ENV LAB_BIN_DIR=/lab/bin
ENV BIND=0.0.0.0
USER node
EXPOSE 8080
CMD ["node", "app/server.mjs"]

FROM node:22.23.4-bookworm-slim@sha256:4b150b48b4116e2a22f2c39cc27025fbf4f153e2078fd3b14d159fdb5c7279da AS verifier
WORKDIR /lab
COPY app/flags.mjs /lab/app/flags.mjs
COPY verify/ /lab/verify/
ENV BIND=0.0.0.0
USER node
EXPOSE 8081
CMD ["node", "verify/server.mjs"]
