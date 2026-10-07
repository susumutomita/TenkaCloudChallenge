.PHONY: install test reference-test typecheck dev browser-test
install:
	bun install --frozen-lockfile --ignore-scripts
test:
	bun run test
reference-test:
	python3 tests/verify-design.py
typecheck:
	bun run typecheck
dev:
	bun run dev
browser-test:
	bun run browser-test
