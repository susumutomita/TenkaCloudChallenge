.PHONY: test up down

# Problem-local tests: the real PHP portal and the real verifier as child
# processes on free loopback ports (needs php on PATH), plus static boundary
# checks. Run `make install` at the repository root first (the boundary test
# uses the root's `yaml` dev dependency).
test:
	node --test tests/*.test.mjs

# Local play, the same way TenkaCloud's `make local` starts it.
up:
	@test -n "$(FLAG_SEED)" || { echo "set FLAG_SEED (for example: export FLAG_SEED=\$$(openssl rand -hex 32))"; exit 1; }
	docker compose -f local/docker-compose.yml up --build -d --wait

down:
	docker compose -f local/docker-compose.yml down --volumes --rmi local
