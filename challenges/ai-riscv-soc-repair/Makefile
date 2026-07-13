COMPOSE ?= docker compose
COMPOSE_FILE := local/docker-compose.yml
SERVICE := ai-riscv-soc-repair
GOLDEN_DIR := $(abspath ../../scripts/fixtures/ai-riscv-soc-repair)

.PHONY: test reference-test red-green up down

test:
	$(COMPOSE) -f $(COMPOSE_FILE) run --rm --no-deps $(SERVICE) make clean test

reference-test:
	$(COMPOSE) -f $(COMPOSE_FILE) run --rm --no-deps \
		--volume "$(GOLDEN_DIR):/workspace/solution:ro" \
		$(SERVICE) make clean test

red-green:
	@if $(MAKE) test; then \
		echo "expected the inherited RTL to fail" >&2; \
		exit 1; \
	fi
	$(MAKE) reference-test

up:
	$(COMPOSE) -f $(COMPOSE_FILE) up --build

down:
	$(COMPOSE) -f $(COMPOSE_FILE) down
