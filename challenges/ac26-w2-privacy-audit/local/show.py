"""`make inspect` — your specification, one real trace, and your health token.

Prints the clean program's trace so you can see the event shape. It does not print any
leaking program: finding those is the exercise.
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from fixtures.generate import execute, health_token, program, spec, spec_as_public

SEED = os.environ.get("FLAG_SEED", "local-dev-seed")


def main() -> None:
    sp = spec(SEED)
    public_spec = spec_as_public(sp)
    print("health token :", health_token(SEED))
    print("field p      :", sp.p)
    print("parties      :", ", ".join(sp.parties))
    print()
    print("specification (this is what your auditor is given):")
    print(json.dumps(public_spec, indent=2))
    print()
    print("a clean run's events:")
    for index, event in enumerate(execute(program(sp, "alpha"), sp).events):
        shown = {key: value for key, value in event.items() if value not in ("", 0)}
        print(f"  [{index:2d}] {json.dumps(shown)}")
    print()
    print("The graded runs include programs that leak. Every one of them returns the")
    print("same, correct total -- so the output tells you nothing about which is which.")


if __name__ == "__main__":
    main()
