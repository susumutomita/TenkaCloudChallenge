"""Break the reference eight ways and require the hidden properties to notice."""

from __future__ import annotations

import sys
import types
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from tests.hidden.check_publish import run

REFERENCE = (Path(__file__).parent / "reference" / "publish.py").read_text(encoding="utf-8")
# Issue 440: scaffold-leftover guard は tests/hidden に check_*.py 1 本だけを許す。
# これは hidden test ではなく mutation suite が読む author 専用の mutant なので、
# reference/ と同格の mutants/ へ置く (参加者 image には元から入らない)。
CROSS_DEVICE_MUTANT = (Path(__file__).parent / "mutants" / "sidecar_mutant.py").read_text(
    encoding="utf-8"
)
SEED = "mutation-suite-seed"

MUTATIONS: list[tuple[str, str, str]] = [
    (
        "truncates the destination and writes in place",
        '    handle, temporary_name = tempfile.mkstemp(\n        dir=str(directory), prefix=f".{target.name}.", suffix=".publish"\n    )\n    temporary = Path(temporary_name)\n    try:\n        with os.fdopen(handle, "wb") as stream:\n            stream.write(payload)\n            stream.flush()',
        '    temporary = target\n    try:\n        with open(target, "wb") as stream:\n            stream.write(payload)\n            stream.flush()',
    ),
    (
        "renames the work file before its data is flushed",
        "            os.fsync(stream.fileno())\n        os.replace(temporary, target)",
        "        os.replace(temporary, target)",
    ),
    (
        "never flushes the work file at all",
        "            stream.flush()\n            # Order matters: the data must be on the medium before the name points\n            # at it, otherwise a crash can publish a name with no contents behind it.\n            os.fsync(stream.fileno())",
        "            stream.flush()",
    ),
    (
        "leaves the directory entry unflushed",
        '    directory_fd = os.open(str(directory), os.O_RDONLY)\n    try:\n        os.fsync(directory_fd)\n    finally:\n        os.close(directory_fd)',
        "    pass",
    ),
    (
        "leaves the work file behind when the publish fails",
        "    except BaseException:\n        # A failed publish must leave neither a torn target nor a work file.\n        temporary.unlink(missing_ok=True)\n        raise",
        "    except BaseException:\n        raise",
    ),
    (
        "copies the work file onto the destination instead of renaming it",
        "        os.replace(temporary, target)",
        '        target.write_bytes(temporary.read_bytes())\n        temporary.unlink(missing_ok=True)',
    ),
    (
        "shares one fixed work-file name for every destination",
        '    handle, temporary_name = tempfile.mkstemp(\n        dir=str(directory), prefix=f".{target.name}.", suffix=".publish"\n    )\n    temporary = Path(temporary_name)',
        '    temporary = directory / ".publish.tmp"\n    handle = os.open(str(temporary), os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)',
    ),
    (
        "reports success without writing the payload",
        "            stream.write(payload)",
        "            stream.write(payload[: len(payload) // 2])",
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

    cross_device_name = "stages the work file in /tmp, where a rename is not atomic"
    try:
        failures = run(_load(CROSS_DEVICE_MUTANT), SEED)
    except Exception as error:  # noqa: BLE001 - a crashing mutant is killed
        failures = [type(error).__name__]
    if failures:
        print(f"killed {cross_device_name}")
    else:
        print(f"SURVIVED {cross_device_name}")
        survivors.append(cross_device_name)

    if survivors:
        print(f"{len(survivors)} mutation(s) survived")
        return 1
    print(f"all {len(MUTATIONS) + 1} mutations killed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
