"""Author probe for the range checkpoint's out-of-range check.

A code review found that `check_range` used to test only four sampled values outside
the range, so a gadget that admits some *other* out-of-range value passed. The gadget
that showed it -- `mutation._SELECTOR_GADGET`, a boolean selector that either runs the
honest decomposition or forces the signal to 2**bits + 1 -- is replayed here against
the hidden checker, together with three honest constructions as controls.

For every seed given (default: three), and every hidden label with bits >= 2, this
prints:

  - the selector gadget's explicit witness for 2**bits + 1 and its residuals by the
    reference evaluator (all zero: the gadget provably admits that value, no search
    needed), then check_range's verdict on it -- ACCEPTED marks the hole, REJECTED the
    fix, with the property-level message a participant would see;
  - check_range's verdict and wall time on the reference (Horner form), a per-digit
    doubling chain and a constant-weights + mul construction, all of which must pass;
  - finally, `admitted_range_values` against a brute force over every assignment of
    every signal, on random small gadgets in a small field (FUZZ_CASES of them, from a
    fixed random seed) -- the evidence that "exact" holds beyond the constructions
    above, including gadgets whose propagation gets stuck and takes the per-value path.

Run from a checkout:  python3 local/probes/range_exactness.py [seed ...]
It is not shipped in any image; mutation.py carries the same gadget as a mutant.
"""

from __future__ import annotations

import itertools
import random
import sys
import time
from pathlib import Path

LOCAL = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(LOCAL))

import mutation  # noqa: E402
from fixtures.generate import field_modulus, range_bits  # noqa: E402
from tests.hidden.check_circuit import (  # noqa: E402
    LABELS,
    RANGE_SIGNAL,
    SearchBudgetExceeded,
    admitted_range_values,
    check_range,
    constraint_signals,
    reference_evaluate,
)

DEFAULT_SEEDS = ("local-dev-seed", "mutation-suite-seed", "wave5-review-seed")
FUZZ_CASES = 400
FUZZ_PRIME = 7
FUZZ_BITS = 2
FUZZ_SIGNALS = (RANGE_SIGNAL, "a", "b", "c")

# Per-digit doubling chain: digit i is doubled i times on its own, then the 2**i * b_i
# terms are summed. bits + bits * (bits - 1) / 2 + bits - 1 constraints (26 at bits = 6).
_DOUBLING_CHAIN = '''
def range_constraints(signal, bits):
    if bits == 1:
        return [{"id": "b0", "kind": "boolean", "signal": signal}]
    out = [{"id": f"b{i}", "kind": "boolean", "signal": f"{signal}.b{i}"} for i in range(bits)]
    terms = [f"{signal}.b0"]
    for i in range(1, bits):
        current = f"{signal}.b{i}"
        for step in range(i):
            doubled = f"{signal}.d{i}_{step}"
            out.append({"id": doubled, "kind": "add", "left": current, "right": current, "out": doubled})
            current = doubled
        terms.append(current)
    total = terms[0]
    for i in range(1, bits):
        target = signal if i == bits - 1 else f"{signal}.s{i}"
        out.append({"id": f"s{i}", "kind": "add", "left": total, "right": terms[i], "out": target})
        total = target
    return out

def range_witness(signal, value, bits):
    witness = {signal: value}
    if bits == 1:
        return witness
    terms = []
    for i in range(bits):
        digit = (value // 2 ** i) % 2
        witness[f"{signal}.b{i}"] = digit
        current = digit
        for step in range(i):
            current *= 2
            witness[f"{signal}.d{i}_{step}"] = current
        terms.append(current)
    total = terms[0]
    for i in range(1, bits - 1):
        total += terms[i]
        witness[f"{signal}.s{i}"] = total
    return witness
'''

# Constant weights: w_i = 2**i pinned by const, t_i = b_i * w_i by mul, then a sum chain.
# 4 * bits - 3 constraints.
_CONST_WEIGHTS = '''
def range_constraints(signal, bits):
    if bits == 1:
        return [{"id": "b0", "kind": "boolean", "signal": signal}]
    out = [{"id": f"b{i}", "kind": "boolean", "signal": f"{signal}.b{i}"} for i in range(bits)]
    for i in range(1, bits):
        out.append({"id": f"w{i}", "kind": "const", "signal": f"{signal}.w{i}", "value": 2 ** i})
        out.append({"id": f"t{i}", "kind": "mul", "left": f"{signal}.b{i}", "right": f"{signal}.w{i}", "out": f"{signal}.t{i}"})
    total = f"{signal}.b0"
    for i in range(1, bits):
        target = signal if i == bits - 1 else f"{signal}.s{i}"
        out.append({"id": f"s{i}", "kind": "add", "left": total, "right": f"{signal}.t{i}", "out": target})
        total = target
    return out

def range_witness(signal, value, bits):
    witness = {signal: value}
    if bits == 1:
        return witness
    total = 0
    for i in range(bits):
        digit = (value // 2 ** i) % 2
        witness[f"{signal}.b{i}"] = digit
        if i:
            witness[f"{signal}.w{i}"] = 2 ** i
            witness[f"{signal}.t{i}"] = digit * 2 ** i
        total += digit * 2 ** i
        if 0 < i < bits - 1:
            witness[f"{signal}.s{i}"] = total
    return witness
'''

CONSTRUCTIONS = (
    ("reference (Horner form)", mutation._reference_source("gadgets.py")),
    ("per-digit doubling chain", mutation._gadgets_override(_DOUBLING_CHAIN)),
    ("constant weights + mul", mutation._gadgets_override(_CONST_WEIGHTS)),
)


def _gadgets(source: str):
    base = {name: mutation._reference_source(f"{name}.py") for name in ("field", "circuit")}
    return mutation._modules(base["field"], base["circuit"], source)[2]


def _selector_witness(gadgets, bits: int) -> dict[str, int]:
    """The assignment the selector gadget accepts for 2**bits + 1: sel = 1, digits 0."""
    witness = gadgets.range_witness(RANGE_SIGNAL, 0, bits)
    witness.update({RANGE_SIGNAL: 2**bits + 1, "sel": 1, "jump": 2**bits + 1})
    return witness


def _timed(gadgets, seed: str) -> tuple[list[str], float]:
    started = time.perf_counter()
    failures = check_range(gadgets, seed)
    return failures, time.perf_counter() - started


def _random_gadget(rng: random.Random) -> list[dict]:
    kinds = ("boolean", "add", "mul", "const")
    gadget = []
    for index in range(rng.randint(1, 6)):
        kind = rng.choice(kinds)
        if kind in ("add", "mul"):
            gadget.append({"id": f"c{index}", "kind": kind, **{k: rng.choice(FUZZ_SIGNALS) for k in ("left", "right", "out")}})
        elif kind == "const":
            gadget.append({"id": f"c{index}", "kind": kind, "signal": rng.choice(FUZZ_SIGNALS), "value": rng.randrange(FUZZ_PRIME)})
        else:
            gadget.append({"id": f"c{index}", "kind": kind, "signal": rng.choice(FUZZ_SIGNALS)})
    return gadget


def _brute_force(gadget: list[dict], p: int) -> set[int]:
    """The signal's admitted values by trying every assignment of every signal.

    A signal no constraint mentions is admitted at every value -- provided the
    constraints have a solution at all; an unsatisfiable gadget admits nothing.
    """
    names = sorted({name for constraint in gadget for name in constraint_signals(constraint)})
    admitted = set()
    for values in itertools.product(range(p), repeat=len(names)):
        witness = dict(zip(names, values))
        if all(reference_evaluate(c, witness, p) == 0 for c in gadget):
            if RANGE_SIGNAL not in witness:
                return set(range(p))
            admitted.add(witness[RANGE_SIGNAL])
    return admitted


def fuzz(cases: int) -> int:
    """Disagreements between `admitted_range_values` and brute force on random gadgets."""
    from tests.hidden.check_circuit import _SignalSearch, _Undetermined  # noqa: PLC0415 - author probe

    rng = random.Random("range-exactness")
    inside = set(range(2**FUZZ_BITS))
    disagreements = 0
    skipped = 0
    fallbacks = 0
    for _ in range(cases):
        gadget = _random_gadget(rng)
        oracle = _brute_force(gadget, FUZZ_PRIME)
        try:
            _SignalSearch(gadget, FUZZ_PRIME, 10**6).admitted_values(RANGE_SIGNAL, inside)
        except _Undetermined:
            fallbacks += 1
        except SearchBudgetExceeded:
            pass
        try:
            found = admitted_range_values(gadget, FUZZ_BITS, FUZZ_PRIME)
        except SearchBudgetExceeded:
            skipped += 1
            continue
        # A run that stops early at an outside value is partial but must still be a
        # subset of the truth and contain an outside value exactly when the truth does.
        agrees = found <= oracle and (found == oracle if oracle <= inside else bool(found - inside))
        if not agrees:
            disagreements += 1
            print(f"  DISAGREE oracle={sorted(oracle)} found={sorted(found)} gadget={gadget}")
    print(
        f"  fuzz: {cases} random gadgets in F_{FUZZ_PRIME}, bits={FUZZ_BITS}: {disagreements} disagreement(s),"
        f" {fallbacks} took the value-by-value path, {skipped} over budget"
    )
    return disagreements


def main(seeds: list[str]) -> int:
    holes = 0
    broken_controls = 0
    selector = _gadgets(mutation._gadgets_override(mutation._SELECTOR_GADGET))
    for seed in seeds:
        print(f"== seed {seed} ==")
        for label in LABELS:
            p = field_modulus(seed, label)
            bits = range_bits(seed, label)
            if bits < 2:
                continue
            constraints = selector.range_constraints(RANGE_SIGNAL, bits)
            witness = _selector_witness(selector, bits)
            residuals = [reference_evaluate(c, witness, p) for c in constraints]
            print(
                f"  {label}: p={p} bits={bits} selector gadget has {len(constraints)} constraints"
                f" (budget {5 * bits}); witness for {2**bits + 1} leaves residuals {sorted(set(residuals))}"
            )
        failures, seconds = _timed(selector, seed)
        if failures:
            print(f"  selector gadget REJECTED in {seconds:.2f}s: {failures[0]}")
        else:
            holes += 1
            print(f"  selector gadget ACCEPTED in {seconds:.2f}s -- the sampled-probe hole")
        for name, source in CONSTRUCTIONS:
            failures, seconds = _timed(_gadgets(source), seed)
            verdict = "passes" if not failures else f"FAILS: {failures[0]}"
            broken_controls += bool(failures)
            print(f"  {name}: {verdict} ({seconds:.2f}s)")
    print("== exact search vs brute force ==")
    disagreements = fuzz(FUZZ_CASES)
    print()
    if holes or broken_controls or disagreements:
        print(
            f"{holes} seed(s) accepted the selector gadget; {broken_controls} honest construction"
            f" run(s) failed; {disagreements} brute-force disagreement(s)"
        )
        return 1
    print("selector gadget rejected on every seed; every honest construction passed; exact search agrees with brute force")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:] or list(DEFAULT_SEEDS)))
