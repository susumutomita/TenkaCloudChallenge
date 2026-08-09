"""Require every named cache-policy mistake to be killed by the hidden suite."""

from __future__ import annotations

import importlib.util
import os
import tempfile
from pathlib import Path
from types import ModuleType

from tests.hidden import check_cache_policy

ROOT = Path(__file__).resolve().parent
REFERENCE = (ROOT / "reference" / "cache_policy.py").read_text(encoding="utf-8")
SEED = os.environ.get("FLAG_SEED", "mutation-seed")

MUTATIONS = (
    (
        "delete-only invalidation forgets the generation floor",
        "    floors[key] = floor\n",
        "    floors.pop(key, None)\n",
    ),
    (
        "cached entries discard their source revision",
        '    entries[key] = {"value": value, "revision": revision}\n',
        '    entries[key] = {"value": value, "revision": 0}\n',
    ),
    (
        "late fills are admitted unconditionally",
        "    if revision < floor:\n",
        "    if False and revision < floor:\n",
    ),
    (
        "the generation floor is cleared after one accepted fill",
        '    entries[key] = {"value": value, "revision": revision}\n    return True\n',
        '    entries[key] = {"value": value, "revision": revision}\n    floors.pop(key, None)\n    return True\n',
    ),
    (
        "a fill at the exact floor is rejected",
        "    if revision < floor:\n",
        "    if revision <= floor:\n",
    ),
    (
        "one key's floor is applied globally",
        "    floor = floors.get(key, -1)\n    if revision < floor:\n",
        "    floor = max(floors.values(), default=-1)\n    if revision < floor:\n",
    ),
    (
        "valid fills report that they were rejected",
        '    entries[key] = {"value": value, "revision": revision}\n    return True\n',
        '    entries[key] = {"value": value, "revision": revision}\n    return False\n',
    ),
    (
        "an older invalidation moves the floor backwards",
        "    floor = max(current, committed_revision)\n",
        "    floor = committed_revision\n",
    ),
    (
        "an old completion overwrites a newer entry",
        '    if existing is not None and existing.get("revision", -1) > revision:\n',
        '    if False and existing is not None and existing.get("revision", -1) > revision:\n',
    ),
    (
        "invalidating one key clears the whole cache",
        "        entries.pop(key, None)\n",
        "        entries.clear()\n",
    ),
)


def _load(source: str, name: str) -> ModuleType:
    with tempfile.TemporaryDirectory() as directory:
        path = Path(directory) / "cache_policy.py"
        path.write_text(source, encoding="utf-8")
        spec = importlib.util.spec_from_file_location(name, path)
        if spec is None or spec.loader is None:
            raise RuntimeError("could not construct module spec")
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module


def _failures(module: ModuleType) -> list[str]:
    failures = check_cache_policy.check_generalize(module, SEED)
    return list(dict.fromkeys(failures))


def main() -> int:
    reference = _load(REFERENCE, "cache_policy_reference")
    reference_failures = _failures(reference)
    if reference_failures:
        print("reference: FAIL")
        for failure in reference_failures:
            print(f"  {failure}")
        return 1
    print("reference: passes")

    survived: list[str] = []
    for index, (name, old, new) in enumerate(MUTATIONS):
        if REFERENCE.count(old) != 1:
            print(f"mutation fixture drift: {name}")
            return 1
        mutant = _load(REFERENCE.replace(old, new), f"cache_policy_mutant_{index}")
        failures = _failures(mutant)
        if failures:
            print(f"KILLED {name}: {failures[0]}")
        else:
            print(f"SURVIVED {name}")
            survived.append(name)
    print(f"killed: {len(MUTATIONS) - len(survived)}/{len(MUTATIONS)}")
    return 1 if survived else 0


if __name__ == "__main__":
    raise SystemExit(main())
