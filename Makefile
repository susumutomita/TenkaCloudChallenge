.PHONY: validate agent-gate reindex

validate:
	bun run validate

agent-gate: validate

reindex:
	bun run reindex
