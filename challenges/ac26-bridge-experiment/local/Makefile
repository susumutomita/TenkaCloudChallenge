# Participant contract for course-aligned local-play challenges.
#
# The same four targets mean the same thing in every AC26 challenge, so the
# tooling stops being something to relearn per problem:
#
#   make test     public tests — what you run while iterating
#   make inspect  intermediate values and the published trace
#   make reset    restore solution/ to its starting state
#   make shell    a shell in the lab container, for poking around
#
# `make reference-test` deliberately does not exist: the reference lives inside
# the image and is never unpacked onto the host.

COMPOSE ?= docker compose
SERVICE ?= ac26-bridge-experiment

.PHONY: test inspect reset shell up down

test: ## Run the public tests against solution/counter.py
	@$(COMPOSE) run --rm --no-deps $(SERVICE) python3 harness.py test

inspect: ## Print intermediate values, the predict case, and the published trace
	@$(COMPOSE) run --rm --no-deps $(SERVICE) python3 harness.py inspect

reset: ## Restore solution/counter.py to its starting state
	@git checkout -- solution/counter.py 2>/dev/null \
		&& echo "solution/counter.py restored." \
		|| echo "Not a git checkout — restore solution/counter.py by hand."

shell: ## Open a shell inside the lab container
	@$(COMPOSE) run --rm --no-deps $(SERVICE) /bin/sh

up: ## Start the lab (challenge surface + /verify)
	@$(COMPOSE) up -d --wait

down: ## Stop the lab and drop its volumes
	@$(COMPOSE) down -v
