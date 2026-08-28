FLAG_SEED ?= local-dev-seed
IMAGE := cs-range-boundary-report
# The author stage is delivery hygiene, not confidentiality. See README.md "Assurance scope"
# for the exact local-play claim.
RUN := docker run --rm -e FLAG_SEED=$(FLAG_SEED) \
	-v $(CURDIR)/local/starter:/problem/starter:ro $(IMAGE)

.PHONY: build test test-one inspect reset reference-test up down

build:
	docker build --target participant -t $(IMAGE) local
	docker build --target verifier -t $(IMAGE)-verifier local

test: build
	$(RUN) python tests/public/test_report.py

test-one: build
	@test -n "$(ID)" || (echo "usage: make test-one ID=<test name substring>" && exit 1)
	$(RUN) python tests/public/test_report.py --only "$(ID)"

inspect: build
	$(RUN) python show.py

reset:
	git checkout -- local/starter/
	@echo "starter/ restored to its shipped state."

reference-test:
	docker build --target author -t $(IMAGE)-author local
	docker run --rm -e FLAG_SEED=$(FLAG_SEED) $(IMAGE)-author python mutation.py

up:
	FLAG_SEED=$(FLAG_SEED) docker compose -f local/docker-compose.yml up --build -d

down:
	FLAG_SEED=$(FLAG_SEED) docker compose -f local/docker-compose.yml down --remove-orphans
