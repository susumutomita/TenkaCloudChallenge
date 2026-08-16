#!/usr/bin/env python3
"""Play stackstack-first-request over its real HTTP surface and check it holds.

Issue #477 asks for shipping evidence this problem never had. Most of that list
is machine-checkable and belongs in CI: a cold start, a fresh state that fails
closed, negative and inherited-property cases that score nothing, a positive lap
that reaches exactly the declared points, per-deploy answers that differ, reset
semantics, and cleanup. The rest of the list -- an independent blind tester and
real browser rendering -- is not, and this script does not pretend to cover it.

The script knows no answers. It reads the postcard, carries that value to the
door, posts a guestbook entry, and submits what the app told it, which is the
same path the participant walks. Nothing here can be satisfied by a value
committed to the repository, and no token is ever printed: fingerprints go to
stdout so two seeds can be compared without either answer reaching a CI log.

Order matters. Every negative runs before the first positive request, because
the gates are cumulative and a lap walked early would hide a gate that opens
too easily.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
METADATA = ROOT / "challenges" / "stackstack-first-request" / "metadata.json"

GATES = ("postcard_read", "door_opened", "message_left")
CHECKPOINTS = ("postcard", "locked-door", "guestbook", "round-trip")

#: A plain object inherits these. `/verify` looks up checkpoints with
#: `Object.hasOwn`, so each must be an unknown checkpoint rather than a function
#: the scorer finds and calls.
INHERITED = ("constructor", "toString", "hasOwnProperty", "__proto__", "valueOf")


class Failed(AssertionError):
    """A shipping property did not hold."""


def request(url: str, payload: object | None = None, method: str | None = None) -> tuple[int, object]:
    """Return (status, decoded body). A 4xx is data here, not an exception."""
    data = None if payload is None else json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=data,
        headers={"content-type": "application/json"} if data is not None else {},
        method=method or ("POST" if data is not None else "GET"),
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as response:
            return response.status, json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        body = error.read().decode("utf-8", "replace")
        try:
            return error.code, json.loads(body)
        except json.JSONDecodeError:
            return error.code, body


def fingerprint(value: str) -> str:
    """A stable handle for an answer, so two seeds can be compared in a log."""
    return hashlib.sha256(value.encode("utf-8")).hexdigest()[:16]


def wait_until_ready(board: str, seconds: int = 120) -> None:
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        try:
            status, body = request(board + "/healthz")
            if status == 200 and isinstance(body, dict):
                return
        except (OSError, urllib.error.URLError, json.JSONDecodeError):
            pass
        time.sleep(1)
    raise Failed(f"the board did not become ready within {seconds} seconds")


def posture(board: str) -> dict:
    status, body = request(board + "/posture")
    if status != 200 or not isinstance(body, dict):
        raise Failed(f"/posture returned {status}: {body!r}")
    return body


def verify(verifier: str, checkpoint: str, submission: str) -> tuple[int, dict]:
    status, body = request(verifier + "/verify", {"checkpointId": checkpoint, "submission": submission})
    if not isinstance(body, dict):
        raise Failed(f"/verify returned no JSON object for {checkpoint}: {body!r}")
    if body.get("checkpointId") != checkpoint:
        raise Failed(f"/verify echoed {body.get('checkpointId')!r} for {checkpoint}")
    return status, body


def assert_fresh(board: str) -> None:
    """Nothing is earned before anything is done."""
    state = posture(board)
    gates = state.get("gates")
    if not isinstance(gates, dict) or set(gates) != set(GATES):
        raise Failed(f"/posture reported gates {gates!r}, expected {list(GATES)}")
    open_gates = [name for name, value in gates.items() if value is not False]
    if open_gates:
        raise Failed(f"a fresh deployment already has open gates: {open_gates}")
    if state.get("ready") is not False or state.get("readyToken") is not None:
        raise Failed(f"a fresh deployment already reports ready: {state!r}")


def assert_negatives_score_nothing(board: str, verifier: str) -> None:
    """Wrong asks are answered, and none of them opens a gate or earns a point."""
    status, body = request(board + "/api/door")
    if status != 400 or not isinstance(body, dict) or body.get("error") != "key_required":
        raise Failed(f"a keyless door gave {status} {body!r}, expected a helpful 400")

    status, body = request(board + "/api/door?key=not-the-token")
    if status != 400 or not isinstance(body, dict) or body.get("error") != "wrong_key":
        raise Failed(f"a wrong door key gave {status} {body!r}, expected a 400")

    for malformed in ({}, [], "a string", {"name": "", "message": "x"}, {"name": "x"}):
        status, _ = request(board + "/api/guestbook", malformed)
        if status != 400:
            raise Failed(f"the guestbook accepted {malformed!r} with {status}")

    for checkpoint in CHECKPOINTS:
        for submission in ("", "   ", "TC{not_the_answer}", "postcard-0000000000"):
            status, body = verify(verifier, checkpoint, submission)
            if status != 200 or body.get("correct") is not False:
                raise Failed(f"{checkpoint} accepted {submission!r}: {status} {body!r}")

    for unknown in ("nope", *INHERITED):
        status, body = request(verifier + "/verify", {"checkpointId": unknown, "submission": "x"})
        if status != 400 or not isinstance(body, dict) or body.get("error") != "unknown_checkpoint":
            raise Failed(f"checkpoint {unknown!r} was not refused: {status} {body!r}")
        if body.get("correct") is True:
            raise Failed(f"checkpoint {unknown!r} scored")

    assert_fresh(board)


def walk_the_lap(board: str) -> dict[str, str]:
    """The participant's three conversations, each value taken from the response."""
    status, body = request(board + "/api/postcard")
    if status != 200 or not isinstance(body, dict) or not isinstance(body.get("token"), str):
        raise Failed(f"the postcard did not carry a token: {status} {body!r}")
    postcard = body["token"]

    status, body = request(f"{board}/api/door?key={urllib.parse.quote(postcard)}")
    if status != 200 or not isinstance(body, dict) or not isinstance(body.get("token"), str):
        raise Failed(f"the postcard token did not open the door: {status} {body!r}")
    door = body["token"]

    status, body = request(board + "/api/guestbook", {"name": "smoke", "message": "hello"})
    if status != 201 or not isinstance(body, dict) or not isinstance(body.get("receipt"), str):
        raise Failed(f"the guestbook did not answer with a receipt: {status} {body!r}")
    guestbook = body["receipt"]

    state = posture(board)
    closed = [name for name, value in (state.get("gates") or {}).items() if value is not True]
    if closed:
        raise Failed(f"the lap left gates closed: {closed}")
    if state.get("ready") is not True or not isinstance(state.get("readyToken"), str):
        raise Failed(f"/posture withheld the round-trip token after a full lap: {state!r}")

    return {
        "postcard": postcard,
        "locked-door": door,
        "guestbook": guestbook,
        "round-trip": state["readyToken"],
    }


def declared_points() -> dict[str, int]:
    scoring = json.loads(METADATA.read_text(encoding="utf-8"))["scoring"]
    return {check["id"]: int(check["points"]) for check in scoring["checks"]}


def assert_the_lap_scores(verifier: str, answers: dict[str, str]) -> int:
    points = declared_points()
    if set(points) != set(CHECKPOINTS):
        raise Failed(f"metadata declares {sorted(points)}, the scenario declares {sorted(CHECKPOINTS)}")
    earned = 0
    for checkpoint in CHECKPOINTS:
        status, body = verify(verifier, checkpoint, answers[checkpoint])
        if status != 200 or body.get("correct") is not True:
            raise Failed(f"{checkpoint} refused the value the app itself served: {status} {body!r}")
        earned += points[checkpoint]
    return earned


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--board", default="http://127.0.0.1:18080")
    parser.add_argument("--verifier", default="http://127.0.0.1:18081")
    parser.add_argument(
        "--phase",
        choices=("all", "fresh"),
        default="all",
        help="'fresh' only asserts the fail-closed starting state, for proving a reset",
    )
    parser.add_argument("--expect-points", type=int, default=100)
    args = parser.parse_args()

    board = args.board.rstrip("/")
    verifier = args.verifier.rstrip("/")

    wait_until_ready(board)
    assert_fresh(board)
    if args.phase == "fresh":
        print("fresh state fails closed: every gate false, no round-trip token")
        return 0

    assert_negatives_score_nothing(board, verifier)
    print("negatives scored nothing and opened no gate, including inherited checkpoint ids")

    answers = walk_the_lap(board)
    print("the three conversations completed and /posture released the round-trip token")

    earned = assert_the_lap_scores(verifier, answers)
    if earned != args.expect_points:
        raise Failed(f"the full lap earned {earned} points, expected {args.expect_points}")
    print(f"every checkpoint accepted the app's own value: {earned} points")

    # Fingerprints, not answers: CI compares two seeds without logging either.
    print(json.dumps({"fingerprints": {name: fingerprint(value) for name, value in answers.items()}}))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Failed as error:
        print(f"FAILED {error}", file=sys.stderr)
        raise SystemExit(1) from None
