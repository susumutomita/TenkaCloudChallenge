COMPOSE ?= docker compose
COMPOSE_FILE := local/docker-compose.yml
SERVICE := ai-riscv-screen-repair
GOLDEN_DIR := $(abspath ../../scripts/fixtures/ai-riscv-screen-repair)

.PHONY: step test reference-test red-green up down

# The learning loop: shows only the first unsolved stage, so there is one thing
# to understand and one value to change at a time. `test` below stays the full
# check the grader uses; `step` only reformats its output and can never pass a
# stage `test` would fail.
step:
	@set +e; out="$$( $(COMPOSE) -f $(COMPOSE_FILE) run --rm --no-deps $(SERVICE) make clean test 2>&1 )"; set -e; \
		printf '%s\n' "$$out" | sh scripts/step.sh

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
