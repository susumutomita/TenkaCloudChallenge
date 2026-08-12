"""`make inspect` — your toy group, the observed request traffic, and the recorded run."""

from __future__ import annotations

import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from fixtures.generate import audit_bits, gmw_setting, health_token, ot_setting

SEED = os.environ.get("FLAG_SEED", "local-dev-seed")


def main() -> None:
    cfg = ot_setting(SEED)
    p, q, g = cfg["p"], cfg["q"], cfg["g"]
    a_pub = pow(g, cfg["a"], p)
    print("== your toy group ==")
    print(f"  p = {p}   q = {q}   g = {g}   (subgroup of order q; elements satisfy v^q = 1)")
    print()
    print("== checkpoint: choice-leak ==")
    print(f"  A sender you are auditing publishes A = {a_pub}.")
    print("  Its receiver was 'hardened' to draw b from 1..q-1 -- zero excluded, because")
    print("  a b of 0 looked like a degenerate secret to somebody.")
    print("  Work out, before running anything: with 0 excluded, is there a request value")
    print("  choice 0 can no longer send? One that choice 1 cannot? Observing either one")
    print("  on the wire decides the choice. Submit both as JSON:")
    print('    {"requestRevealingChoiceZero": <int>, "requestRevealingChoiceOne": <int>}')
    print()
    bits = audit_bits(SEED)
    print("== checkpoint: cross-term-audit ==")
    print("  A first draft of gmw_and skipped the OTs: each party just ANDed its own")
    print("  shares locally (z0 = x0 AND y0, z1 = x1 AND y1). Tonight it was run once,")
    print("  on these recorded shares:")
    print(
        f"    x0 = {bits['x0']}   x1 = {bits['x1']}   y0 = {bits['y0']}   y1 = {bits['y1']}"
    )
    print("  Predict, before running it: over all 16 share patterns [x0, x1, y0, y1],")
    print("  which ones does the shortcut get wrong? And on tonight's recorded run, what")
    print("  does the shortcut output (z0 XOR z1), and what should the AND have been?")
    print("  Submit as JSON:")
    print('    {"failingPatterns": [[x0, x1, y0, y1], ...],')
    print('     "thisRun": {"x0": _, "x1": _, "y0": _, "y1": _, "broken": _, "correct": _}}')
    print()
    session = gmw_setting(SEED)
    print("== randomness your code is given ==")
    print(
        f"  masks: mask0 = {session['mask0']}  mask1 = {session['mask1']}   "
        f"OT secrets: a01 = {session['a01']}  b01 = {session['b01']}  "
        f"a10 = {session['a10']}  b10 = {session['b10']}"
    )
    print("  (the hidden checks re-derive their own; these are for reasoning on paper)")
    print()
    print(f"health token: {health_token(SEED)}")


if __name__ == "__main__":
    main()
