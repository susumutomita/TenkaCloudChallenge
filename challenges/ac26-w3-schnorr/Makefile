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
# reads it.
#
# Issue 543/537: `tests/hidden/` and `verifier/` are no longer in the participant image
# at all -- they are built into the separate `verifier` stage that only Compose starts
# (see local/Dockerfile and local/docker-compose.yml). `make test` and `make inspect`
# still run against the participant image alone, because `fixtures/` ships there and
# neither one needs a verdict. `reference/` and `mutation.py` remain author-stage only.
# Whoever controls the Docker daemon can still build any stage: this is misdelivery
# prevention, not confidentiality. See TEMPLATE.md "Assurance scope".
RUN := docker run --rm -e FLAG_SEED=$(FLAG_SEED) \
	-v $(CURDIR)/local/starter:/problem/starter:ro $(IMAGE)

.PHONY: build test test-one inspect reset reference-test

build:
	docker build --target participant -t $(IMAGE) local

test: build
	$(RUN) python tests/public/test_schnorr.py

test-one: build
	@test -n "$(ID)" || (echo "usage: make test-one ID=<test name substring>" && exit 1)
	$(RUN) python tests/public/test_schnorr.py --only $(ID)

inspect: build
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
