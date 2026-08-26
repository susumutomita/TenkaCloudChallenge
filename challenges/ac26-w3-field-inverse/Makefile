# Participant contract, shared by every AC26 companion problem.
#
#   make test             run the public tests
#   make test-one ID=...  re-run one public test by name substring
#   make inspect          print your fixtures and the trace to reason about
#   make reset            restore starter/ to its shipped state
#   make reference-test   authors / CI only: hidden + mutation suites, inside the image
#
# FLAG_SEED is injected by the platform at deploy. The default below exists only so an
# author can run the problem straight out of a checkout.
FLAG_SEED ?= local-dev-seed
IMAGE := ac26-w3-field-inverse
COMPOSE := FLAG_SEED=$(FLAG_SEED) docker compose -f local/docker-compose.yml -p $(IMAGE)

# starter/ is bind-mounted read-only: the learner edits their checkout, the container
# reads it. reference/ and tests/hidden/ stay inside the image and are not bind-mounted,
# which keeps them out of the checkout rather than out of reach -- local mode is
# honor-system verification. See TEMPLATE.md "Assurance scope".
#
# Issue 537/538: `fixtures/` does not ship in the participant image at all any more, so
# `show.py` and the public tests need a live verifier to fetch this deployment's public
# evidence from over the network (see the Workbench and Dockerfile under local/).
# `test`, `test-one` and `inspect` therefore run through Compose, whose `workbench`
# service declares the verifier as a health-gated dependency, rather than a single
# `docker run` against a standalone image.
RUN := $(COMPOSE) run --rm \
	-v $(CURDIR)/local/starter:/problem/starter:ro workbench

# `make inspect A=17 P=101` traces any pair. The env flags have to precede the service
# name, so this cannot reuse $(RUN) -- compose would read them as the command.
RUN_INSPECT := $(COMPOSE) run --rm -e A=$(A) -e P=$(P) \
	-v $(CURDIR)/local/starter:/problem/starter:ro workbench

.PHONY: build test test-one inspect reset reference-test verifier-up verifier-down

build:
	docker build --target participant -t $(IMAGE) local

# Detached and left running between calls, so iterating with `make test-one` repeatedly
# does not pay a verifier rebuild/boot each time. `make verifier-down` (or the platform
# tearing the deployment down) is what stops it.
verifier-up:
	$(COMPOSE) up -d --build --wait verifier

verifier-down:
	$(COMPOSE) down

test: build verifier-up
	$(RUN) python tests/public/test_field.py

test-one: build verifier-up
	@test -n "$(ID)" || (echo "usage: make test-one ID=<test name substring>" && exit 1)
	$(RUN) python tests/public/test_field.py --only $(ID)

# A and P are optional; without them you get your own fixture's trace.
inspect: build verifier-up
	$(RUN_INSPECT) python show.py

reset:
	# The whole directory, not a named file: a problem may ship more than one
	# starter, and a filename here goes stale the moment a problem is scaffolded
	# from another one. Checking out the directory restores every tracked starter.
	git checkout -- local/starter/
	@echo "starter/ restored to its shipped state."

reference-test: build
	docker build --target author -t $(IMAGE)-author local
	docker run --rm -e FLAG_SEED=$(FLAG_SEED) $(IMAGE)-author python mutation.py
