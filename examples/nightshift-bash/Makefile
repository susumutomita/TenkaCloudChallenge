SHELL := /bin/bash

.PHONY: test syntax

test:
	bash tests/run.sh docker

syntax:
	@set -euo pipefail; while IFS= read -r -d '' file; do \
		bash -n "$$file"; \
	done < <(find . -type f \( -name '*.sh' -o -name render-receipt \) -print0)
