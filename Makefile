.DEFAULT_GOAL := help

.PHONY: help install install_ci validate agent-gate

help:
	@echo "TenkaCloudChallenge quality commands"
	@echo "  make install      Install dependencies without lifecycle scripts"
	@echo "  make install_ci   Install the frozen dependency graph"
	@echo "  make validate     Run the complete catalog validation suite"
	@echo "  make agent-gate   Run the deterministic completion contract for agents"

install:
	bun install --ignore-scripts

install_ci:
	bun install --frozen-lockfile --ignore-scripts

validate:
	bun run validate
	bun run simulator:compatibility
	bun run scripts/build-index.ts --check
	bun run cost:check
	bun run course:drift

# Symphony, Codex, Claude Code, and CI share this single completion contract.
# Add checks to validate instead of teaching each agent a different command list.
agent-gate: validate
