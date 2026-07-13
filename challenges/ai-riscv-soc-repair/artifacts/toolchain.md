# Reproducible toolchain boundary

The lab image uses the multi-platform Debian `bookworm-slim` OCI index pinned at:

```text
sha256:60eac759739651111db372c07be67863818726f754804b8707c90979bda511df
```

The Docker build installs packages only from that image's Debian Bookworm APT
configuration and then fails unless these semantic tool versions match:

- Verilator `5.006` (Debian package revision observed: `5.006-3`)
- GNU RISC-V GCC `12.2.0` (observed arm64 package revision:
  `12.2.0-14+deb12u1+11+b2`)
- GNU RISC-V binutils `2.40` (observed arm64 package revision: `2.40-2+4+b1`)
- Python `3.11`; GNU Make `4.3`

Why semantic checks instead of pinning the complete APT revision: Debian's binary
rebuild suffix can differ between `linux/amd64` (Codespaces) and `linux/arm64`
(Apple Silicon), while the compiler behavior under test must remain the same.
The OCI base index is multi-platform and content-addressed; the build fails on
a Verilator or GCC version drift.

## Network boundary

A fresh image build needs outbound HTTPS/HTTP access to Docker Hub for the
pinned OCI index and to the Debian Bookworm mirrors for APT packages. Running
the built image, compiling firmware/RTL, serving the lab, and grading require no
network egress. A fresh `--no-cache --pull` build and red/green simulation
should be recorded in the PR test plan; CI cannot prove future mirror
availability.
