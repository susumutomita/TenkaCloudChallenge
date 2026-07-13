FROM debian:bookworm-slim@sha256:60eac759739651111db372c07be67863818726f754804b8707c90979bda511df

ARG VERILATOR_VERSION=5.006
ARG RISCV_GCC_VERSION=12.2.0

RUN apt-get update \
    && apt-get install --yes --no-install-recommends \
      binutils-riscv64-unknown-elf \
      ca-certificates \
      gcc-riscv64-unknown-elf \
      g++ \
      make \
      python3 \
      verilator \
    && rm -rf /var/lib/apt/lists/* \
    && test "$(verilator --version | awk '{print $2}')" = "$VERILATOR_VERSION" \
    && test "$(riscv64-unknown-elf-gcc -dumpfullversion)" = "$RISCV_GCC_VERSION" \
    && printf 'Verilator %s\nRISC-V GCC %s\n' "$VERILATOR_VERSION" "$RISCV_GCC_VERSION" > /toolchain-versions.txt \
    && useradd --create-home --uid 10001 lab

WORKDIR /workspace
COPY --chown=lab:lab . /workspace
RUN chown lab:lab /workspace
USER lab

EXPOSE 8080 8081
CMD ["python3", "tools/server.py"]
