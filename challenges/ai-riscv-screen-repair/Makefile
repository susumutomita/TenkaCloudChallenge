COMPOSE ?= docker compose
COMPOSE_FILE := local/docker-compose.yml
SERVICE := ai-riscv-screen-repair
GOLDEN_DIR := $(abspath ../../scripts/fixtures/ai-riscv-screen-repair)

.PHONY: test reference-test red-green up down

test:
	$(COMPOSE) -f $(COMPOSE_FILE) run --rm --no-deps $(SERVICE) make clean test

reference-test:
	$(COMPOSE) -f $(COMPOSE_FILE) run --rm --no-deps \
		--volume "$(GOLDEN_DIR):/workspace/solution:ro" \
		$(SERVICE) make clean test

red-green:
	@set +e; output="$$( $(MAKE) test 2>&1 )"; status=$$?; set -e; \
		printf '%s\n' "$$output"; \
		if [ $$status -eq 0 ]; then \
			echo "expected the inherited video controller to fail" >&2; \
			exit 1; \
		fi; \
		for label in CDC_ASSERT_FAIL TIMING_ASSERT_FAIL WRITE_STROBE_ASSERT_FAIL; do \
			printf '%s\n' "$$output" | grep -F "$$label" >/dev/null || { \
				echo "expected all three inherited defect assertions; missing $$label" >&2; \
				exit 1; \
			}; \
		done
	$(MAKE) reference-test

up:
	$(COMPOSE) -f $(COMPOSE_FILE) up --build

down:
	$(COMPOSE) -f $(COMPOSE_FILE) down
