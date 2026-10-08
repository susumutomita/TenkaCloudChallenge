BUN ?= bun
.PHONY: install dev test typecheck browser-test check
install:
	$(BUN) install --frozen-lockfile --ignore-scripts
dev:
	$(BUN) run dev
test:
	$(BUN) test tests/game.test.ts tests/http.test.ts
typecheck:
	$(BUN) run typecheck
browser-test:
	$(BUN) run test:browser
check: typecheck test
