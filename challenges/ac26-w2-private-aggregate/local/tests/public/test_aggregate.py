"""Public tests. They show the shape of an answer; they do not prove one correct.

They run your protocol on ONE setting and check that the score comes out right. They do
not check the round count, they do not check what you revealed, they do not check
whether each product got its own triple, and they never vary the party count.

An implementation that opens every product separately passes this file. So does one that
reuses a single triple for everything. Both are correct. Neither is finished.
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "starter"))

from participant.execution import LearnerError, LearnerSession

aggregate = None  # installed by the trusted launcher, never imported from learner source

from participant.protocol import Protocol, reconstruct  # noqa: E402

SEED = os.environ.get("FLAG_SEED", "local-dev-seed")


def _load_public_evidence() -> dict:
    """This deployment's modulus, organization count, bias, shared inputs and triples --
    what `show.py` prints a row of, and what this file has always handed to `aggregate`.

    Issue 537/538 (Issue 543 option B2): this file used to import `fixtures.generate`
    directly. That module derives the secret counts and severities every checkpoint is
    graded against, and it shipped in the same image as
    `tests/hidden/check_aggregate.py`, whose assertions state this problem's answers
    outright -- so it does not ship in the `participant` Docker stage at all any more
    (see ../../Dockerfile). This deployment's own verifier is the only source for the
    public half now: `PUBLIC_EVIDENCE_JSON` when the Portal has already fetched it, or
    `VERIFIER_PUBLIC_URL` fetched directly when it has not.
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
    # scripts/ac26-w2-private-aggregate.test.ts) and the verifier/author Docker stages,
    # and never inside a built `participant` image -- so this branch does not reopen the
    # leak above.
    from fixtures.generate import public_payload

    return public_payload(SEED)


PUBLIC = {}  # evidence is fetched by the parent when a check is run


def _run():
    params = PUBLIC["params"]
    io = Protocol(p=params["p"])
    out = aggregate.aggregate(
        [list(s) for s in PUBLIC["counts"]],
        [list(s) for s in PUBLIC["severities"]],
        [dict(t) for t in PUBLIC["triples"]],
        dict(params),
        io,
    )
    return params, io, out


def _plain_score() -> int:
    """The score the way the README states it, computed from the shares this file was
    handed: `sum_i (count_i * severity_i) + bias`, mod p. No hidden expectation, and no
    `fixtures.generate` -- every value here is one that `aggregate` receives anyway."""
    params = PUBLIC["params"]
    p = params["p"]
    total = 0
    for count, severity in zip(PUBLIC["counts"], PUBLIC["severities"]):
        total += reconstruct(count, p) * reconstruct(severity, p)
    return (total + params["bias"]) % p


def check_plan_is_filled_in() -> str:
    got = aggregate.plan(dict(PUBLIC["params"]))
    if not isinstance(got, dict):
        return "plan did not return a cost estimate"
    if any(got.get(key) in (None, 0) for key in ("multiplications", "triples", "rounds")):
        return "plan still has a zero in it"
    return ""


def check_score_is_right() -> str:
    params, _io, out = _run()
    if type(out) not in (list, tuple) or len(out) != params["parties"] or any(type(v) is not int or not 0 <= v < params["p"] for v in out):
        return "the protocol did not return one share per party"
    if reconstruct(out, params["p"]) != _plain_score():
        return "the score does not match the plain computation"
    return ""


CHECKS = (
    ("plan-is-filled-in", check_plan_is_filled_in),
    ("score-is-right", check_score_is_right),
)


def run(module, public, only=""):
    global aggregate, PUBLIC
    aggregate, PUBLIC = module, public
    selected = [(name, fn) for name, fn in CHECKS if not only or only in name]
    failures, transcript = [], []
    for name, check in selected:
        try:
            message = check()
        except (LearnerError, OSError, ValueError, TypeError):
            message = "function could not return the required values"
        if message:
            failures.append(name)
            transcript.append("FAIL " + name + ": " + message)
        else:
            transcript.append("PASS " + name)
    if not selected:
        failures.append("no matching public check")
    transcript.append("public tests: " + ("all passed" if not failures else str(len(failures)) + " failed"))
    transcript.append("Public shape/score example only; submit privacy, cost and transfer separately.")
    return failures, "\n".join(transcript)


def main(argv):
    only = argv[argv.index("--only")+1] if "--only" in argv else ""
    learner = LearnerSession({"aggregate.py": (ROOT/"starter/aggregate.py").read_text()}, timeout=25)
    try:
        with learner:
            failures, output = run(learner.module(), _load_public_evidence(), only)
        print(output)
        return int(bool(failures))
    except (LearnerError, OSError, ValueError):
        print(learner.initialization_diagnostic or "The submitted functions could not be evaluated.")
        return 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
