.DEFAULT_GOAL := help

SIMULATOR_CHECKOUT ?=
SIMULATOR_REPORT ?= reports/simulator-coverage.json
SYMPHONY_WORKFLOW ?= .symphony/WORKFLOW.md

.PHONY: help install install_ci validate validate-offline agent-gate symphony-agent-gate simulator-compatibility symphony-validate symphony-print symphony-run

help:
	@echo "TenkaCloudChallenge quality commands"
	@echo "  make install      Install dependencies without lifecycle scripts"
	@echo "  make install_ci   Install the frozen dependency graph"
	@echo "  make validate     Run the complete repository-local catalog contract"
	@echo "  make agent-gate   Run the deterministic completion contract for agents"
	@echo "  make symphony-agent-gate  Run the offline gate inside isolated Symphony"
	@echo "  make symphony-validate  Validate this repository's Symphony workflow"
	@echo "  make symphony-run       Run this repository's Symphony instance"
	@echo "  make simulator-compatibility SIMULATOR_CHECKOUT=/absolute/path/to/TenkaCloudSimulator"

install:
	bun install --ignore-scripts

install_ci:
	bun install --frozen-lockfile --ignore-scripts

validate-offline:
	bun run validate
	bun run scripts/build-index.ts --check
	bun run cost:check

validate: validate-offline
	bun run course:drift

simulator-compatibility:
	@test -n "$(SIMULATOR_CHECKOUT)" || { \
		echo "SIMULATOR_CHECKOUT must be an absolute, clean TenkaCloudSimulator checkout" >&2; \
		exit 2; \
	}
	bun run simulator:compatibility \
		--simulator "$(SIMULATOR_CHECKOUT)" \
		--output "$(SIMULATOR_REPORT)"

agent-gate: validate symphony-validate

symphony-agent-gate: validate-offline symphony-validate

symphony-validate:
	bun test scripts/symphony-security.test.ts scripts/symphony-launcher-contract.test.ts
	bun run scripts/symphony-security.ts "$(SYMPHONY_WORKFLOW)"

symphony-print: symphony-validate
	@cat "$(SYMPHONY_WORKFLOW)"

symphony-run: symphony-validate
	@echo "Refusing to start a credentialed service from repository-controlled Makefile code." >&2
	@echo "Install the reviewed operator launchers outside the checkout and start the host launcher directly." >&2
	@echo "See .symphony/README.md." >&2
	@exit 2
