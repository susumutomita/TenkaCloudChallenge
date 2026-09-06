"""Parent-owned checks using only published evidence and the statement's p=7 example."""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from participant.execution import LearnerError, LearnerSession


def load_public_evidence() -> dict:
    injected = os.environ.get("PUBLIC_EVIDENCE_JSON")
    if injected:
        return json.loads(injected)
    url = os.environ.get("VERIFIER_PUBLIC_URL")
    if url:
        from urllib.request import urlopen
        with urlopen(url, timeout=5) as response:
            return json.loads(response.read().decode("utf-8"))
    # Author/check-out only: fixtures are absent from the participant image.
    from fixtures.generate import public_payload
    return public_payload(os.environ.get("FLAG_SEED", "local-dev-seed"))


def valid_shares(value, n, p):
    return type(value) is list and len(value) == n and all(type(v) is int and 0 <= v < p for v in value)


def run(module, public, only=""):
    p, n = public["params"]["p"], public["params"]["n"]
    triple, sx = public["triple"], public["xShares"]

    def mask():
        out = module.mask(sx, triple["a"], p)
        assert valid_shares(out, n, p), "mask must return n integers in 0..p-1"
        assert sum(out) % p == (public["x"] - public["a"]) % p, "mask must reconstruct to value minus mask"

    def opening():
        out = module.open_value(sx, p)
        assert type(out) is int and 0 <= out < p, "open_value must return one integer in 0..p-1"
        assert out == public["x"] % p, "open_value must reconstruct the shares"

    def combine():
        out = module.combine([4, 2, 6], [1, 2, 6], [2, 3, 1], 3, 4, 7)
        assert valid_shares(out, 3, 7), "combine must return n integers in 0..p-1"
        assert sum(out) % 7 == 1, "the statement's p=7 example must reconstruct to 1"

    def protocol():
        d = module.open_value(module.mask([3, 4, 5], [1, 2, 6], 7), 7)
        e = module.open_value(module.mask([1, 5, 4], [2, 3, 1], 7), 7)
        assert type(d) is int and d == 3 and type(e) is int and e == 4, "the statement's openings are d=3, e=4"
        out = module.combine([4, 2, 6], [1, 2, 6], [2, 3, 1], d, e, 7)
        assert valid_shares(out, 3, 7) and sum(out) % 7 == 1, "the composed p=7 example must reconstruct to 1"

    def rounds():
        value = module.rounds()
        assert type(value) is int and value == 1, "rounds must report the minimum batched opening count, 1"

    checks = [("mask_reconstructs_to_value_minus_mask", mask),
              ("open_value_returns_the_shared_value", opening),
              ("combine_reconstructs_the_public_example", combine),
              ("protocol_composes_the_public_example", protocol),
              ("rounds_reports_the_minimum", rounds)]
    failures, lines = [], []
    selected = [(name, fn) for name, fn in checks if not only or only in name]
    for name, fn in selected:
        try:
            fn()
            lines.append("PASS " + name)
        except AssertionError as error:
            failures.append(name)
            lines.append("FAIL " + name + ": " + str(error))  # parent-authored public assertions only
        except (LearnerError, OSError, ValueError, TypeError):
            failures.append(name)
            lines.append("FAIL " + name + ": function could not return the required values")
    if not selected:
        failures.append("no matching public check")
    lines.append("public tests: " + ("all passed" if not failures else str(len(failures)) + " failed"))
    lines.append("Published examples only; submit each checkpoint to test other settings.")
    return failures, "\n".join(lines)


def main():
    only = ""
    if "--only" in sys.argv:
        index = sys.argv.index("--only")
        only = sys.argv[index+1] if index+1 < len(sys.argv) else ""
    learner = LearnerSession({"beaver.py": (ROOT / "starter/beaver.py").read_text()})
    try:
        public = load_public_evidence()
        with learner:
            failures, output = run(learner.module(), public, only)
        print(output)
        return int(bool(failures))
    except (LearnerError, OSError, ValueError):
        print(learner.initialization_diagnostic or "The submitted functions could not be evaluated.")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
