FLAG_SEED ?= local-dev-seed
IMAGE := cs-async-result-binding
RUN := docker run --rm -e FLAG_SEED=$(FLAG_SEED) \
	-v $(CURDIR)/local/starter:/problem/starter:ro $(IMAGE)

# The image split prevents accidental delivery, not inspection by the owner of the
# checkout/daemon. See TEMPLATE.md "Assurance scope".
.PHONY: build test test-one inspect reset reference-test mutation-test local down

build:
	docker build --target participant -t $(IMAGE) local

test: build
	$(RUN) python tests/public/test_collect.py

test-one: build
	@test -n "$(ID)" || (echo "usage: make test-one ID=<test name substring>" && exit 1)
	$(RUN) python tests/public/test_collect.py --only $(ID)

inspect: build
	$(RUN) python show.py

reset:
	git checkout -- local/starter/
	@echo "starter/ restored to its shipped state."

mutation-test:
	python3 local/mutation.py

reference-test:
	docker build --target author -t $(IMAGE)-author local
	docker run --rm -e FLAG_SEED=$(FLAG_SEED) $(IMAGE)-author python mutation.py

local:
	docker compose -f local/docker-compose.yml up --build

down:
	docker compose -f local/docker-compose.yml down
