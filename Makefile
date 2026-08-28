.PHONY: install validate agent-gate

install:
	bun install --frozen-lockfile --ignore-scripts

validate:
	bun run validate

agent-gate: validate
