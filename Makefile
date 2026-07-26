.DEFAULT_GOAL := help

SIMULATOR_CHECKOUT ?=
SIMULATOR_REPORT ?= reports/simulator-coverage.json

.PHONY: help install install_ci validate agent-gate simulator-compatibility

help:
	@echo "TenkaCloudChallenge quality commands"
	@echo "  make install      Install dependencies without lifecycle scripts"
	@echo "  make install_ci   Install the frozen dependency graph"
	@echo "  make validate     Run the complete repository-local catalog contract"
	@echo "  make agent-gate   Run the deterministic completion contract for agents"
	@echo "  make simulator-compatibility SIMULATOR_CHECKOUT=/absolute/path/to/TenkaCloudSimulator"

install:
	bun install --ignore-scripts

install_ci:
	bun install --frozen-lockfile --ignore-scripts

# The expensive problem suite, schemas, template checks, Simulator workload,
# generator drift, cost drift, and course references are all repository-local.
# Cross-repository capability coverage is intentionally a separate target and
# CI workflow because it needs an immutable Simulator checkout.
validate:
	bun run validate
	bun run scripts/build-index.ts --check
	bun run cost:check
	bun run course:drift

simulator-compatibility:
	@test -n "$(SIMULATOR_CHECKOUT)" || { \
		echo "SIMULATOR_CHECKOUT must be an absolute, clean TenkaCloudSimulator checkout" >&2; \
		exit 2; \
	}
	bun run simulator:compatibility \
		--simulator "$(SIMULATOR_CHECKOUT)" \
		--output "$(SIMULATOR_REPORT)"

# Symphony, Codex, Claude Code, and CI share this single repository-local
# completion contract. The pinned simulator-compatibility workflow remains a
# second required cross-repository proof instead of cloning another repo here.
agent-gate: validate
