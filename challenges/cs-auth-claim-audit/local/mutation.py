"""Mutation suite: break the reference on purpose and assert the hidden tests notice.

This is the check that keeps the hidden suite honest. A green run against a correct
solution proves nothing about whether the tests would catch a wrong one -- and in this
problem in particular, "wrong" means "passes every test a reasonable person would
write", so a hidden suite that is not adversarially checked is worth very little.

Run inside the image (or in CI):  python mutation.py
Exit code 0 means every mutation was killed.
"""

from __future__ import annotations

import sys
import types
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from tests.hidden.check_authorize import run

SEED = "mutation-suite-seed"

REFERENCE = (Path(__file__).resolve().parent / "reference" / "authorize.py").read_text(
    encoding="utf-8"
)

#: (name, before, after). Each pair edits one line of the reference into a defect.
#:
#: Every entry here has to change an observable decision for some input. A mutation
#: that cannot be distinguished by any correct test is not a gap in the suite, and
#: listing one produces a permanent "survived" that trains authors to ignore the run.
MUTATIONS: list[tuple[str, str, str]] = [
    (
        "trusts the algorithm the token declares",
        "    expected = hmac.new(secret, signing_input, hashlib.sha256).digest()",
        """    if header.get("alg") == "none":
        expected = hashlib.sha256(signing_input).digest()
    else:
        expected = hmac.new(secret, signing_input, hashlib.sha256).digest()""",
    ),
    (
        "never compares the resource's tenant",
        '    if resource.get("tenant") != tenant:\n        return _deny("tenant_mismatch")',
        "    pass",
    ),
    (
        "expiry is inclusive, so the token lives one instant too long",
        "    if now >= expires:",
        "    if now > expires:",
    ),
    (
        "not-before is exclusive, so the token is dead for its first instant",
        "    if now < not_before:",
        "    if now <= not_before:",
    ),
    (
        "does not check not-before at all",
        '    if now < not_before:\n        return _deny("not_yet_valid")',
        "    pass",
    ),
    (
        "an unheld key id is reported as a forged signature",
        '    if not isinstance(kid, str) or kid not in keys:\n        return _deny("unknown_key")',
        '    if not isinstance(kid, str) or kid not in keys:\n        return _deny("bad_signature")',
    ),
    (
        "any scope at all is treated as every scope",
        '    if not isinstance(scope, list) or action not in scope:',
        '    if not isinstance(scope, list):',
    ),
    (
        "compares the MAC with == on a decoded value it never length-checks",
        "    if not hmac.compare_digest(expected, presented):",
        "    if expected[:8] != presented[:8]:",
    ),
    (
        "a token with an empty segment is treated as well-formed",
        "    if len(parts) != 3 or not all(parts):",
        "    if len(parts) != 3:",
    ),
]


def _load(source: str) -> types.ModuleType:
    module = types.ModuleType("mutant")
    module.__dict__["__file__"] = "<mutant>"
    exec(compile(source, "<mutant>", "exec"), module.__dict__)  # noqa: S102 - author-side only
    return module


def main() -> int:
    survivors: list[str] = []

    baseline = run(_load(REFERENCE), SEED)
    if baseline:
        print("the reference does not pass its own hidden suite:")
        for failure in baseline:
            print(f"  {failure}")
        return 1
    print("reference: passes")

    for name, before, after in MUTATIONS:
        if before not in REFERENCE:
            print(f"BROKEN  {name}: the line it edits is not in the reference any more")
            survivors.append(name)
            continue
        mutant_source = REFERENCE.replace(before, after, 1)
        try:
            failures = run(_load(mutant_source), SEED)
        except Exception as error:  # noqa: BLE001 - a mutant that will not load is killed
            failures = [f"{type(error).__name__}"]
        if failures:
            print(f"killed  {name}")
        else:
            print(f"SURVIVED {name}")
            survivors.append(name)

    print()
    if survivors:
        print(f"{len(survivors)} mutation(s) survived. The hidden suite has a gap:")
        for name in survivors:
            print(f"  {name}")
        return 1
    print(f"all {len(MUTATIONS)} mutations killed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
