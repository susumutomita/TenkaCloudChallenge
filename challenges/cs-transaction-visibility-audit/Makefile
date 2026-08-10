# Participant commands for the deterministic transaction-visibility lab.
# Local verification is honor-system only; see TEMPLATE.md "Assurance scope".
FLAG_SEED ?= local-dev-seed
IMAGE := cs-transaction-visibility-audit

RUN := docker run --rm --network none -e FLAG_SEED=$(FLAG_SEED) \
	-v $(CURDIR)/local/starter:/problem/starter:ro $(IMAGE)

.PHONY: build test test-one inspect reset reference-test

build:
	docker build --target participant -t $(IMAGE) local

test: build
	$(RUN) python tests/public/test_report.py

test-one: build
	@test -n "$(ID)" || (echo "usage: make test-one ID=<test name substring>" && exit 1)
	$(RUN) python tests/public/test_report.py --only $(ID)

inspect: build
	$(RUN) python show.py

reset:
	git checkout -- local/starter/
	@echo "starter/ restored to its shipped state."

reference-test: build
	docker build --target author -t $(IMAGE)-author local
	docker run --rm --network none -e FLAG_SEED=$(FLAG_SEED) $(IMAGE)-author python mutation.py
