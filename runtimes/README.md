# Shared problem runtimes

This directory is for runtime source used unchanged by multiple problems. It is not a second location for problem-specific payloads or root-level test suites.

Each family must have explicit consumers, and those consumers reference the family through their own runtime entry such as `local/docker-compose.yml`. A shared-runtime change must be verified against every affected contract and at least one real consumer path. If only one problem uses an implementation, keep it inside that problem instead.
