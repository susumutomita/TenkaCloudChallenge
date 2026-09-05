# Participant contract, shared by every AC26 companion problem.
#
#   make test             run the public tests
#   make test-one ID=...  re-run one public test by name substring
#   make inspect          print your fixtures as paste-ready assignment statements
#   make reset            restore starter/ to its shipped state
#   make reference-test   authors / CI only: hidden + mutation suites, inside the image
#
# FLAG_SEED is injected by the platform at deploy. The default below exists only so an
# author can run the problem straight out of a checkout.
FLAG_SEED ?= local-dev-seed
IMAGE := ac26-w6-nullifier-drill
COMPOSE := FLAG_SEED=$(FLAG_SEED) docker compose -f local/docker-compose.yml -p $(IMAGE)

# Stream the edited source over stdin so the CLI also works with a Docker VM
# that cannot bind-mount the checkout's host path. No host Python is required.
STARTER_FILE ?= local/starter/nullifier_drill.py
RUN := $(COMPOSE) run --rm -T workbench
RUN_TEST := $(RUN) sh -c 'mkdir -p /tmp/learner; cat > /tmp/learner/nullifier_drill.py; exec env PARTICIPANT_STARTER_DIR=/tmp/learner python participant/cli_test.py "$$@"' sh

.PHONY: build test test-one inspect reset reference-test verifier-up verifier-down

build:
	$(COMPOSE) build workbench

# Detached and left running between calls, so iterating with `make test-one` repeatedly
# does not pay a verifier rebuild/boot each time. `make verifier-down` (or the platform
# tearing the deployment down) is what stops it.
verifier-up:
	$(COMPOSE) up -d --build --wait verifier

verifier-down:
	$(COMPOSE) down

test: build verifier-up
	$(RUN_TEST) < "$(STARTER_FILE)"

test-one: build verifier-up
	@test -n "$(ID)" || (echo "usage: make test-one ID=<test name substring>" && exit 1)
	$(RUN_TEST) --only "$(ID)" < "$(STARTER_FILE)"

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
	docker run --rm -i -e READ_METADATA_STDIN=1 $(IMAGE)-author python tests/hidden/test_learning_contract.py < metadata.json
	docker run --rm $(IMAGE)-author python tests/hidden/test_network_isolation.py
