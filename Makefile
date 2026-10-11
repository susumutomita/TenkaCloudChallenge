.PHONY: install validate agent-gate

install:
	bun install --frozen-lockfile --ignore-scripts

validate:
	bun run validate

agent-gate: validate
	bun test scripts/native-runtime.test.ts scripts/native-coordination.test.ts scripts/authors.test.ts scripts/skill-evidence.test.ts
