# Author-side targets. NOT the participant path.
#
# A participant never sees this file. They open the problem in the portal, attach the
# container terminal, and type `beaver show`. These targets exist so the same image
# can be built, exercised and graded from a checkout while the problem is being
# written or reviewed.
#
#   make build            build the participant image
#   make test             run the public self-check inside that image
#   make test-one ID=...  re-run one public check by name substring
#   make inspect          print what `beaver show` prints
#   make play             open a shell in the image, the way the portal terminal does
#   make reference-test   authors / CI only: fixtures + reference + wrong answers + mutations
#
# FLAG_SEED is injected by the platform at deploy. The default below exists only so an
# author can run the problem straight out of a checkout.
#
# reference/ and mutation.py are in the `author` stage only, so they are not in the
# image a participant runs. That is misdelivery prevention and not a boundary --
# whoever runs this can build the author stage too, and local mode is honor-system
# verification. See TEMPLATE.md "Assurance scope".
FLAG_SEED ?= local-dev-seed
IMAGE := ac26-w2-beaver-mul

RUN := docker run --rm -e FLAG_SEED=$(FLAG_SEED) $(IMAGE)

.PHONY: build test test-one inspect play reference-test

build:
	docker build --target participant -t $(IMAGE) local

test: build
	$(RUN) python tests/public/test_beaver.py

test-one: build
	@test -n "$(ID)" || (echo "usage: make test-one ID=<check name substring>" && exit 1)
	$(RUN) python tests/public/test_beaver.py --only $(ID)

inspect: build
	$(RUN) beaver show

play: build
	docker run --rm -it -e FLAG_SEED=$(FLAG_SEED) $(IMAGE) /bin/sh

reference-test: build
	docker build --target author -t $(IMAGE)-author local
	docker run --rm -e FLAG_SEED=$(FLAG_SEED) $(IMAGE)-author python mutation.py
