"""Public feedback for encoding, decoding and participant-built counterexamples.

Checks use only the displayed parameters. Hidden submissions cover other parameters
and validation rules; passing this file does not establish every checkpoint.
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "starter"))

import encoding as submission  # noqa: E402

SEED = os.environ.get("FLAG_SEED", "local-dev-seed")


def _load_public_evidence() -> dict:
    """This deployment's ring and its encoding points -- what `show.py` prints.

    Issue 537/538 (Issue 543 option B2): this file used to import `fixtures.generate`
    directly. That module implements `encode`, `centered`, `decode`,
    `success_interval` and `first_failure` under the exact five names the starter's own
    stubs ask the learner to write, so it does not ship in the `participant` Docker
    stage at all any more (see ../../Dockerfile). This deployment's own verifier is the
    only source for the public half now: `PUBLIC_EVIDENCE_JSON` when the Portal has
    already fetched it, or `VERIFIER_PUBLIC_URL` fetched directly when it has not.
    """
    injected = os.environ.get("PUBLIC_EVIDENCE_JSON")
    if injected:
        return json.loads(injected)
    verifier_public_url = os.environ.get("VERIFIER_PUBLIC_URL")
    if verifier_public_url:
        from urllib.request import urlopen

        with urlopen(verifier_public_url, timeout=10) as response:  # noqa: S310
            return json.loads(response.read().decode("utf-8"))
    # Neither is set: this only resolves when `fixtures/` is actually on disk, which is
    # true for a checkout (this file run directly, e.g. by
    # scripts/ac26-w5-encoding-noise.test.ts) and the verifier/author Docker stages, and
    # never inside a built `participant` image -- so this branch does not reopen the
    # leak above.
    from fixtures.generate import public_payload

    return public_payload(SEED)


PUBLIC = _load_public_evidence()


def check_encode_matches_the_rule() -> str:
    par = PUBLIC["params"]
    for entry in PUBLIC["points"]:
        if submission.encode(par, entry["m"]) != entry["encode"]:
            return f"message {entry['m']} does not encode to m * delta in the ring"
    return ""


def check_an_exact_point_decodes_to_itself() -> str:
    par = PUBLIC["params"]
    for entry in PUBLIC["points"]:
        if submission.decode(par, entry["encode"]) != entry["m"]:
            return f"the encoding point for {entry['m']} does not decode back to {entry['m']}"
    return ""


def check_a_little_noise_survives() -> str:
    par = PUBLIC["params"]
    for entry in PUBLIC["points"]:
        noisy = submission.add_noise(par, entry["encode"], 1)
        if submission.decode(par, noisy) != entry["m"]:
            return f"one unit of noise already broke message {entry['m']}"
    return ""


def check_counterexamples_separate_results() -> str:
    par = PUBLIC["params"]
    p, d, q = par["p"], par["delta"], par["q"]
    if d < 2:
        return ""
    for bug in ("floor", "no-wrap", "abs-noise"):
        witness = submission.counterexample(par, bug)
        if witness is None:
            def differs(m, e):
                c = (m*d+e)%q
                good = ((c+d//2)//d)%p
                bad = ((c//d)%p if bug == "floor" else (c+d//2)//d if bug == "no-wrap" else ((((m*d+abs(e))%q)+d//2)//d)%p)
                return good != bad
            if any(differs(m,e) for m in range(p) for e in range(-d,d+1)):
                return "a separating input exists but none was returned"
            continue
        m, e = witness
        if type(m) is not int or type(e) is not int or not (0 <= m < p and -d <= e <= d):
            return "counterexample inputs must be inside the stated domain"
        c = (m * d + e) % q
        correct = ((c + d // 2) // d) % p
        broken = ((c // d) % p if bug == "floor" else
                  (c + d // 2) // d if bug == "no-wrap" else
                  ((((m * d + abs(e)) % q) + d // 2) // d) % p)
        if correct == broken:
            return f"{bug}: your inputs do not separate the two formulas"
    return ""


CHECKS = (
    ("counterexamples-separate-results", check_counterexamples_separate_results),
    ("encode-matches-the-rule", check_encode_matches_the_rule),
    ("an-exact-point-decodes-to-itself", check_an_exact_point_decodes_to_itself),
    ("a-little-noise-survives", check_a_little_noise_survives),
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
        print("\nPublic checks passed for this parameter set; submissions also check other parameters.")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
