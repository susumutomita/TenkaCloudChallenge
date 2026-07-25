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
IMAGE := ac26-w3-schnorr

# starter/ is bind-mounted read-only: the learner edits their checkout, the container
# reads it. reference/ and tests/hidden/ stay inside the image and are never mounted.
RUN := docker run --rm -e FLAG_SEED=$(FLAG_SEED) \
	-v $(CURDIR)/local/starter:/problem/starter:ro $(IMAGE)

.PHONY: build test test-one inspect reset reference-test

build:
	docker build -t $(IMAGE) local

test: build
	$(RUN) python tests/public/test_schnorr.py

test-one: build
	@test -n "$(ID)" || (echo "usage: make test-one ID=<test name substring>" && exit 1)
	$(RUN) python tests/public/test_schnorr.py --only $(ID)

inspect: build
	$(RUN) python show.py

reset:
	git checkout -- local/starter/schnorr.py
	@echo "starter/schnorr.py restored to its shipped state."

reference-test: build
	docker run --rm -e FLAG_SEED=$(FLAG_SEED) $(IMAGE) python mutation.py
