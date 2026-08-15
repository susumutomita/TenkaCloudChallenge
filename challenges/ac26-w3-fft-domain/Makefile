FLAG_SEED ?= local-dev-seed
IMAGE := ac26-w3-fft-domain

RUN := docker run --rm -e FLAG_SEED=$(FLAG_SEED) \
	-v $(CURDIR)/local/starter:/problem/starter:ro $(IMAGE)

.PHONY: build test test-one inspect reset reference-test up down

build:
	docker build --target participant -t $(IMAGE) local

test: build
	$(RUN) python tests/public/test_fftdomain.py

test-one: build
	@test -n "$(ID)" || (echo "usage: make test-one ID=<test name substring>" && exit 1)
	$(RUN) python tests/public/test_fftdomain.py --only "$(ID)"

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
