"""Break the reference eight ways and require the hidden properties to notice."""

from __future__ import annotations

import sys
import types
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from tests.hidden.check_pagination import run

REFERENCE = (Path(__file__).parent / "reference" / "pagination.py").read_text(encoding="utf-8")
# The scaffold-leftover guard allows exactly one check_*.py under tests/hidden. This is
# not a hidden test but an author-only mutant the mutation suite reads, so it lives in
# mutants/, next to reference/ (neither ships in the participant image).
PATCHED_OFFSET_MUTANT = (Path(__file__).parent / "mutants" / "sidecar_mutant.py").read_text(
    encoding="utf-8"
)
SEED = "mutation-suite-seed"

MUTATIONS: list[tuple[str, str, str]] = [
    (
        "serves the boundary row again on the next page",
        '        candidates = [row for row in rows if boundary is None or int(row["id"]) < boundary]',
        '        candidates = [row for row in rows if boundary is None or int(row["id"]) <= boundary]',
    ),
    (
        "reads the table once and pages over the stale copy",
        '    def _live_rows(self) -> list[dict[str, object]]:\n        return sorted(self.store.rows(), key=lambda row: int(row["id"]), reverse=True)',
        '    def _live_rows(self) -> list[dict[str, object]]:\n        if not hasattr(self, "_frozen"):\n            self._frozen = sorted(self.store.rows(), key=lambda row: int(row["id"]), reverse=True)\n        return self._frozen',
    ),
    (
        "treats a cursor it cannot read as the beginning",
        '        boundary = _parse_cursor(cursor)\n        if boundary is _INVALID:\n            return _error("invalid_cursor")',
        "        boundary = _parse_cursor(cursor)\n        if boundary is _INVALID:\n            boundary = None",
    ),
    (
        "serves the listing oldest first",
        "reverse=True)",
        "reverse=False)",
    ),
    (
        "stops validating the page size",
        '        if not isinstance(size, int) or isinstance(size, bool) or not 1 <= size <= 100:\n            return _error("invalid_size")',
        '        if False:\n            return _error("invalid_size")',
    ),
    (
        "loses the newest row of every page",
        "        items = candidates[:size]",
        "        items = candidates[1 : size + 1]",
    ),
    (
        "sets the cursor one row past the one it served",
        '        next_cursor = str(int(items[-1]["id"])) if len(candidates) > size else None',
        '        next_cursor = str(int(items[-1]["id"]) - 1) if len(candidates) > size else None',
    ),
    (
        "promises another page after serving the last row",
        '        next_cursor = str(int(items[-1]["id"])) if len(candidates) > size else None',
        '        next_cursor = str(int(items[-1]["id"])) if len(candidates) >= size else None',
    ),
]


def _load(source: str) -> types.ModuleType:
    module = types.ModuleType("mutant")
    module.__dict__["__file__"] = "<mutant>"
    exec(compile(source, "<mutant>", "exec"), module.__dict__)  # noqa: S102 - author-only test
    return module


def main() -> int:
    baseline = run(_load(REFERENCE), SEED)
    if baseline:
        print("the reference does not pass its hidden suite:")
        for failure in baseline:
            print(f"  {failure}")
        return 1
    print("reference: passes")

    survivors: list[str] = []
    for name, before, after in MUTATIONS:
        if before not in REFERENCE:
            print(f"BROKEN {name}: mutation target is missing")
            survivors.append(name)
            continue
        source = REFERENCE.replace(before, after, 1)
        try:
            failures = run(_load(source), SEED)
        except Exception as error:  # noqa: BLE001 - a crashing mutant is killed
            failures = [type(error).__name__]
        if failures:
            print(f"killed {name}")
        else:
            print(f"SURVIVED {name}")
            survivors.append(name)

    patched_name = "validates every input and still pages by position"
    try:
        failures = run(_load(PATCHED_OFFSET_MUTANT), SEED)
    except Exception as error:  # noqa: BLE001 - a crashing mutant is killed
        failures = [type(error).__name__]
    if failures:
        print(f"killed {patched_name}")
    else:
        print(f"SURVIVED {patched_name}")
        survivors.append(patched_name)

    if survivors:
        print(f"{len(survivors)} mutation(s) survived")
        return 1
    print(f"all {len(MUTATIONS) + 1} mutations killed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
