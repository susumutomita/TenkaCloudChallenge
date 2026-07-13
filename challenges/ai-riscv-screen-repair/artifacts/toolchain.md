# Reproducible toolchain boundary

The lab uses Debian `bookworm-slim` pinned to the multi-platform OCI index:

```text
sha256:60eac759739651111db372c07be67863818726f754804b8707c90979bda511df
```

The image verifies these semantic tool versions during build:

- Verilator `5.006`;
- GNU RISC-V GCC `12.2.0`;
- GNU RISC-V binutils `2.40`;
- Python `3.11`; and
- GNU Make `4.3`.

The OCI index supports the amd64 architecture used by GitHub Codespaces and the
arm64 architecture used by Apple Silicon. A fresh build needs network access to
the pinned Docker image and Debian Bookworm mirrors. Once built, compiling RTL,
running the simulation, serving the lab, and delegated verification require no
network egress.
