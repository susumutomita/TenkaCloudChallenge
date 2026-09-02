"""Public tests. They show the shape of an answer; they do not prove one correct.

They commit, ask, open, and verify. Once. They never present a leaf from the wrong index,
never flip a sibling's side, never take the steps out of order, and never ask what the
commitment would be worth if the query came first.

An implementation whose leaves do not bind their index passes this file completely.

The last check is feedback rather than a test: it puts your five `lenient_opening`
answers to the setter's verifiers and reports what each one did with them.
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "starter"))

import commit as submission  # noqa: E402

SEED = os.environ.get("FLAG_SEED", "local-dev-seed")


def _load_public_evidence() -> dict[str, object]:
    """This deployment's vector, query, and root -- the same things `show.py` prints.

    Issue 537/538 (Issue 543 option B2): this file used to import `fixtures.generate`
    directly. That module also implements `node_hash` under the exact name the
    starter's own `node_hash` stub asks the learner to write, so it does not ship in
    the `participant` Docker stage at all any more (see ../../Dockerfile). This
    deployment's own verifier is the only source for the public half now:
    `PUBLIC_EVIDENCE_JSON` when the Portal has already fetched it, or
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
    # scripts/ac26-w4-commit-open.test.ts) and the verifier/author Docker stages, and
    # never inside a built `participant` image -- so this branch does not reopen the
    # leak above.
    from fixtures.generate import public_payload

    return public_payload(SEED)


PUBLIC = _load_public_evidence()


def check_root_matches() -> str:
    cfg = PUBLIC["setting"]
    if submission.merkle_root(list(cfg["values"])).hex() != PUBLIC["rootHex"]:
        return "the root does not match the committed vector"
    return ""


def check_an_honest_opening_verifies() -> str:
    cfg = PUBLIC["setting"]
    values, index = list(cfg["values"]), cfg["query"]
    root = submission.merkle_root(values)
    path = submission.open_at(values, index)
    if not submission.verify_opening(root, index, values[index], path, cfg["length"]):
        return "an honest opening did not verify"
    return ""


LENIENT_SCHEMES = ("A", "B", "C", "D", "E")


def _lenient_report(scheme: str, answer: dict) -> dict:
    """What one of the setter's verifiers makes of an answer, on the public table.

    Asked of this deployment's verifier (`POST /public/lenient`) when it is reachable,
    the same way the public evidence is fetched; on a checkout with `fixtures/` on
    disk, evaluated locally.
    """
    path = answer["path"]
    verifier_public_url = os.environ.get("VERIFIER_PUBLIC_URL")
    if verifier_public_url:
        from urllib.request import Request, urlopen

        payload = {
            "scheme": scheme,
            "index": answer.get("index"),
            "value": answer.get("value"),
            "path": [
                {"hashHex": step["hash"].hex(), "siblingIsLeft": step["sibling_is_left"]}
                for step in path
            ],
        }
        request = Request(
            verifier_public_url.rstrip("/") + "/lenient",
            data=json.dumps(payload).encode("utf-8"),
            headers={"content-type": "application/json"},
            method="POST",
        )
        with urlopen(request, timeout=10) as response:  # noqa: S310
            return json.loads(response.read().decode("utf-8"))
    from fixtures.generate import lenient_claim_report

    return lenient_claim_report(SEED, scheme, answer.get("index"), answer.get("value"), path)


def check_lenient_schemes() -> str:
    """Feedback for the last checkpoint: your five answers, put to the setter's verifiers.

    A rejected opening, or an accepted one that merely repeats a table entry, is
    reported as a failure; None is reported as-is. Whether a scheme admits any forgery
    at all is yours to work out -- this test only tells you what happened to the
    opening you returned.
    """
    problems: list[str] = []
    for scheme in LENIENT_SCHEMES:
        setting = {
            "scheme": scheme,
            "length": PUBLIC["lenientLength"],
            "values": list(PUBLIC["lenientValues"]),
        }
        try:
            answer = submission.lenient_opening(setting)
        except Exception as error:  # noqa: BLE001
            problems.append(f"scheme {scheme}: lenient_opening raised {type(error).__name__}")
            continue
        if answer is None:
            print(f"     scheme {scheme}: None -- you say this verifier lets no claim outside the table through")
            continue
        if (
            not isinstance(answer, dict)
            or not {"index", "value", "path"} <= set(answer)
            or not isinstance(answer["path"], list)
            or not all(
                isinstance(step, dict)
                and isinstance(step.get("hash"), bytes)
                and len(step["hash"]) == 32
                and isinstance(step.get("sibling_is_left"), bool)
                for step in answer["path"]
            )
        ):
            problems.append(
                f"scheme {scheme}: the answer is not None or a dict with index, value and a "
                'path of {"hash": 32 bytes, "sibling_is_left": bool} steps'
            )
            continue
        report = _lenient_report(scheme, answer)
        if not report.get("ok"):
            problems.append(f"scheme {scheme}: {report.get('error', 'the verifier gave no answer')}")
            continue
        claim = f"(index {answer['index']}, value {answer['value']})"
        if report["accepted"] and not report["inTable"]:
            print(f"     scheme {scheme}: accepted {claim}, which is not in the table -- this verifier lets it through")
        elif report["accepted"]:
            problems.append(f"scheme {scheme}: accepted {claim}, but that is an entry of the table, so it is not a forgery")
        else:
            problems.append(f"scheme {scheme}: rejected {claim} -- a rejected opening is never the answer")
    return "; ".join(problems)


CHECKS = (
    ("root-matches", check_root_matches),
    ("an-honest-opening-verifies", check_an_honest_opening_verifies),
    ("lenient-schemes-feedback", check_lenient_schemes),
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
        print("\nNothing here tried to cheat, and cheating is what the checkpoints test.")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
