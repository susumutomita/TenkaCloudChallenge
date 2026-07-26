.DEFAULT_GOAL := help

SIMULATOR_CHECKOUT ?=
SIMULATOR_REPORT ?= reports/simulator-coverage.json
SYMPHONY_BIN ?= symphony
SYMPHONY_WORKFLOW ?= .symphony/WORKFLOW.md
SYMPHONY_PORT ?= 4313
SYMPHONY_LOGS_ROOT ?= .symphony/logs

.PHONY: help install install_ci validate agent-gate simulator-compatibility symphony-validate symphony-print symphony-run

help:
	@echo "TenkaCloudChallenge quality commands"
	@echo "  make install      Install dependencies without lifecycle scripts"
	@echo "  make install_ci   Install the frozen dependency graph"
	@echo "  make validate     Run the complete repository-local catalog contract"
	@echo "  make agent-gate   Run the deterministic completion contract for agents"
	@echo "  make symphony-validate  Validate this repository's Symphony workflow"
	@echo "  make symphony-run       Run this repository's Symphony instance"
	@echo "  make simulator-compatibility SIMULATOR_CHECKOUT=/absolute/path/to/TenkaCloudSimulator"

install:
	bun install --ignore-scripts

install_ci:
	bun install --frozen-lockfile --ignore-scripts

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

agent-gate: validate symphony-validate

symphony-validate:
	@test -f "$(SYMPHONY_WORKFLOW)"
	@grep -q '^  kind: github$$' "$(SYMPHONY_WORKFLOW)"
	@grep -q '^    repo: susumutomita/TenkaCloudChallenge$$' "$(SYMPHONY_WORKFLOW)"
	@grep -q '^    - agent:ready$$' "$(SYMPHONY_WORKFLOW)"
	@grep -q 'make agent-gate' "$(SYMPHONY_WORKFLOW)"
	@grep -q 'codex exec review --base origin/main' "$(SYMPHONY_WORKFLOW)"
	@grep -q 'Never run deploy, destroy, release, force-push, or secret-management commands' "$(SYMPHONY_WORKFLOW)"

symphony-print: symphony-validate
	@cat "$(SYMPHONY_WORKFLOW)"

symphony-run: symphony-validate
	@test -n "$$GITHUB_TOKEN" || { echo 'GITHUB_TOKEN is required' >&2; exit 2; }
	@test -n "$$SYMPHONY_WORKSPACE_ROOT" || { echo 'SYMPHONY_WORKSPACE_ROOT is required' >&2; exit 2; }
	@mkdir -p "$(SYMPHONY_LOGS_ROOT)"
	"$(SYMPHONY_BIN)" "$(SYMPHONY_WORKFLOW)" --port "$(SYMPHONY_PORT)" --logs-root "$(SYMPHONY_LOGS_ROOT)"
