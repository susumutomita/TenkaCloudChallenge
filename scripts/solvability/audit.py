"""Audit one course problem for *solvability* defects, over many per-deploy seeds.

Motivation
----------
`make reference-test` and the per-problem TypeScript suites ask "does breaking the
implementation get caught?". Nothing asked "is the question answerable in the first
place?". Two live defects went through every existing gate:

  * `ac26-bridge-experiment` / `first-broken` shipped a corrupted trace with nothing
    outside `[0, modulus)` on 47 % of seeds. The only correct answer was `-1`, a value
    the statement never mentions.
  * the same problem's `predict` returned the on-screen `start` value on 164 of 2000
    seeds, so copying a number off the screen scored the checkpoint.

Both are properties of the *fixture distribution*, not of the implementation, so a
single-seed test cannot see them. This module sweeps seeds and measures.

What it measures
----------------
`static`  Which grader bodies can never reach `SEED`. Their answer is identical for
          every deploy, so one leaked answer scores the checkpoint for everybody.
          Cheap (AST only), runs over every problem, needs no fixtures.

`value`   Direct-answer checkpoints, driven by an `expected(seed)` mirror declared in
          `expected/<problem>.py`. Per checkpoint, over N seeds:
            - oracle:      `evaluate(cp, expected(seed))` is True          (type 5)
            - distinct:    how many distinct answers N seeds produce       (types 1/4)
            - sentinel:    how often the answer is -1 / 0 / "" / [] / {}   (type 1)
            - replay:      `evaluate(cp, expected(other_seed))` is False   (type 4)
            - visible:     the answer is a value already on the player's
                           screen (`show.py` stdout, `inspect_payload`)    (type 2)
          Value graders are pure arithmetic in-process, so N here is cheap.

`code`    Code checkpoints, driven through the problem's own `evaluate()` — the real
          production path, not a re-implementation of it:
            - reference:   the shipped reference passes, every seed        (type 5)
            - starter:     the shipped starter fails, every seed           (free points)
          Each call spawns a sandboxed subprocess, so N here is the expensive one.

Everything it could NOT measure is reported as an explicit `notAudited` entry. A
checkpoint that is silently skipped is exactly how the two defects above survived.

Usage
-----
    python3 audit.py --problem <path-to-challenges/xxx> --mode all --seeds 200
"""

from __future__ import annotations

import argparse
import ast
import contextlib
import importlib
import io
import json
import os
import re
import sys
import traceback
from pathlib import Path
from typing import Any, Callable

HERE = Path(__file__).resolve().parent

#: Answers that mean "there is nothing here". A statement that never mentions one of
#: these has no way for the player to produce it. `-1` is the one that shipped.
#: `0` is deliberately absent: it is a legitimate residue, index and count, so counting
#: it as a sentinel buries the signal in noise. It is reported separately as `zeroRate`.
SENTINELS: tuple[object, ...] = (-1, "", [], {}, None, "-1")


# --------------------------------------------------------------------------------------
# static: which graders can never reach SEED
# --------------------------------------------------------------------------------------


def _called_names(node: ast.AST) -> set[str]:
    names: set[str] = set()
    for child in ast.walk(node):
        if isinstance(child, ast.Call) and isinstance(child.func, ast.Name):
            names.add(child.func.id)
        elif isinstance(child, ast.Call) and isinstance(child.func, ast.Attribute):
            names.add(child.func.attr)
    return names


def _reads_seed(node: ast.AST) -> bool:
    return any(isinstance(child, ast.Name) and child.id == "SEED" for child in ast.walk(node))


#: Names whose presence in a grader's call graph means the submission is executed code,
#: not a value the player types. Used to classify checkpoints on problems that do not
#: declare a `CODE_CHECKPOINTS` table.
_SUBPROCESS_MARKERS = ("_run_submission", "_run_submission_script", "_run_hidden", "run")


def _server_functions(local: Path) -> tuple[str, dict[str, ast.FunctionDef]]:
    source = (local / "verifier" / "server.py").read_text(encoding="utf-8")
    tree = ast.parse(source)
    return source, {n.name: n for n in tree.body if isinstance(n, ast.FunctionDef)}


def _transitive(functions: dict[str, ast.FunctionDef], name: str, predicate: Callable[[ast.AST], bool]) -> bool:
    """Does `name`, or anything it calls inside this module, satisfy `predicate`?"""
    seen: set[str] = set()

    def walk(current: str) -> bool:
        if current in seen or current not in functions:
            return False
        seen.add(current)
        node = functions[current]
        if predicate(node):
            return True
        return any(walk(callee) for callee in _called_names(node))

    return walk(name)


def static_scan(local: Path) -> dict[str, Any]:
    """Report every `_check_*` grader whose verdict cannot depend on the deploy seed.

    Resolution is transitive through helper functions defined in the same module. A
    grader that reaches `SEED` nowhere grades a constant: the correct answer is the same
    in every deployment of the problem, so one leaked answer scores that checkpoint for
    everybody, which is the thing `FLAG_SEED` exists to prevent.

    This is the only probe that needs no fixtures, no seeds and no expected() mirror, so
    it covers every problem including the ones nothing else can reach.
    """
    _source, functions = _server_functions(local)
    graders = sorted(n for n in functions if n.startswith("_check_"))
    seedless = [n for n in graders if not _transitive(functions, n, _reads_seed)]
    return {"graders": graders, "seedless": seedless}


def _executes_submission(local: Path, checkpoint: str) -> bool:
    """Does `_check_<checkpoint>` run the submission as code rather than compare it?"""
    _source, functions = _server_functions(local)
    grader = "_check_" + checkpoint.replace("-", "_")
    if grader not in functions:
        return False
    return _transitive(
        functions,
        grader,
        lambda node: any(
            isinstance(child, ast.Call)
            and isinstance(child.func, ast.Name)
            and child.func.id in _SUBPROCESS_MARKERS
            for child in ast.walk(node)
        ),
    )


# --------------------------------------------------------------------------------------
# the problem under audit, loaded in-process
# --------------------------------------------------------------------------------------


class Problem:
    """A loaded problem. `verifier.server` is re-imported whenever the seed changes.

    `SEED` is a module global read from the environment at import time, and the direct-
    answer graders close over it, so a new seed means a new import. Fixture modules go
    with it: some cache seed-derived state at module scope.
    """

    #: Namespaces that belong to the problem under audit and must not leak between seeds
    #: — or between problems, several of which ship a module called `fixtures.generate`.
    OWNED_PREFIXES = ("verifier", "fixtures", "tests", "lab", "reference", "starter")

    def __init__(self, root: Path) -> None:
        self.root = root
        self.local = root / "local"
        self.id = root.name
        self._seed: str | None = None
        self.server: Any = None

    def _purge(self) -> None:
        for name in list(sys.modules):
            if name.split(".")[0] in self.OWNED_PREFIXES:
                del sys.modules[name]

    def load(self, seed: str) -> Any:
        if self._seed == seed and self.server is not None:
            return self.server
        self._purge()
        os.environ["FLAG_SEED"] = seed
        if str(self.local) not in sys.path:
            sys.path.insert(0, str(self.local))
        self.server = importlib.import_module("verifier.server")
        self._seed = seed
        return self.server

    def checkpoints(self) -> tuple[str, ...]:
        return tuple(getattr(self.load(self._seed or "probe-seed"), "CHECKPOINTS", ()))

    def code_checkpoints(self) -> tuple[str, ...]:
        """Checkpoints whose submission is executed, not compared.

        Most problems declare a table. `ac26-bridge-experiment` does not — its
        `generalize` grader runs the submission from inside `evaluate` — so the
        declaration is backed up by a static read of the grader's call graph. Getting
        this wrong in the permissive direction is the dangerous one: a code checkpoint
        misfiled as a direct-answer checkpoint would be reported as unaudited forever.
        """
        server = self.load(self._seed or "probe-seed")
        declared: tuple[str, ...] = ()
        for attribute in ("CODE_CHECKPOINTS", "FILE_CHECKPOINTS", "CODE_CHECKPOINT_IDS"):
            table = getattr(server, attribute, None)
            if table:
                declared = tuple(table)
                break
        inferred = tuple(
            checkpoint
            for checkpoint in self.checkpoints()
            if checkpoint not in declared and _executes_submission(self.local, checkpoint)
        )
        return declared + inferred

    def sources(self, kind: str) -> dict[str, str]:
        """`reference/` or `starter/` as {filename: source}."""
        directory = self.local / kind
        if not directory.is_dir():
            return {}
        return {p.name: p.read_text(encoding="utf-8") for p in sorted(directory.glob("*.py"))}

    def show_output(self, seed: str) -> str:
        """`make inspect` stdout — the player's screen, and the surface an answer may leak into.

        Executed in a throwaway namespace rather than a subprocess: the audit runs it
        once per seed and the subprocess cost dominates everything else at N in the
        hundreds. `show.py` reads `FLAG_SEED` at module scope, so a fresh exec picks up
        the new seed the same way a fresh container would.
        """
        show = self.local / "show.py"
        if not show.exists():
            return ""
        self._purge()
        os.environ["FLAG_SEED"] = seed
        self._seed = None  # the purge invalidated the cached server import
        buffer = io.StringIO()
        namespace: dict[str, Any] = {"__name__": "__main__", "__file__": str(show)}
        try:
            with contextlib.redirect_stdout(buffer):
                exec(compile(show.read_text(encoding="utf-8"), str(show), "exec"), namespace)  # noqa: S102
        except SystemExit:
            pass
        except Exception:  # noqa: BLE001 - a show.py that raises is reported, not fatal
            return f"__SHOW_FAILED__ {traceback.format_exc(limit=1)}"
        return buffer.getvalue()


# --------------------------------------------------------------------------------------
# value checkpoints
# --------------------------------------------------------------------------------------


def _canonical(value: object) -> str:
    try:
        return json.dumps(value, sort_keys=True, default=str)
    except TypeError:
        return repr(value)


def _is_sentinel(value: object) -> bool:
    return any(value == sentinel and type(value) is type(sentinel) for sentinel in SENTINELS)


_INT_TOKEN = re.compile(r"-?\d+")
#: `start=12 step=8` — the shape every AC26 `show.py` prints its fixture fields in.
_INLINE_FIELD = re.compile(r"\b([A-Za-z][A-Za-z0-9_]{1,24})\s*=\s*(-?[0-9a-fx]+)\b")
#: `health token     831032890f92792d` / `order n      : 1234` — one field per line.
_LINE_FIELD = re.compile(r"^\s*([A-Za-z][A-Za-z0-9 _()\-]{0,30}?)\s*[:]?\s{1,}(-?[0-9a-fx]+)\s*$")


def _visible_tokens(text: str) -> set[str]:
    """Every integer and hex-ish token printed on the player's screen."""
    tokens = set(_INT_TOKEN.findall(text))
    tokens.update(re.findall(r"\b[0-9a-f]{4,}\b", text))
    return tokens


#: `== checkpoint: predict ==`, `== what goes in the predict box ==` — `show.py` marks
#: which part of the screen belongs to which checkpoint, but the wording is being
#: rewritten problem by problem, so the header is matched on the checkpoint id appearing
#: inside a banner rather than on one fixed phrasing.
_SECTION_HEADER = re.compile(r"^==+\s*(.+?)\s*==+\s*$", re.MULTILINE)


def _screen_section(text: str, checkpoint: str) -> tuple[str, str]:
    """The part of the screen that belongs to `checkpoint`, and how it was scoped.

    Scope matters for the field probe. `ac26-bridge-experiment` prints three walks, each
    with its own `start=`, so an unscoped label match dilutes "the predicted value equals
    the start the player was shown" down towards chance. Where `show.py` does not mark
    sections the whole screen is used and the row says so, because a diluted rate must
    not be reported as if it were a clean one.
    """
    matches = list(_SECTION_HEADER.finditer(text))
    words = set(re.split(r"[^a-z0-9]+", checkpoint))
    for index, match in enumerate(matches):
        banner = set(re.split(r"[^a-z0-9]+", match.group(1).lower()))
        if not words <= banner:
            continue
        end = matches[index + 1].start() if index + 1 < len(matches) else len(text)
        return text[match.end() : end], "section"
    return text, "whole-screen"


def _visible_fields(text: str) -> dict[str, set[str]]:
    """The screen's *labelled* values, keyed by label.

    Token-set membership alone is not a usable signal: with a modulus of 23 and a
    ten-entry trace on screen, a uniformly random correct answer is already visible most
    of the time. The defect that shipped was narrower and checkable — `predict`'s answer
    was equal to the field labelled `start`. Field-level rates are what expose that.
    """
    fields: dict[str, set[str]] = {}
    for label, value in _INLINE_FIELD.findall(text):
        fields.setdefault(label, set()).add(value)
    for line in text.splitlines():
        match = _LINE_FIELD.match(line)
        if match:
            fields.setdefault(match.group(1).strip(), set()).add(match.group(2))
    return fields


def _answer_tokens(value: object) -> list[str]:
    """The scalar leaves of an answer, as the strings a player could copy off the screen."""
    if isinstance(value, bool):
        return []
    if isinstance(value, int):
        return [str(value)]
    if isinstance(value, str):
        return [value.strip()] if value.strip() else []
    if isinstance(value, bytes):
        return [value.hex()]
    if isinstance(value, (list, tuple)):
        return [token for item in value for token in _answer_tokens(item)]
    if isinstance(value, dict):
        return [token for item in value.values() for token in _answer_tokens(item)]
    return []


def audit_value(
    problem: Problem,
    seeds: list[str],
    expected: dict[str, Callable[[Any, str], object]],
    visible: dict[str, Callable[[Any, str], dict[str, object]]],
    screen_seeds: int,
) -> list[dict[str, Any]]:
    """Sweep the direct-answer checkpoints against their `expected(seed)` mirror.

    One pass over the seeds builds, per seed, the answer and the player's screen. The
    probes are then all computed from those two, so the expensive part (running
    `show.py` once per seed) is paid once no matter how many checkpoints a problem has.

    Rendering the screen costs about ten times what deriving an answer does, and the
    visibility probes estimate a *rate* — a few hundred samples pin that as tightly as
    the report can use. So the answer probes get every seed and the screen is rendered
    for the first `screen_seeds` of them. The row records both counts; nothing is
    reported at a sample size it was not measured at.
    """
    screens: dict[str, str] = {}
    shown: dict[str, dict[str, dict[str, object]]] = {checkpoint: {} for checkpoint in expected}
    answers: dict[str, dict[str, object]] = {checkpoint: {} for checkpoint in expected}
    errors: dict[str, list[str]] = {checkpoint: [] for checkpoint in expected}
    rejected: dict[str, list[str]] = {checkpoint: [] for checkpoint in expected}

    for index, seed in enumerate(seeds):
        if index < screen_seeds:
            screens[seed] = problem.show_output(seed)
        server = problem.load(seed)
        for checkpoint, oracle in expected.items():
            try:
                answer = oracle(server, seed)
            except Exception as error:  # noqa: BLE001
                errors[checkpoint].append(f"{seed}: expected() raised {type(error).__name__}: {error}")
                continue
            answers[checkpoint][seed] = answer
            if checkpoint in visible:
                try:
                    shown[checkpoint][seed] = visible[checkpoint](server, seed)
                except Exception as error:  # noqa: BLE001
                    errors[checkpoint].append(
                        f"{seed}: VISIBLE raised {type(error).__name__}: {error}"
                    )
            try:
                accepted = bool(server.evaluate(checkpoint, answer))
            except Exception as error:  # noqa: BLE001
                accepted = False
                errors[checkpoint].append(f"{seed}: evaluate raised {type(error).__name__}: {error}")
            if not accepted:
                rejected[checkpoint].append(f"{seed}: {_canonical(answer)[:120]}")

    results: list[dict[str, Any]] = []
    for checkpoint in expected:
        seen = answers[checkpoint]
        ordered = [seen[seed] for seed in seeds if seed in seen]
        sentinel_seeds = [seed for seed, a in seen.items() if _is_sentinel(a)]
        zero_seeds = [seed for seed, a in seen.items() if a == 0 and not isinstance(a, bool)]

        # Visibility. `matched` is the coarse "every part of the answer is a token on the
        # screen" rate; `control` is the same test applied to another seed's answer, which
        # is the rate a correct-shaped but unrelated value hits by chance. Only the gap
        # between them is evidence. `fieldRates` names the labelled field the answer keeps
        # coinciding with, which is what a player would actually copy.
        matched = 0
        control = 0
        field_hits: dict[str, int] = {}
        field_control: dict[str, int] = {}
        field_scope = "no-screen"
        screened = 0
        for index, seed in enumerate(seed for seed in seeds if seed in seen):
            screen = screens.get(seed)
            if screen is None:
                continue
            screened += 1
            section, field_scope = _screen_section(screen, checkpoint)
            tokens = _answer_tokens(seen[seed])
            visible = _visible_tokens(screen)
            if tokens and all(token in visible for token in tokens):
                matched += 1
            other = ordered[(index + 1) % len(ordered)]
            other_tokens = _answer_tokens(other)
            if other_tokens and all(token in visible for token in other_tokens):
                control += 1
            if len(tokens) == 1:
                for label, values in _visible_fields(section).items():
                    if tokens[0] in values:
                        field_hits[label] = field_hits.get(label, 0) + 1
                    if len(other_tokens) == 1 and other_tokens[0] in values:
                        field_control[label] = field_control.get(label, 0) + 1

        # The exact form of the same question, where the mirror declares which fixture
        # fields the player is looking at. Independent of how `show.py` formats them, so
        # this is the probe that survives a rewrite of the statement.
        fixture_hits: dict[str, int] = {}
        fixture_control: dict[str, int] = {}
        fixture_total = 0
        for index, seed in enumerate(seed for seed in seeds if seed in seen):
            fields = shown[checkpoint].get(seed)
            if fields is None:
                continue
            fixture_total += 1
            answer = _canonical(seen[seed])
            other = _canonical(ordered[(index + 1) % len(ordered)])
            for label, value in fields.items():
                if _canonical(value) == answer:
                    fixture_hits[label] = fixture_hits.get(label, 0) + 1
                if _canonical(value) == other:
                    fixture_control[label] = fixture_control.get(label, 0) + 1

        # Cross-seed replay: an answer worked out for one deploy must not score another.
        replay_hits: list[str] = []
        replay_tested = 0
        for index, seed in enumerate(seed for seed in seeds if seed in seen):
            if replay_tested >= 60:
                break
            other = ordered[(index + 1) % len(ordered)]
            if _canonical(other) == _canonical(seen[seed]):
                continue
            replay_tested += 1
            server = problem.load(seed)
            try:
                if server.evaluate(checkpoint, other):
                    replay_hits.append(seed)
            except Exception:  # noqa: BLE001
                pass

        total = max(len(ordered), 1)
        screen_total = max(screened, 1)
        # How often the single most common answer comes up. A checkpoint whose answer is
        # the same value on half the deploys is answerable by guessing that value, even
        # when the answer is nominally seed-derived.
        histogram: dict[str, int] = {}
        for answer in ordered:
            key = _canonical(answer)
            histogram[key] = histogram.get(key, 0) + 1
        most_common = max(histogram.values()) if histogram else 0
        distinct = len({_canonical(a) for a in ordered})
        results.append(
            {
                "checkpoint": checkpoint,
                "kind": "value",
                "seeds": len(ordered),
                "distinctAnswers": distinct,
                "constantAcrossSeeds": distinct == 1,
                "mostCommonRate": round(most_common / total, 4),
                "oracleRejected": len(rejected[checkpoint]),
                "oracleRejectedExamples": rejected[checkpoint][:5],
                "sentinelRate": len(sentinel_seeds) / total,
                "sentinelExamples": sentinel_seeds[:5],
                "zeroRate": len(zero_seeds) / total,
                "visibleRate": matched / screen_total,
                "visibleControlRate": control / screen_total,
                # rate: how often the answer equals the value printed under this label.
                # control: the same, for an unrelated seed's answer — the chance level.
                # A leak is `rate` materially above `control`; equal rates mean the
                # collision is arithmetic coincidence in a small answer space.
                "screenSeeds": screened,
                "fixtureFieldSeeds": fixture_total,
                "fixtureFieldRates": {
                    label: {
                        "rate": round(count / max(fixture_total, 1), 4),
                        "control": round(fixture_control.get(label, 0) / max(fixture_total, 1), 4),
                    }
                    for label, count in sorted(fixture_hits.items(), key=lambda kv: -kv[1])
                },
                "fieldScope": field_scope,
                "fieldRates": {
                    label: {
                        "rate": round(count / screen_total, 4),
                        "control": round(field_control.get(label, 0) / screen_total, 4),
                    }
                    for label, count in sorted(field_hits.items(), key=lambda kv: -kv[1])[:6]
                },
                "replayTested": replay_tested,
                "replayAccepted": len(replay_hits),
                "replayExamples": replay_hits[:5],
                "errors": errors[checkpoint][:5],
                "sampleAnswers": [_canonical(a)[:120] for a in ordered[:3]],
            }
        )
    return results


# --------------------------------------------------------------------------------------
# code checkpoints
# --------------------------------------------------------------------------------------


def _binding_candidates(sources: dict[str, str]) -> list[tuple[str, object]]:
    """The submission shapes a problem's `evaluate` might expect, most likely first.

    Single-file problems take the raw source; multi-file problems take a {name: source}
    map, sometimes as a JSON string. The audit tries each and records which one bound,
    rather than guessing from the verifier's source.
    """
    candidates: list[tuple[str, object]] = []
    if len(sources) == 1:
        only = next(iter(sources.values()))
        candidates.append(("raw-source", only))
    candidates.append(("file-map", dict(sources)))
    candidates.append(("file-map-json", json.dumps(sources)))
    if len(sources) > 1:
        for name, text in sources.items():
            candidates.append((f"raw-source:{name}", text))
    return candidates


def _bind(
    problem: Problem, seed: str, checkpoints: tuple[str, ...], sources: dict[str, str]
) -> tuple[str, object, int] | None:
    """Pick the submission shape the reference gets furthest with, and how far that is.

    The naive rule — take the first shape that passes *every* checkpoint — conflates the
    two things this audit must never conflate. `ac26-w3-nonce-reuse`'s reference fails one
    checkpoint on about a tenth of seeds, so on an unlucky probe seed no shape passes
    everything and the whole problem reported as "shape unknown, not audited" while the
    real finding was sitting in front of it. Scoring the shapes instead means a shape that
    binds keeps binding, and the failures land where they belong: on the checkpoint.
    """
    server = problem.load(seed)
    best: tuple[str, object, int] | None = None
    for label, payload in _binding_candidates(sources):
        passed = 0
        for checkpoint in checkpoints:
            try:
                if server.evaluate(checkpoint, payload):
                    passed += 1
            except Exception:  # noqa: BLE001
                continue
        if passed == len(checkpoints):
            return label, payload, passed
        if best is None or passed > best[2]:
            best = (label, payload, passed)
    return best if best is not None and best[2] > 0 else None


def audit_code(problem: Problem, seeds: list[str]) -> dict[str, Any]:
    """Run the shipped reference and the shipped starter through the real `evaluate()`."""
    code = problem.code_checkpoints()
    reference = problem.sources("reference")
    starter = problem.sources("starter")
    if not code:
        return {"checkpoints": [], "notAudited": [{"reason": "no code checkpoints"}]}
    if not reference:
        return {"checkpoints": [], "notAudited": [{"reason": "no reference/ sources to run"}]}

    binding = _bind(problem, seeds[0], code, reference)
    if binding is None:
        return {
            "checkpoints": [],
            "notAudited": [
                {
                    "reason": "the reference passed no checkpoint under any submission "
                    "shape, so nothing here was measured — either every checkpoint is "
                    "broken at the probe seed or the shape is one this audit does not know",
                    "seed": seeds[0],
                    "shapesTried": [label for label, _ in _binding_candidates(reference)],
                }
            ],
        }
    shape, reference_payload, _bound = binding
    starter_payload = None
    if starter:
        by_shape = dict(_binding_candidates(starter))
        starter_payload = by_shape.get(shape)

    rows: list[dict[str, Any]] = []
    for checkpoint in code:
        reference_failures: list[str] = []
        starter_passes: list[str] = []
        for seed in seeds:
            server = problem.load(seed)
            try:
                if not server.evaluate(checkpoint, reference_payload):
                    reference_failures.append(seed)
            except Exception as error:  # noqa: BLE001
                reference_failures.append(f"{seed} ({type(error).__name__})")
            if starter_payload is not None:
                try:
                    if server.evaluate(checkpoint, starter_payload):
                        starter_passes.append(seed)
                except Exception:  # noqa: BLE001
                    pass
        rows.append(
            {
                "checkpoint": checkpoint,
                "kind": "code",
                "seeds": len(seeds),
                "referenceFailures": len(reference_failures),
                "referenceFailureExamples": reference_failures[:5],
                "starterPasses": len(starter_passes),
                "starterPassExamples": starter_passes[:5],
                "starterAudited": starter_payload is not None,
            }
        )
    return {"checkpoints": rows, "submissionShape": shape, "notAudited": []}


# --------------------------------------------------------------------------------------
# entry point
# --------------------------------------------------------------------------------------


def load_mirror(problem_id: str, directory: Path) -> tuple[dict[str, Any], dict[str, Any]]:
    """`EXPECTED` (the correct answer) and `VISIBLE` (what the player is looking at)."""
    module_path = directory / f"{problem_id}.py"
    if not module_path.exists():
        return {}, {}
    namespace: dict[str, Any] = {"__name__": f"expected_{problem_id}"}
    exec(compile(module_path.read_text(encoding="utf-8"), str(module_path), "exec"), namespace)  # noqa: S102
    return namespace.get("EXPECTED", {}), namespace.get("VISIBLE", {})


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--problem", required=True)
    parser.add_argument("--mode", default="all", choices=("all", "static", "value", "code"))
    parser.add_argument("--seeds", type=int, default=200)
    parser.add_argument("--code-seeds", type=int, default=0, help="defaults to --seeds")
    parser.add_argument(
        "--screen-seeds",
        type=int,
        default=300,
        help="how many of --seeds also render show.py for the visibility probes",
    )
    parser.add_argument("--seed-prefix", default="solvability")
    parser.add_argument(
        "--expected-dir",
        default=str(HERE / "expected"),
        help="where the expected(seed) mirrors live; overridable so the guard can be "
        "replayed against an archived revision of a problem",
    )
    args = parser.parse_args()

    os.environ.setdefault("PYTHONDONTWRITEBYTECODE", "1")
    sys.dont_write_bytecode = True

    root = Path(args.problem).resolve()
    problem = Problem(root)
    report: dict[str, Any] = {"problem": problem.id, "notAudited": []}

    if args.mode in ("all", "static"):
        report["static"] = static_scan(problem.local)

    value_seeds = [f"{args.seed_prefix}-{i}" for i in range(args.seeds)]
    code_seeds = [f"{args.seed_prefix}-{i}" for i in range(args.code_seeds or args.seeds)]

    all_checkpoints = set(problem.checkpoints())
    code_checkpoints = set(problem.code_checkpoints())
    value_checkpoints = all_checkpoints - code_checkpoints
    report["checkpointCensus"] = {
        "all": sorted(all_checkpoints),
        "code": sorted(code_checkpoints),
        "value": sorted(value_checkpoints),
    }

    rows: list[dict[str, Any]] = []
    if args.mode in ("all", "value"):
        expected, visible = load_mirror(problem.id, Path(args.expected_dir))
        missing = sorted(value_checkpoints - set(expected))
        if missing:
            report["notAudited"].append(
                {
                    "checkpoints": missing,
                    "reason": f"no expected(seed) mirror at {args.expected_dir}/"
                    f"{problem.id}.py; the direct-answer probes need one",
                }
            )
        usable = {k: v for k, v in expected.items() if k in value_checkpoints}
        stale = sorted(set(expected) - value_checkpoints)
        if stale:
            report["notAudited"].append(
                {"checkpoints": stale, "reason": "expected() declared for a checkpoint that is not a direct-answer checkpoint"}
            )
        if usable:
            rows.extend(
                audit_value(problem, value_seeds, usable, visible, args.screen_seeds)
            )

    if args.mode in ("all", "code"):
        code_report = audit_code(problem, code_seeds)
        rows.extend(code_report["checkpoints"])
        report["notAudited"].extend(code_report.get("notAudited", []))
        if code_report.get("submissionShape"):
            report["submissionShape"] = code_report["submissionShape"]

    report["rows"] = rows
    print(json.dumps(report))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
