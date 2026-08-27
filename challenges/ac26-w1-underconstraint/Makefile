# Participant contract, shared by every AC26 companion problem.
#
#   make test             run the public tests
#   make test-one ID=...  re-run one public test by name substring
#   make inspect          print the policy, the deployed circuit and the honest witnesses
#   make reset            restore starter/ to its shipped state
#   make reference-test   authors / CI only: hidden + mutation suites, inside the image
#
# FLAG_SEED is injected by the platform at deploy. The default below exists only so an
# author can run the problem straight out of a checkout.
FLAG_SEED ?= local-dev-seed
IMAGE := ac26-w1-underconstraint
COMPOSE := FLAG_SEED=$(FLAG_SEED) docker compose -f local/docker-compose.yml -p $(IMAGE)

# starter/ is bind-mounted read-only: the learner edits their checkout, the container
# reads it. Issue 525/543: the grader (verifier/), the hidden checks and reference/ are
# not in this image at all any more -- they build into the separate `verifier` and
# `author` stages. Local mode is still honor-system verification: nothing stops whoever
# owns the Docker daemon from building the author stage.
# See TEMPLATE.md "Assurance scope".
#
# Issue 537/543 option B2: `fixtures/` does not ship in the participant image either any
# more, so `show.py` and the public tests need a live verifier to fetch this deployment's
# parameters, deployed circuit and honest witnesses from over the network. `test`,
# `test-one` and `inspect` therefore run through Compose, whose `workbench` service
# declares the verifier as a health-gated dependency, rather than a single `docker run`
# against a standalone image.
RUN := $(COMPOSE) run --rm \
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
	$(RUN) python tests/public/test_policy.py

test-one: build verifier-up
	@test -n "$(ID)" || (echo "usage: make test-one ID=<test name substring>" && exit 1)
	$(RUN) python tests/public/test_policy.py --only $(ID)

inspect: build verifier-up
	$(RUN) python show.py

reset:
	# The whole directory, not a named file: a problem may ship more than one
	# starter, and a filename here goes stale the moment a problem is scaffolded
	# from another one. Checking out the directory restores every tracked starter.
	git checkout -- local/starter/
	@echo "starter/ restored to its shipped state."

reference-test: build
	docker build --target author -t $(IMAGE)-author local
	docker run --rm -e FLAG_SEED=$(FLAG_SEED) $(IMAGE)-author python mutation.py
