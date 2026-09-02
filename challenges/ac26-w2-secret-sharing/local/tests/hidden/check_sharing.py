"""Hidden tests. Run by /verify against a copy of the learner's sharing.py.

The interesting checks are not the round trip -- that is arithmetic. They are:

  * `complete_shares` works for EVERY secret in the field given the same n-1 shares.
    That is the executable form of "n-1 shares reveal nothing": if every secret is
    consistent with what you hold, what you hold is not evidence.
  * `rerandomize` preserves the secret while moving every share, checked as a
    metamorphic property rather than against a fixed expected list.
  * The all-shares-equal-secret degenerate split (the starter's) is rejected, because
    it satisfies the round trip while leaking the secret to party 0 outright.
  * `share_line` / `reconstruct_line` (two-of-three) are graded as a pair of
    properties, never against the reference line: any two of the three points walk
    back to the secret in either order, and each point alone can be produced -- by the
    learner's own `share_line` -- for every secret in the field. The moduli differ from
    the public one and two of them are ~10^4, where the statement's trial search for
    the multiplicative partner is fine and a try-every-secret search is not. On the
    small moduli the privacy half is checked exhaustively (p x p calls per point); on
    the large ones as the equivalent bijection -- for a fixed secret, different slopes
    must give a party different y values -- on a few hundred sampled slopes for two
    secrets, so the large cases are graded on both halves.

Every reconstruction (`reconstruct`, `reconstruct_line`) runs in a separate
interpreter (`_reconstruct_in_child`) that receives nothing but the submission's
source and the JSON-serialised arguments. `share` / `share_line` and their
reconstruction partner are graded as pairs, and whatever the sharing half stores --
a module global, an attribute on `builtins`, an entry in `sys.modules`, the state of
an imported module -- is not there in the interpreter that reconstructs. What stays
open is the container's filesystem: both interpreters share it, so a submission that
writes the secret under an absolute path and reads it back would need a mount
namespace to stop, which this verifier (non-root, no capabilities) cannot create.

Failure messages name the property, never the expected value.
"""

from __future__ import annotations

import json
import signal
import subprocess
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from fixtures.generate import (  # noqa: E402
    LINE_PARTIES,
    PRIMES,
    line_cases,
    privacy_probe,
    randomness,
    rerandomization_randomness,
    setting,
    share_randomness,
)

LABELS = ("h0", "h1", "h2", "h3")

#: Safety net for the author path (mutation.py's in-process `run`), where nothing else
#: bounds a reconstruction. Under /verify the verifier's own RUN_TIMEOUT_SECONDS is
#: shorter and is the limit the statement documents; `_die_with_parent` makes sure the
#: interpreter started here goes down with the hidden run when that limit kills it.
RECONSTRUCTION_TIMEOUT_SECONDS = 60
#: Tail of the reconstruction interpreter's stdout that is searched for its result line.
#: Under /verify the inherited RLIMIT_FSIZE already caps the file at this size.
MAX_RESULT_BYTES = 64 * 1024
_PR_SET_PDEATHSIG = 1

try:
    import ctypes

    _LIBC = ctypes.CDLL(None, use_errno=True) if sys.platform.startswith("linux") else None
except (ImportError, OSError):  # pragma: no cover - platform without ctypes / libc
    _LIBC = None


#: The program the reconstruction interpreter runs. It reads one JSON document from
#: stdin -- the submission's source and the calls to make -- builds the module from the
#: source, makes the calls, and prints one JSON line with one result per call. The
#: submission's own prints go to /dev/null so they cannot corrupt that line; the result
#: is written straight to file descriptor 1 so a submission that rebinds `sys.stdout`
#: cannot swallow it either.
RECONSTRUCTION_DRIVER = r"""
import json, os, sys, types


def emit(document):
    data = (json.dumps(document) + "\n").encode("utf-8")
    while data:
        data = data[os.write(1, data):]


payload = json.loads(sys.stdin.buffer.read().decode("utf-8"))
module = types.ModuleType("sharing")
module.__file__ = "<submission>"
try:
    exec(compile(payload["source"], "<submission>", "exec"), module.__dict__)
except BaseException as error:
    emit({"error": "load", "type": type(error).__name__})
    os._exit(0)
sys.stdout = open(os.devnull, "w")
results = []
for call in payload["calls"]:
    try:
        value = getattr(module, call["fn"])(*call["args"])
    except BaseException as error:
        results.append({"raised": type(error).__name__})
        continue
    try:
        json.dumps(value)
    except (TypeError, ValueError, OverflowError, RecursionError):
        results.append({"value": None})
        continue
    results.append({"value": value})
emit({"results": results})
os._exit(0)
"""


def _source_of(module) -> str:
    """The submission's source: `__source__` when the caller built the module from text
    (mutation.py does), otherwise the file it was imported from (the verifier's runner)."""
    source = getattr(module, "__source__", None)
    if isinstance(source, str):
        return source
    with open(module.__file__, encoding="utf-8") as handle:
        return handle.read()


def _die_with_parent() -> None:
    """preexec_fn for the reconstruction interpreter: SIGKILL when the hidden run dies.

    The verifier enforces its time limit by killing the hidden run. Without this the
    interpreter that run started would survive the kill and keep computing -- a
    try-every-secret `reconstruct_line` for hours. Linux only (PR_SET_PDEATHSIG);
    elsewhere RECONSTRUCTION_TIMEOUT_SECONDS is the only bound.
    """
    if _LIBC is not None:
        _LIBC.prctl(_PR_SET_PDEATHSIG, signal.SIGKILL, 0, 0, 0)


def _reconstruct_in_child(
    module, calls: list[tuple[str, list[object]]]
) -> list[dict[str, object]] | None:
    """Make reconstruction calls in a separate interpreter; one result per call.

    The interpreter gets the submission's source and the JSON-serialised arguments on
    stdin, `-I`, an environment holding only PATH, and a fresh empty working directory
    -- nothing the sharing half of the submission did in this process reaches it. Each
    result is `{"value": ...}` or `{"raised": "ExceptionName"}`. None means the
    interpreter produced no usable verdict (it hung, crashed, exited early or wrote
    over the output cap); callers fail closed on it.

    All the calls of one check go in one interpreter, so a hidden run pays the
    interpreter start-up a fixed number of times, not once per call.
    """
    request = json.dumps(
        {
            "source": _source_of(module),
            "calls": [{"fn": name, "args": args} for name, args in calls],
        }
    ).encode("utf-8")
    try:
        with tempfile.TemporaryDirectory() as scratch:
            transcript = Path(scratch) / "stdout"
            with transcript.open("wb") as sink:
                subprocess.run(  # noqa: S603 - argument list, shell=False
                    [sys.executable, "-I", "-c", RECONSTRUCTION_DRIVER],
                    input=request,
                    stdout=sink,
                    stderr=subprocess.DEVNULL,
                    timeout=RECONSTRUCTION_TIMEOUT_SECONDS,
                    cwd=scratch,
                    env={"PATH": "/usr/local/bin:/usr/bin:/bin"},
                    preexec_fn=_die_with_parent,
                    check=False,
                )
            captured = transcript.read_bytes()[-MAX_RESULT_BYTES:]
    except (subprocess.TimeoutExpired, OSError, ValueError):
        return None
    for line in reversed(captured.decode("utf-8", errors="replace").splitlines()):
        try:
            document = json.loads(line)
        except json.JSONDecodeError:
            continue
        if not isinstance(document, dict):
            continue
        results = document.get("results")
        if (
            isinstance(results, list)
            and len(results) == len(calls)
            and all(isinstance(result, dict) for result in results)
        ):
            return results
        return None
    return None


def _raised(result: dict[str, object]) -> str | None:
    """The exception name a reconstruction call ended with, or None if it returned.

    Only an identifier is echoed: the line comes from the reconstruction interpreter,
    where the submission also runs, so it is not trusted to carry arbitrary text into
    a participant-facing message.
    """
    raised = result.get("raised")
    if raised is None:
        return None
    if isinstance(raised, str) and raised.isidentifier():
        return raised
    return "an exception"


def _is_int(value: object) -> bool:
    return isinstance(value, int) and not isinstance(value, bool)


def check_roundtrip(module, seed: str) -> list[str]:
    failures: list[str] = []
    calls: list[tuple[str, list[object]]] = []
    expected: list[tuple[int, int]] = []
    for label in LABELS:
        cfg = setting(seed, label)
        p, n, secret = cfg["p"], cfg["n"], cfg["secret"]
        try:
            shares = module.share(
                secret, n, p, share_randomness(seed, label, n - 1, p, secret)
            )
        except Exception as error:  # noqa: BLE001
            return [f"share raised {type(error).__name__}"]
        if not isinstance(shares, list) or len(shares) != n:
            failures.append("share did not return one value per party")
            continue
        if any(not _is_int(s) or not 0 <= s < p for s in shares):
            failures.append("a share is outside [0, modulus)")
            continue
        calls.append(("reconstruct", [list(shares), p]))
        expected.append((p, secret))
    if not calls:
        return failures
    # reconstruct never sees what share stored: it runs in another interpreter that
    # receives the shares as JSON and nothing else.
    results = _reconstruct_in_child(module, calls)
    if results is None:
        failures.append("reconstruct did not produce a result")
        return failures
    for (p, secret), result in zip(expected, results):
        raised = _raised(result)
        if raised is not None:
            failures.append(f"reconstruct raised {raised}")
            continue
        recovered = result.get("value")
        # Compared without normalizing first: reconstruct must return the canonical
        # element, not merely something congruent to it. Applying `% p` here would
        # let an implementation that never reduces pass, which the mutation suite
        # caught when this check did exactly that.
        if not _is_int(recovered) or not 0 <= recovered < p:
            failures.append("reconstruct returned a value outside [0, modulus)")
        elif recovered != secret % p:
            failures.append("reconstructing the full set does not return the secret")
    return failures


def check_no_trivial_split(module, seed: str) -> list[str]:
    """A split that hands the secret to one party is not a secret sharing."""
    failures: list[str] = []
    for label in LABELS:
        cfg = setting(seed, label)
        p, n, secret = cfg["p"], cfg["n"], cfg["secret"]
        if n < 2 or secret == 0:
            continue
        try:
            shares = module.share(
                secret, n, p, share_randomness(seed, label, n - 1, p, secret)
            )
        except Exception:  # noqa: BLE001 - covered by check_roundtrip
            return []
        if not isinstance(shares, list) or len(shares) != n:
            continue
        if sum(1 for s in shares if s % p == 0) >= n - 1:
            failures.append("all but one share is zero, so one party holds the secret outright")
    return failures


def check_completion(module, seed: str) -> list[str]:
    """Every secret must be reachable from the same n-1 shares.

    In-process on purpose: `complete_shares` is not paired with `share` here -- the
    n-1 shares come from the fixture, the requested secret is the argument, and the
    equation is checked by this test -- so there is nothing a stash could carry.
    """
    failures: list[str] = []
    for label in LABELS:
        cfg = setting(seed, label)
        p, n = cfg["p"], cfg["n"]
        partial = [r % p for r in randomness(seed, f"{label}-partial", n - 1, p)]
        for candidate in range(p):
            try:
                last = module.complete_shares(list(partial), candidate, p)
            except Exception as error:  # noqa: BLE001
                return [f"complete_shares raised {type(error).__name__}"]
            if not isinstance(last, int) or not 0 <= last < p:
                failures.append("complete_shares returned a value outside [0, modulus)")
                break
            if (sum(partial) + last) % p != candidate % p:
                failures.append("the completed set does not reconstruct to the requested secret")
                break
    return failures


def check_rerandomize(module, seed: str) -> list[str]:
    """The secret is read back by this test (sum of the shares), never by the
    submission's reconstruct, so a stash from `share` would gain nothing here."""
    failures: list[str] = []
    for label in LABELS:
        cfg = setting(seed, label)
        p, n, secret = cfg["p"], cfg["n"], cfg["secret"]
        try:
            shares = module.share(
                secret, n, p, share_randomness(seed, label, n - 1, p, secret)
            )
            fresh = module.rerandomize(
                list(shares),
                p,
                rerandomization_randomness(seed, f"{label}-rr", n - 1, p),
            )
        except Exception as error:  # noqa: BLE001
            return [f"rerandomize raised {type(error).__name__}"]
        if not isinstance(fresh, list) or len(fresh) != n:
            failures.append("rerandomize did not return one value per party")
            continue
        if any(not isinstance(s, int) or not 0 <= s < p for s in fresh):
            failures.append("a rerandomized share is outside [0, modulus)")
        if sum(fresh) % p != secret % p:
            failures.append("rerandomizing changed the secret")
        if fresh == list(shares):
            failures.append("rerandomize returned the same shares, so nothing was refreshed")
    return failures


# --- two-of-three -------------------------------------------------------------------


def _line_points(
    module, secret: int, p: int, slope: int
) -> tuple[list[list[int]] | None, str | None]:
    """Call the learner's share_line once and validate the shape of what came back.

    Returns the three points normalized to `[x, y]` lists, or a property-level
    failure. The shape is part of the documented contract (three `[x, y]` pairs at
    x = 1, 2, 3, y in [0, modulus)), so naming it does not narrow any hidden value.
    """
    try:
        points = module.share_line(secret, p, [slope])
    except Exception as error:  # noqa: BLE001 - a raising solution is a failing solution
        return None, f"share_line raised {type(error).__name__}"
    if not isinstance(points, list) or len(points) != 3:
        return None, "share_line did not return three points"
    normalized: list[list[int]] = []
    for party, point in zip(LINE_PARTIES, points):
        if not isinstance(point, (list, tuple)) or len(point) != 2:
            return None, "a point from share_line is not an [x, y] pair"
        x, y = point
        if not _is_int(x) or not _is_int(y):
            return None, "a point from share_line has a non-integer coordinate"
        if x != party:
            return None, "the points from share_line are not at x = 1, 2, 3 in that order"
        if not 0 <= y < p:
            return None, "a y value from share_line is outside [0, modulus)"
        normalized.append([x, y])
    return normalized, None


def _line_functions_present(module) -> list[str]:
    failures: list[str] = []
    for name in ("share_line", "reconstruct_line"):
        if not callable(getattr(module, name, None)):
            failures.append(f"{name} is not defined in sharing.py")
    return failures


def check_line_pairs(module, seed: str) -> list[str]:
    """Any two of the three points must walk back to the secret, in either order.

    Runs on every case in `line_cases`, including the ~10^4 moduli: there, the
    statement's trial search for the partner that multiplies to 1 costs at most p
    steps per reconstruction, and a search over every (secret, slope) pair costs
    about p^2 and runs into the verifier's time limit instead.
    """
    failures = _line_functions_present(module)
    if failures:
        return failures
    calls: list[tuple[str, list[object]]] = []
    expected: list[tuple[int, int]] = []
    for case in line_cases(seed):
        p, secret = case["p"], case["secret"]
        points, failure = _line_points(module, secret, p, case["slope"])
        if failure is not None or points is None:
            failures.append(failure or "share_line did not return three points")
            continue
        for i, j in ((0, 1), (0, 2), (1, 2)):
            for pair in ([points[i], points[j]], [points[j], points[i]]):
                calls.append(("reconstruct_line", [[list(point) for point in pair], p]))
                expected.append((p, secret))
    if not calls:
        return failures
    # reconstruct_line never sees what share_line stored: it runs in another
    # interpreter that receives the two points as JSON and nothing else.
    results = _reconstruct_in_child(module, calls)
    if results is None:
        failures.append("reconstruct_line did not produce a result")
        return failures
    for (p, secret), result in zip(expected, results):
        raised = _raised(result)
        if raised is not None:
            failures.append(f"reconstruct_line raised {raised}")
            return failures
        recovered = result.get("value")
        if not _is_int(recovered) or not 0 <= recovered < p:
            failures.append("reconstruct_line returned a value outside [0, modulus)")
        elif recovered != secret:
            failures.append("two of the three points did not walk back to the secret")
    return failures


def _point_matches(module, candidate: int, p: int, slope: int, position: int, y: int) -> bool:
    points, failure = _line_points(module, candidate, p, slope)
    return failure is None and points is not None and points[position][1] == y


def _privacy_exhaustive(module, case: dict[str, object]) -> list[str]:
    """Small modulus: every candidate secret must produce each party's point by some slope."""
    p = case["p"]
    points, failure = _line_points(module, case["secret"], p, case["slope"])
    if failure is not None or points is None:
        return [failure or "share_line did not return three points"]
    failures: list[str] = []
    for position, (x, y) in enumerate(points):
        for candidate in range(p):
            if not any(
                _point_matches(module, candidate, p, slope, position, y)
                for slope in range(p)
            ):
                failures.append(
                    f"party {x}'s point alone already narrows the secret down, "
                    "so one point is not hiding it"
                )
                break
    return failures


def _privacy_probe(module, seed: str, case: dict[str, object]) -> list[str]:
    """Large modulus: for a fixed secret, different slopes must give different y values.

    That is the same property as the exhaustive check, in the form that does not
    cost p x p calls: one point hides the secret exactly when, for a fixed secret,
    slope -> party i's y is a bijection on 0..p-1 -- then every y is reachable from
    every secret, by exactly one slope, and seeing one point rules nothing out. A
    collision means some y is unreachable for that secret, and that y would rule the
    secret out. Checked on every slope 0..p-1 for two secrets (2 x p calls of the
    learner's own share_line per case), so any construction with the property passes
    here too. Sampling a few hundred slopes was not enough: a share_line that folds a
    single slope onto another one collides only if both happen to be drawn.
    """
    p = case["p"]
    probe = privacy_probe(seed, case["label"], p, case["secret"])
    collided = [False] * len(LINE_PARTIES)
    for secret in probe["secrets"]:
        seen: list[set[int]] = [set() for _ in LINE_PARTIES]
        for slope in range(p):
            points, failure = _line_points(module, secret, p, slope)
            if failure is not None or points is None:
                return [failure or "share_line did not return three points"]
            for position, (_x, y) in enumerate(points):
                if y in seen[position]:
                    collided[position] = True
                seen[position].add(y)
    return [
        f"party {x}'s point comes out the same for two different slopes on a large "
        "modulus, so one point is not hiding the secret"
        for x, hit in zip(LINE_PARTIES, collided)
        if hit
    ]


def check_line_privacy(module, seed: str) -> list[str]:
    """One point alone must be consistent with every secret in the field.

    For each party's point, every candidate secret must be producible at that same
    position by *some* slope value -- checked with the learner's own `share_line`, so
    any construction with the property passes, not only the reference line. On the
    small-modulus cases that is a p x p search per point; on the ~10^4 cases it is the
    equivalent bijection condition on every slope (see `_privacy_probe`).
    """
    failures = _line_functions_present(module)
    if failures:
        return failures
    for case in line_cases(seed):
        if case["p"] in PRIMES:
            failures.extend(_privacy_exhaustive(module, case))
        else:
            failures.extend(_privacy_probe(module, seed, case))
    return failures


def run(module, seed: str) -> list[str]:
    return [
        *check_roundtrip(module, seed),
        *check_no_trivial_split(module, seed),
        *check_completion(module, seed),
        *check_rerandomize(module, seed),
        *check_line_pairs(module, seed),
        *check_line_privacy(module, seed),
    ]
