"""Hidden tests. Run by /verify against a copy of the learner's extract.py.

Ground truth is `fixtures.generate`, never the submission. That matters twice here.

Extraction is graded against the *phase*, not against the reference's mask: a submission is
free to build the vector however it likes as long as `body - <mask, ring_secret>` comes out
equal to the polynomial coefficient. And every coefficient index is checked, because a slot
wraps only when its secret index is above the extracted one — so at `degree - 1` nothing
wraps, and a sign-blind extraction is correct there and nowhere else.

Key switching is graded end to end against the target key, and crossed: fixture-built
samples through the submission's switch, and the submission's samples through the fixtures'.
A pair of functions that agree with each other about a reversed digit order agree about
nothing else.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from fixtures.generate import (  # noqa: E402
    decode,
    decompose_mask as reference_decompose_mask,
    domain_report as reference_report,
    extract_sample as reference_extract,
    extract_trace as reference_trace,
    key_id,
    key_switch as reference_switch,
    lwe_decrypt,
    lwe_phase_of,
    params as parameters,
    phase_coefficient as reference_phase_coefficient,
    ring_noise,
    ring_random,
    rlwe_encrypt,
    rlwe_secret,
    rotated_accumulator,
    switching_key,
    target_secret,
)

LABELS = ("h0", "h1", "h2", "h3")


def _sets(seed: str) -> list[dict]:
    """Parameter sets covering both bases and more than one ring degree."""
    drawn = [parameters(seed, label) for label in LABELS]
    for base in (2, 4):
        if not any(par["base"] == base for par in drawn):
            drawn.append(_forced(base))
    if not any(par["degree"] >= 8 for par in drawn):
        drawn.append(_forced(2, minimum_degree=8))
    return drawn


def _forced(base: int, minimum_degree: int = 0) -> dict:
    from fixtures.generate import VIABLE

    levels, degree, dimension, target = next(
        (l, d, n, t) for b, l, d, n, t in VIABLE if b == base and d >= minimum_degree
    )
    modulus = base**levels
    return {
        "base": base,
        "levels": levels,
        "degree": degree,
        "dimension": dimension,
        "target_dimension": target,
        "modulus": modulus,
        "plaintext_modulus": 4,
        "delta": modulus // 4,
    }


def _scene(seed: str, par: dict, label: str) -> dict:
    """A blind-rotated accumulator, both keys, their ids, and a matching switching key."""
    ring_key = rlwe_secret(seed, par, f"{label}:ring")
    target = target_secret(seed, par, f"{label}:target")
    source_id, target_id = key_id(seed, f"{label}:ring"), key_id(seed, f"{label}:target")
    return {
        "ringKey": ring_key,
        "target": target,
        "sourceId": source_id,
        "targetId": target_id,
        "accumulator": rotated_accumulator(seed, par, ring_key, label),
        "switchingKey": switching_key(
            seed, par, ring_key, target, source_id, target_id, label
        ),
    }


def _as_sample(value: object) -> dict:
    """Normalize a submission's `{"mask": ..., "body": ...}` into comparable types."""
    if not isinstance(value, dict) or "mask" not in value or "body" not in value:
        raise TypeError("not an LWE sample")
    return {"mask": tuple(int(x) for x in value["mask"]), "body": int(value["body"])}


def _out_of_range(par: dict, sample: dict) -> bool:
    """Whether any component sits outside `[0, q)`.

    A phase is computed modulo q, so an unreduced sample still decrypts correctly and every
    semantic check passes. It is still not a ciphertext: two representations of the same
    value that do not compare equal break every downstream artifact that hashes, stores or
    transmits one.
    """
    modulus = par["modulus"]
    return not all(0 <= value < modulus for value in (*sample["mask"], sample["body"]))


def _contains(structure: object, needle: tuple) -> bool:
    """Whether `needle` appears anywhere inside a nested structure, in either direction."""
    if isinstance(structure, (list, tuple)):
        as_tuple = tuple(structure)
        if as_tuple == needle or as_tuple == tuple(reversed(needle)):
            return True
        return any(_contains(item, needle) for item in structure)
    if isinstance(structure, dict):
        return any(_contains(item, needle) for item in structure.values())
    return False


# ---------------------------------------------------------------------------
# 1. The equation extraction has to preserve
# ---------------------------------------------------------------------------


def check_phase(module, seed: str) -> list[str]:
    failures: list[str] = []
    for par in _sets(seed):
        scene = _scene(seed, par, "phase")
        accumulator = scene["accumulator"]
        try:
            got = [
                module.phase_coefficient(par, scene["ringKey"], accumulator, index)
                for index in range(par["degree"])
            ]
        except Exception as error:  # noqa: BLE001
            return [f"computing a phase coefficient raised {type(error).__name__}"]
        want = [
            reference_phase_coefficient(par, scene["ringKey"], accumulator, index)
            for index in range(par["degree"])
        ]
        if got != want:
            if got == [value % par["modulus"] for value in reversed(want)]:
                failures.append("the phase coefficients are in reverse order")
            elif got[0] == want[0]:
                failures.append("the phase is right at index 0 and wrong elsewhere")
            else:
                failures.append("the phase coefficient is not b - a*s at that index")
            continue

        # A fresh ciphertext too, so nothing can depend on the accumulator's shape.
        fresh = rlwe_encrypt(
            par,
            scene["ringKey"],
            tuple((i + 1) % par["plaintext_modulus"] for i in range(par["degree"])),
            ring_random(seed, par, "phase:fresh"),
            ring_noise(seed, par, "phase:fresh"),
        )
        if [
            module.phase_coefficient(par, scene["ringKey"], fresh, index)
            for index in range(par["degree"])
        ] != [
            reference_phase_coefficient(par, scene["ringKey"], fresh, index)
            for index in range(par["degree"])
        ]:
            failures.append("the phase coefficient is wrong for a freshly encrypted ciphertext")
            continue

        # And the range is checked rather than assumed.
        for bad in (-1, par["degree"], par["degree"] + 1):
            try:
                module.phase_coefficient(par, scene["ringKey"], accumulator, bad)
            except Exception:  # noqa: BLE001 - any refusal counts
                continue
            failures.append("a coefficient index outside the ring was accepted")
            break
    return failures


# ---------------------------------------------------------------------------
# 2. Sample extraction
# ---------------------------------------------------------------------------


def check_extract(module, seed: str) -> list[str]:
    """Graded on the phase, at every index, under the ring secret read as a vector."""
    failures: list[str] = []
    for par in _sets(seed):
        scene = _scene(seed, par, "extract")
        accumulator, ring_key = scene["accumulator"], scene["ringKey"]
        wrong_indices = []
        for index in range(par["degree"]):
            try:
                got = _as_sample(module.extract_sample(par, accumulator, index))
            except Exception as error:  # noqa: BLE001
                return [f"extracting a sample raised {type(error).__name__}"]
            if len(got["mask"]) != par["degree"]:
                failures.append("the extracted mask is not one coefficient per ring-secret slot")
                return failures
            want = reference_phase_coefficient(par, ring_key, accumulator, index)
            if lwe_phase_of(par, ring_key, got) != want:
                wrong_indices.append(index)
        if wrong_indices:
            if wrong_indices == list(range(par["degree"] - 1)):
                # A slot wraps when its secret index is above the extracted one, so the
                # last coefficient is the only index where nothing wraps -- and the only
                # one a sign-blind extraction gets right.
                failures.append("extraction preserves the phase only at the last coefficient")
            elif all(
                lwe_phase_of(par, ring_key, _as_sample(module.extract_sample(par, accumulator, i)))
                == (2 * reference_phase_coefficient(par, ring_key, accumulator, i)
                    - _unsigned(par, ring_key, accumulator, i)) % par["modulus"]
                for i in wrong_indices
            ):
                failures.append("the wrapped mask coefficients are not negated")
            else:
                failures.append("the extracted phase is not the polynomial's coefficient")
            continue

        # The body is a coefficient of b, not something derived from it, and the whole
        # sample is reduced -- a phase is computed modulo q, so an unreduced mask decrypts
        # correctly and is still not a ciphertext.
        for index in range(par["degree"]):
            got = _as_sample(module.extract_sample(par, accumulator, index))
            if got["body"] != reference_extract(par, accumulator, index)["body"]:
                failures.append("the extracted body is not the matching coefficient of b")
                break
            if _out_of_range(par, got):
                failures.append("the extracted sample is not reduced into [0, q)")
                break

        for bad in (-1, par["degree"]):
            try:
                module.extract_sample(par, accumulator, bad)
            except Exception:  # noqa: BLE001 - any refusal counts
                continue
            failures.append("a coefficient index outside the ring was accepted")
            break
    return failures


def _unsigned(par: dict, ring_key, ciphertext: dict, index: int) -> int:
    """The phase an extraction that skipped the negacyclic sign would preserve.

    Only used to name the failure precisely: it is `b_k - <|c|, s>` where every wrapped
    coefficient kept its positive sign.
    """
    degree, q = par["degree"], par["modulus"]
    a = list(ciphertext["a"])[:degree] + [0] * (degree - len(list(ciphertext["a"])[:degree]))
    mask = tuple(a[index - j] if j <= index else a[index - j + degree] for j in range(degree))
    body = list(ciphertext["b"])[index]
    return (body - sum(m * s for m, s in zip(mask, ring_key))) % q


# ---------------------------------------------------------------------------
# 3. The extraction trace
# ---------------------------------------------------------------------------


def check_trace(module, seed: str) -> list[str]:
    failures: list[str] = []
    for par in _sets(seed):
        scene = _scene(seed, par, "trace")
        accumulator = scene["accumulator"]
        for index in (0, par["degree"] // 2, par["degree"] - 1):
            try:
                got = module.extract_trace(par, accumulator, index)
            except Exception as error:  # noqa: BLE001
                return [f"tracing an extraction raised {type(error).__name__}"]
            want = reference_trace(par, accumulator, index)
            if len(got) != len(want):
                failures.append("the trace does not have one record per extracted mask slot")
                return failures
            for mine, theirs in zip(got, want):
                for field in ("target", "source", "sign", "wrapped", "value"):
                    if mine.get(field) != theirs[field]:
                        failures.append(f"a trace record's {field} is wrong")
                        return failures

            # The trace is the computation, not a commentary on it.
            traced = tuple(record["value"] for record in got)
            if traced != _as_sample(module.extract_sample(par, accumulator, index))["mask"]:
                failures.append("the trace's values are not the mask it describes")
                return failures

            # And exactly one boundary, sitting at the index.
            boundary = [record["wrapped"] for record in got]
            if boundary != [slot > index for slot in range(par["degree"])]:
                failures.append("the wrap boundary is not at the extracted index")
                return failures
    return failures


# ---------------------------------------------------------------------------
# 4. The decomposition
# ---------------------------------------------------------------------------


def check_decompose(module, seed: str) -> list[str]:
    failures: list[str] = []
    for par in _sets(seed):
        scene = _scene(seed, par, "decompose")
        sample = reference_extract(par, scene["accumulator"], par["degree"] // 2)
        probes = [sample["mask"], tuple(range(par["degree"])), tuple([par["modulus"] - 1] * par["degree"])]
        try:
            got = [tuple(tuple(d) for d in module.decompose_mask(par, probe)) for probe in probes]
        except Exception as error:  # noqa: BLE001
            return [f"decomposing a mask raised {type(error).__name__}"]
        want = [reference_decompose_mask(par, probe) for probe in probes]
        if got != want:
            if got and want and got[0] == tuple(zip(*want[0])):
                failures.append("the coefficients and the levels are transposed")
            elif any(len(row) != par["levels"] for row in got[0]):
                failures.append("a coefficient's digits are not exactly `levels` of them")
            elif got[0] == tuple(tuple(reversed(row)) for row in want[0]):
                failures.append("the digits are least-significant first, not most")
            else:
                failures.append("a coefficient's digits are not its base-B digits")
            continue
        if any(not 0 <= digit < par["base"] for row in got[0] for digit in row):
            failures.append("a digit is outside [0, base)")
    return failures


# ---------------------------------------------------------------------------
# 5. Applying the switching key
# ---------------------------------------------------------------------------


def check_switch(module, seed: str) -> list[str]:
    """The message survives, under the target key, at every coefficient index."""
    failures: list[str] = []
    for par in _sets(seed):
        scene = _scene(seed, par, "switch")
        key, ring_key, target = scene["switchingKey"], scene["ringKey"], scene["target"]
        for index in range(par["degree"]):
            sample = dict(reference_extract(par, scene["accumulator"], index))
            sample["keyId"] = scene["sourceId"]
            try:
                got = _as_sample(module.key_switch(par, key, sample))
            except Exception as error:  # noqa: BLE001
                return [f"switching keys raised {type(error).__name__}"]
            if len(got["mask"]) != par["target_dimension"]:
                failures.append("the switched sample is not at the target dimension")
                return failures
            if _out_of_range(par, got):
                failures.append("the switched sample is not reduced into [0, q)")
                return failures
            want = lwe_decrypt(par, ring_key, sample)
            if lwe_decrypt(par, target, got) != want:
                if decode(par, lwe_phase_of(par, ring_key, sample)) == decode(
                    par, (-lwe_phase_of(par, target, got)) % par["modulus"]
                ):
                    failures.append("the switching-key entries are added rather than subtracted")
                else:
                    failures.append("the switched sample does not decrypt to the same message")
                return failures

            # Crossed: the submission's sample through the fixtures' switch. A digit order
            # that is reversed on both sides agrees with itself and fails here.
            own = dict(_as_sample(module.extract_sample(par, scene["accumulator"], index)))
            own["keyId"] = scene["sourceId"]
            crossed = reference_switch(par, key, own)
            if lwe_decrypt(par, target, crossed) != want:
                failures.append("the submitted sample does not work in the reference switch")
                return failures

        # A key that does not match has to be refused, not applied.
        other_ring = rlwe_secret(seed, par, "switch:other")
        mismatched = switching_key(
            seed, par, other_ring, target, key_id(seed, "switch:other"), scene["targetId"], "switch:other"
        )
        sample = dict(reference_extract(par, scene["accumulator"], 0))
        sample["keyId"] = scene["sourceId"]
        for bad in (mismatched, _shrunk(key)):
            try:
                module.key_switch(par, bad, sample)
            except Exception:  # noqa: BLE001 - any refusal counts
                continue
            failures.append("a switching key that does not match the sample was applied")
            break

        # The result names the key it now belongs to, and carries no secret out with it.
        # The next step in the pipeline reads that id to decide what it may be combined
        # with; a sample that names nothing is a sample nothing can check.
        switched = module.key_switch(par, key, sample)
        if switched.get("keyId") != scene["targetId"]:
            failures.append("the switched sample does not name the target key it now belongs to")
            return failures
        for secret in (ring_key, target):
            if _contains(switched, tuple(secret)):
                failures.append("the switched sample carries a raw secret in its representation")
                return failures
    return failures


def _shrunk(key: dict) -> dict:
    """The same key claiming a source dimension it does not have."""
    return {**key, "sourceDimension": key["sourceDimension"] - 1}


# ---------------------------------------------------------------------------
# 6. The key-domain audit
# ---------------------------------------------------------------------------


def check_domains(module, seed: str) -> list[str]:
    failures: list[str] = []
    for par in _sets(seed):
        scene = _scene(seed, par, "domains")
        key = scene["switchingKey"]
        sample = dict(reference_extract(par, scene["accumulator"], 0))
        sample["keyId"] = scene["sourceId"]

        other_ring = rlwe_secret(seed, par, "domains:other")
        mismatched = switching_key(
            seed, par, other_ring, scene["target"], key_id(seed, "domains:other"),
            scene["targetId"], "domains:other",
        )
        cases = [(sample, key), (sample, mismatched), (sample, _shrunk(key))]
        try:
            got = [module.domain_report(par, s, k) for s, k in cases]
        except Exception as error:  # noqa: BLE001
            return [f"reporting the key domains raised {type(error).__name__}"]
        want = [reference_report(par, s, k) for s, k in cases]

        for mine, theirs in zip(got, want):
            for field in (
                "sourceKeyId", "targetKeyId", "sourceDimension", "targetDimension",
                "modulus", "base", "levels", "compatible", "noiseAdded",
            ):
                if mine.get(field) != theirs[field]:
                    failures.append(f"the domain report's {field} is wrong")
                    return failures

        # The three cases have to actually separate, or the report proves nothing.
        if [report["compatible"] for report in got] != [True, False, False]:
            failures.append("the report does not distinguish a matching key from a mismatched one")
            continue

        # The source key is the *ring* key, not the target. Confusing the two is the
        # failure this checkpoint exists for, and it survives a report that only ever
        # copies fields across.
        if got[0]["sourceKeyId"] == got[0]["targetKeyId"]:
            failures.append("the source and target key ids are the same, so one was copied")
            continue
        if got[0]["sourceDimension"] == got[0]["targetDimension"]:
            failures.append("the source and target dimensions are the same, so one was copied")
            continue
        for secret in (scene["ringKey"], scene["target"]):
            if _contains(got[0], tuple(secret)):
                failures.append("the domain report carries a raw secret")
                return failures
    return failures


# ---------------------------------------------------------------------------
# 7. End to end
# ---------------------------------------------------------------------------


def check_endtoend(module, seed: str) -> list[str]:
    """The RLWE coefficient, the extracted sample and the switched sample all agree."""
    failures: list[str] = []
    for par in _sets(seed):
        scene = _scene(seed, par, "endtoend")
        ring_key, target, key = scene["ringKey"], scene["target"], scene["switchingKey"]
        moved = False
        for index in range(par["degree"]):
            try:
                sample = dict(_as_sample(module.extract_sample(par, scene["accumulator"], index)))
                sample["keyId"] = scene["sourceId"]
                switched = _as_sample(module.key_switch(par, key, sample))
            except Exception as error:  # noqa: BLE001
                return [f"the pipeline raised {type(error).__name__}"]
            in_ring = decode(
                par, module.phase_coefficient(par, ring_key, scene["accumulator"], index)
            )
            extracted = lwe_decrypt(par, ring_key, sample)
            switched_message = lwe_decrypt(par, target, switched)
            if not in_ring == extracted == switched_message:
                failures.append(
                    "the coefficient, the extracted sample and the switched sample disagree"
                )
                return failures
            # The switch has to have actually moved the ciphertext, not passed it through.
            moved = moved or (switched["mask"], switched["body"]) != (sample["mask"], sample["body"])
        if not moved:
            failures.append("the switch returned its input unchanged")
    return failures


# ---------------------------------------------------------------------------
# 8. Transfer
# ---------------------------------------------------------------------------


def check_transfer(module, seed: str) -> list[str]:
    """All of it, under a degree, dimension, base and modulus not seen elsewhere."""
    failures: list[str] = []
    for phase in (
        check_phase,
        check_extract,
        check_trace,
        check_decompose,
        check_switch,
        check_domains,
        check_endtoend,
    ):
        failures.extend(phase(module, seed))
    return failures


PHASES = (
    check_phase,
    check_extract,
    check_trace,
    check_decompose,
    check_switch,
    check_domains,
    check_endtoend,
)


def run(module, seed: str) -> list[str]:
    failures: list[str] = []
    for phase in PHASES:
        failures.extend(phase(module, seed))
    return failures
