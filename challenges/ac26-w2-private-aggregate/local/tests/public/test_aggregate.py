"""Public tests. They show the shape of an answer; they do not prove one correct.

They run your protocol on ONE setting and check that the score comes out right. They do
not check the round count, they do not check what you revealed, they do not check
whether each product got its own triple, and they never vary the party count.

An implementation that opens every product separately passes this file. So does one that
reuses a single triple for everything. Both are correct. Neither is finished.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "starter"))

import aggregate  # noqa: E402
from fixtures.generate import (  # noqa: E402
    Protocol,
    inputs_shared,
    plain_score,
    reconstruct,
    setting,
    triples,
)

SEED = os.environ.get("FLAG_SEED", "local-dev-seed")


def _run():
    st = setting(SEED)
    shared = inputs_shared(SEED, "public", st)
    triple_list = [
        {"a": t.a, "b": t.b, "c": t.c} for t in triples(SEED, "public", st, st.parties)
    ]
    io = Protocol(p=st.p)
    out = aggregate.aggregate(
        [list(s) for s in shared["counts"]],
        [list(s) for s in shared["severities"]],
        triple_list,
        st.as_public(),
        io,
    )
    return st, io, out


def check_plan_is_filled_in() -> str:
    st = setting(SEED)
    got = aggregate.plan(st.as_public())
    if not isinstance(got, dict):
        return "plan did not return a cost estimate"
    if any(got.get(key) in (None, 0) for key in ("multiplications", "triples", "rounds")):
        return "plan still has a zero in it"
    return ""


def check_score_is_right() -> str:
    st, _io, out = _run()
    if not isinstance(out, list) or len(out) != st.parties:
        return "the protocol did not return one share per party"
    if reconstruct(out, st.p) != plain_score(st):
        return "the score does not match the plain computation"
    return ""


CHECKS = (
    ("plan-is-filled-in", check_plan_is_filled_in),
    ("score-is-right", check_score_is_right),
)


def main(argv: list[str]) -> int:
    only = argv[argv.index("--only") + 1] if "--only" in argv else ""
    failed = 0
    for name, check in CHECKS:
        if only and only not in name:
            continue
        try:
            message = check()
        except Exception as error:  # noqa: BLE001 - a crash is a failure, reported as one
            message = f"raised {type(error).__name__}"
        if message:
            print(f"FAIL {name}: {message}")
            failed += 1
        else:
            print(f"ok   {name}")
    print(f"\npublic tests: {failed} failed" if failed else "\npublic tests: all passed")
    if not failed:
        print("\nNothing here measured a round, an opening, or a second party count.")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
