# Participant contract, shared by every local-play problem in this catalog.
#
#   make test             run the public tests
#   make test-one ID=...  re-run one public test by name substring
#   make inspect          print your fixtures and the two quizzes
#   make reset            restore starter/ to its shipped state
#   make reference-test   authors / CI only: hidden + mutation suites, inside the image
#
# FLAG_SEED is injected by the platform at deploy. The default below exists only so an
# author can run the problem straight out of a checkout.
FLAG_SEED ?= local-dev-seed
IMAGE := sha256-compress-digest

# starter/ is bind-mounted read-only: the learner edits their checkout, the container
# reads it. tests/hidden/ stays inside the image and is not bind-mounted, which keeps it
# out of the checkout rather than out of reach -- local mode is honor-system
# verification. See TEMPLATE.md "Assurance scope". reference/ is not in this image at
# all: it only enters the `author` stage that `reference-test` builds.
RUN := docker run --rm -e FLAG_SEED=$(FLAG_SEED) \
	-v $(CURDIR)/local/starter:/problem/starter:ro $(IMAGE)

.PHONY: build test test-one inspect reset reference-test

build:
	docker build --target participant -t $(IMAGE) local

test: build
	$(RUN) python tests/public/test_compress.py

test-one: build
	@test -n "$(ID)" || (echo "usage: make test-one ID=<test name substring>" && exit 1)
	$(RUN) python tests/public/test_compress.py --only $(ID)

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
