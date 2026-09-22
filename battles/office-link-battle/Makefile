.PHONY: build test preview
build:
	python3 build.py

test:
	python3 build.py --check
	python3 -m unittest discover -s tests -v
	node --check web.js

preview:
	python3 preview.py
