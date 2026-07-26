# Participant contract, shared by every AC26 companion problem.
#
#   make test             run the public tests
#   make test-one ID=...  re-run one public test by name substring
#   make inspect          print your setting, your row, your triple, and what the log records
#   make reset            restore starter/ to its shipped state
#   make reference-test   authors / CI only: hidden + mutation suites, inside the image
#
# `inspect` takes one extra knob, because the default run hides the two shapes that
# separate a right implementation from a plausible one:
#
#   make inspect S=sparse   any of dense, sparse, signed, unit
#
# FLAG_SEED is injected by the platform at deploy. The default below exists only so an
# author can run the problem straight out of a checkout.
FLAG_SEED ?= local-dev-seed
IMAGE := ac26-w6-cosnark-beaver

# starter/ is bind-mounted read-only: the learner edits their checkout, the container
# reads it. reference/ and tests/hidden/ stay inside the image and are not bind-mounted,
# which keeps them out of the checkout rather than out of reach -- local mode is
# honor-system verification. See TEMPLATE.md "Assurance scope".
RUN := docker run --rm -e FLAG_SEED=$(FLAG_SEED) \
	-v $(CURDIR)/local/starter:/problem/starter:ro $(IMAGE)

.PHONY: build test test-one inspect reset reference-test

build:
	docker build -t $(IMAGE) local

test: build
	$(RUN) python tests/public/test_prover.py

test-one: build
	@test -n "$(ID)" || (echo "usage: make test-one ID=<test name substring>" && exit 1)
	$(RUN) python tests/public/test_prover.py --only $(ID)

inspect: build
	docker run --rm -e FLAG_SEED=$(FLAG_SEED) -e S=$(S) \
		-v $(CURDIR)/local/starter:/problem/starter:ro $(IMAGE) python show.py

reset:
	# The whole directory, not a named file: a problem may ship more than one
	# starter, and a filename here goes stale the moment a problem is scaffolded
	# from another one. Checking out the directory restores every tracked starter.
	git checkout -- local/starter/
	@echo "starter/ restored to its shipped state."

reference-test: build
	docker run --rm -e FLAG_SEED=$(FLAG_SEED) $(IMAGE) python mutation.py
