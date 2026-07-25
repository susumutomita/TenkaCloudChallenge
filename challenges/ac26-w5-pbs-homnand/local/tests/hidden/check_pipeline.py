"""Hidden tests. Run by /verify against a copy of the learner's pipeline.py.

Ground truth is `fixtures.generate`, never the submission. Three things follow from this
being a capstone rather than another mechanism problem.

**Stages are graded on their own artifacts, not on the final answer.** 21 of the 37
mutations in `mutation.py` produce a perfect truth table -- every unary function, both
messages, all four NAND rows, every parameter set -- and are broken pipelines anyway. A
final-answer test sees none of them. So every stage is checked where it sits, including the
labels it stamps and the account it gives of itself.

**The trace is checked by digest.** Digests of the intermediate artifacts cannot be filled
in from the final answer, so a trace that agrees is a trace whose stages actually ran.

**The truth table is run in full, every time.** `(1,1)` is the only NAND row that comes out
0, so an implementation that returns a constant 1 passes three rows out of four -- and three
rows out of four is what "I checked it works" usually means.

No function under test is handed a secret, at either end. Extraction, rotation, switching
and the gate all run on ciphertexts and public keys, so "decrypt the input and re-encrypt
the answer" is not an implementation this API can express. The suite still scans every
returned artifact for either secret, so a future author who threads one through finds out.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from fixtures.generate import (  # noqa: E402
    ROW_FIELDS,
    UNARY,
    VIABLE,
    blind_rotate as reference_rotate,
    blind_rotation_noise,
    bootstrap_key,
    cmux,
    correctness_bound,
    decode,
    encode,
    extract_sample,
    homomorphic_nand as reference_nand,
    key_id,
    key_switch_noise,
    lookup_accumulator as reference_accumulator,
    lwe_decrypt,
    lwe_digest,
    lwe_encrypt,
    lwe_phase,
    lwe_secret,
    nand_combine as reference_combine,
    output_noise_bound,
    parameter_set_id,
    params as parameters,
    pipeline_trace as reference_trace,
    refresh_report as reference_refresh,
    ring_secret,
    rlwe_digest,
    rlwe_phase,
    rotate_ciphertext,
    switching_key,
    to_rotation_domain as reference_domain,
)

LABELS = ("h0", "h1", "h2", "h3")

#: The artifact envelope every stage stamps. Two of these change mid-pipeline, which is why
#: they are graded rather than assumed.
ENVELOPE = ("kind", "keyId", "dimension", "modulus", "parameterSetId", "noiseBound")


def _sets(seed: str) -> list[dict]:
    """Parameter sets covering both bases and more than one ring degree."""
    drawn = [parameters(seed, label) for label in LABELS]
    for base in (2, 4):
        if not any(par["base"] == base for par in drawn):
            drawn.append(_forced(base))
    if not any(par["degree"] >= 32 for par in drawn):
        drawn.append(_forced(2, minimum_degree=32))
    return drawn


def _forced(base: int, minimum_degree: int = 0) -> dict:
    levels, degree, dimension = next(
        (l, d, n) for b, l, d, n in VIABLE if b == base and d >= minimum_degree
    )
    modulus = base**levels
    return {
        "base": base,
        "levels": levels,
        "degree": degree,
        "dimension": dimension,
        "modulus": modulus,
        "plaintext_modulus": 2,
        "delta": modulus // 8,
        "parameterSetId": parameter_set_id(base, levels, degree, dimension),
        "encodingId": "balanced-eighth",
    }


def _scene(seed: str, par: dict, label: str) -> dict:
    """Both secrets, both key ids, a bootstrapping key and a matching switching key."""
    ring_key = ring_secret(seed, par, f"{label}:ring")
    lwe_key = lwe_secret(seed, par, f"{label}:lwe")
    source_id, target_id = key_id(seed, f"{label}:ring"), key_id(seed, f"{label}:lwe")
    return {
        "ringKey": ring_key,
        "lweKey": lwe_key,
        "sourceId": source_id,
        "targetId": target_id,
        "bootstrapKey": bootstrap_key(seed, par, ring_key, lwe_key, f"{label}:bk"),
        "switchingKey": switching_key(
            seed, par, ring_key, lwe_key, source_id, target_id, f"{label}:ks"
        ),
    }


def _input(seed: str, par: dict, scene: dict, message: int, label: str, **kwargs) -> dict:
    """A fresh encryption of `message` under the scene's LWE key, named by its own id.

    Carries a non-zero `noiseBound`, so a stage that adds the two inputs' bounds and one
    that reports a constant zero do not agree. With fresh ciphertexts labelled `0` they
    would, and `nand_combine`'s noise accounting would be untested.
    """
    sample = lwe_encrypt(seed, par, scene["lweKey"], message, label, **kwargs)
    return {
        **sample,
        "keyId": scene["targetId"],
        "dimension": par["dimension"],
        "noiseBound": correctness_bound(par) // 4,
    }


def _accumulator(par: dict, scene: dict, table: dict) -> dict:
    """A fixture-built accumulator carrying the labels checkpoint 1 stamps on it.

    Built here rather than taken from the submission so every later stage is graded on its
    own work: a wrong lookup table fails `lut` once instead of failing everything after it.
    """
    return {
        **reference_accumulator(par, table),
        "kind": "rlwe",
        "keyId": scene["sourceId"],
        "dimension": par["degree"],
        "modulus": par["modulus"],
        "parameterSetId": par["parameterSetId"],
        "noiseBound": 0,
    }


def _hidden_table(seed: str, par: dict, index: int) -> dict:
    """A unary function the submission has not been told, drawn from the seed."""
    names = sorted(UNARY)
    chosen = names[(par["degree"] + par["levels"] + index + len(seed)) % len(names)]
    function = UNARY[chosen]
    return {0: function(0), 1: function(1)}


def _numbers(artifact: object, keys: tuple[str, ...]) -> tuple:
    if not isinstance(artifact, dict):
        raise TypeError("not an artifact")
    missing = [key for key in keys if key not in artifact]
    if missing:
        raise TypeError(f"the artifact has no {missing[0]}")
    return tuple(
        tuple(int(v) for v in artifact[key])
        if isinstance(artifact[key], (list, tuple))
        else int(artifact[key])
        for key in keys
    )


def _lwe(artifact: object) -> dict:
    values = _numbers(artifact, ("mask", "body"))
    return {"mask": values[0], "body": values[1]}


def _rlwe(artifact: object) -> dict:
    values = _numbers(artifact, ("a", "b"))
    return {"a": values[0], "b": values[1]}


def _envelope_failures(artifact: object, want: dict, where: str) -> list[str]:
    if not isinstance(artifact, dict):
        return [f"the {where} stage did not return an artifact"]
    return [
        f"the {where} artifact's {field} is wrong"
        for field in ENVELOPE
        if artifact.get(field) != want[field]
    ]


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


def _leaks(scene: dict, artifact: object) -> bool:
    return any(_contains(artifact, tuple(scene[name])) for name in ("ringKey", "lweKey"))


# ---------------------------------------------------------------------------
# 1. The lookup table, as an accumulator
# ---------------------------------------------------------------------------


def check_lut(module, seed: str) -> list[str]:
    """Every unary function, including the two constants, and the upper half's negation."""
    failures: list[str] = []
    for par in _sets(seed):
        scene = _scene(seed, par, "lut")
        degree = par["degree"]
        for name in sorted(UNARY):
            function = UNARY[name]
            table = {0: function(0), 1: function(1)}
            try:
                got = module.lookup_accumulator(par, table, scene["sourceId"])
            except Exception as error:  # noqa: BLE001
                return [f"building the accumulator raised {type(error).__name__}"]
            want = reference_accumulator(par, table)
            if _rlwe(got) != {"a": tuple(want["a"]), "b": tuple(want["b"])}:
                failures.append(_name_lut_failure(par, got, table))
                break

            failures.extend(
                _envelope_failures(
                    got,
                    {
                        "kind": "rlwe",
                        "keyId": scene["sourceId"],
                        "dimension": degree,
                        "modulus": par["modulus"],
                        "parameterSetId": par["parameterSetId"],
                        "noiseBound": 0,
                    },
                    "accumulator",
                )
            )
            if failures:
                break
        if failures:
            continue

        # Trivial: no mask and no noise. An accumulator built by encrypting the table would
        # decode the same and would carry a message and a key it has no business carrying.
        constant = module.lookup_accumulator(par, {0: 1, 1: 1}, scene["sourceId"])
        if any(_rlwe(constant)["a"]):
            failures.append("the accumulator has a mask, so it is not a trivial ciphertext")
            continue
        if _leaks(scene, constant):
            failures.append("the accumulator carries a raw secret")
    return failures


def _name_lut_failure(par: dict, got: object, table: dict) -> str:
    """Say which half is wrong, since the two halves fail for different reasons."""
    degree = par["degree"]
    try:
        coefficients = _rlwe(got)["b"]
    except (TypeError, KeyError):
        return "the accumulator is not a ring element"
    if len(coefficients) != degree:
        return "the accumulator does not have one coefficient per ring slot"
    lower = {coefficients[k] for k in range(degree // 2)}
    upper = {coefficients[k] for k in range(degree // 2, degree)}
    if lower != {encode(par, table[1])}:
        return "the lower half of the table is not f(1)"
    if upper == {encode(par, table[0])}:
        return "the upper half of the table is f(0) rather than 1 - f(0), so the wrap negates it"
    if upper != {encode(par, 1 - table[0])}:
        return "the upper half of the table is not 1 - f(0)"
    return "the accumulator's coefficients are not the lookup table"


# ---------------------------------------------------------------------------
# 2. The input, in rotation units
# ---------------------------------------------------------------------------


def check_domain(module, seed: str) -> list[str]:
    """Scaled to `Z_2N`, rounded rather than truncated, and still under the same key."""
    failures: list[str] = []
    for par in _sets(seed):
        scene = _scene(seed, par, "domain")
        for message in (0, 1):
            sample = _input(seed, par, scene, message, f"domain:{message}")
            try:
                got = module.to_rotation_domain(par, sample)
            except Exception as error:  # noqa: BLE001
                return [f"rescaling to the rotation domain raised {type(error).__name__}"]
            want = reference_domain(par, sample)
            if _lwe(got) != {"mask": tuple(want["mask"]), "body": want["body"]}:
                failures.append(_name_domain_failure(par, sample, got))
                break
            failures.extend(
                _envelope_failures(
                    got,
                    {
                        "kind": "lwe",
                        "keyId": scene["targetId"],
                        "dimension": par["dimension"],
                        "modulus": 2 * par["degree"],
                        "parameterSetId": par["parameterSetId"],
                        "noiseBound": (par["dimension"] + 1) // 2,
                    },
                    "rotation-domain",
                )
            )
            if failures:
                break
        if failures:
            continue

        # Every component lands in the ring of exponents, or the rotation is undefined.
        got = module.to_rotation_domain(par, _input(seed, par, scene, 1, "domain:range"))
        values = (*_lwe(got)["mask"], _lwe(got)["body"])
        if not all(0 <= value < 2 * par["degree"] for value in values):
            failures.append("a rescaled component is outside [0, 2N)")
    return failures


def _name_domain_failure(par: dict, sample: dict, got: object) -> str:
    """Truncation is the near-miss worth naming: right for most values, low by one for some."""
    modulus, q = 2 * par["degree"], par["modulus"]
    truncated = {
        "mask": tuple((value % q) * modulus // q % modulus for value in sample["mask"]),
        "body": (sample["body"] % q) * modulus // q % modulus,
    }
    try:
        mine = _lwe(got)
    except (TypeError, KeyError):
        return "the rescaled sample is not an LWE sample"
    if mine == truncated:
        return "the rescaling truncates instead of rounding to nearest"
    if len(mine["mask"]) != len(sample["mask"]):
        return "the rescaled mask does not have one component per input component"
    if mine["mask"] == tuple(sample["mask"]) and mine["body"] == sample["body"] % q:
        return "the sample was not rescaled at all"
    return "the rescaled sample is not the input scaled by 2N/q"


# ---------------------------------------------------------------------------
# 3. Blind rotation
# ---------------------------------------------------------------------------


def check_rotate(module, seed: str) -> list[str]:
    """Coefficient 0 of the rotated phase decodes to `f(m)`, and by the stated convention."""
    failures: list[str] = []
    for par in _sets(seed):
        scene = _scene(seed, par, "rotate")

        # Every case is run before anything is reported. A rotation that ignores the mask,
        # or reads every secret bit inverted, still lands on the right coefficient for some
        # inputs by luck -- reporting the first case that disagrees on the exact numbers
        # would name a convention violation when the defect is arithmetic.
        cases = []
        for name in sorted(UNARY):
            function = UNARY[name]
            accumulator = _accumulator(par, scene, {0: function(0), 1: function(1)})
            for message in (0, 1):
                sample = _input(seed, par, scene, message, f"rotate:{name}:{message}")
                rotated_input = reference_domain(par, sample)
                try:
                    got = module.blind_rotate(par, scene["bootstrapKey"], rotated_input, accumulator)
                except Exception as error:  # noqa: BLE001
                    return [f"blind rotation raised {type(error).__name__}"]
                try:
                    phase = rlwe_phase(par, scene["ringKey"], _rlwe(got))
                except (TypeError, KeyError):
                    return ["blind rotation did not return a ring ciphertext"]
                cases.append((accumulator, rotated_input, got, function, message, phase))

        wrong = [case for case in cases if decode(par, case[5][0]) != case[3](case[4])]
        if wrong:
            accumulator, rotated_input, got, function, message, _phase = wrong[0]
            failures.append(
                _name_rotate_failure(par, scene, rotated_input, accumulator, got, function, message)
            )
            continue

        # Only once every case is semantically right does the convention matter.
        for accumulator, rotated_input, got, _function, _message, _phase in cases:
            want = reference_rotate(par, scene["bootstrapKey"], rotated_input, accumulator)
            if _rlwe(got) != {"a": tuple(want["a"]), "b": tuple(want["b"])}:
                failures.append(
                    "the rotation lands on the right coefficient but is not the documented "
                    "loop: start at X^(-body), then CMUX over the mask in index order"
                )
                break
        if failures:
            continue

        failures.extend(
            _envelope_failures(
                module.blind_rotate(
                    par,
                    scene["bootstrapKey"],
                    reference_domain(par, _input(seed, par, scene, 1, "rotate:env")),
                    _accumulator(par, scene, {0: 0, 1: 1}),
                ),
                {
                    "kind": "rlwe",
                    "keyId": scene["sourceId"],
                    "dimension": par["degree"],
                    "modulus": par["modulus"],
                    "parameterSetId": par["parameterSetId"],
                    "noiseBound": blind_rotation_noise(par),
                },
                "blind-rotation",
            )
        )
    return failures


def _rotation_variants(par: dict, key, rotated: dict, accumulator: dict) -> dict:
    """The four rotation loops that are wrong in a namable way.

    Each is built here in full rather than inferred from the decoded bit, because the bit is
    binary: "not f(m)" is one value and carries no information about which mistake produced
    it. Comparing whole ciphertexts attributes the failure exactly, and says nothing at all
    when the submission is wrong in some fifth way -- which is the honest answer there.
    """

    def loop(start_sign: int, exponents, selector_first: bool) -> dict:
        current = rotate_ciphertext(par, accumulator, start_sign * rotated["body"])
        for index, mask in enumerate(exponents):
            turned = rotate_ciphertext(par, current, mask)
            current = (
                cmux(par, key[index], turned, current)
                if selector_first
                else cmux(par, key[index], current, turned)
            )
        return current

    return {
        "the accumulator is rotated by +phase rather than -phase": loop(
            1, rotated["mask"], False
        ),
        "the CMUX arguments are the wrong way round, so every secret bit is read inverted": loop(
            -1, rotated["mask"], True
        ),
        "one mask coefficient is left out of the rotation loop": loop(
            -1, tuple(rotated["mask"])[:-1], False
        ),
        "the mask is not used, so the rotation does not depend on the encrypted bit": loop(
            -1, tuple([0] * len(rotated["mask"])), False
        ),
    }


def _name_rotate_failure(
    par: dict, scene: dict, rotated_input: dict, accumulator: dict, got: object,
    function, message: int,
) -> str:
    """Attribute the failure to a specific wrong loop, or decline to guess."""
    mine = _rlwe(got)
    for name, variant in _rotation_variants(
        par, scene["bootstrapKey"], rotated_input, accumulator
    ).items():
        if mine == {"a": tuple(variant["a"]), "b": tuple(variant["b"])}:
            return name
    return (
        f"coefficient 0 of the rotated accumulator decodes to {decode(par, rlwe_phase(par, scene['ringKey'], mine)[0])}, "
        f"and f({message}) is {function(message)}"
    )


# ---------------------------------------------------------------------------
# 4. Sample extraction
# ---------------------------------------------------------------------------


def check_extract(module, seed: str) -> list[str]:
    """Coefficient 0, and the ring key domain it lands in."""
    failures: list[str] = []
    for par in _sets(seed):
        scene = _scene(seed, par, "extract")
        labelled = None
        for message in (0, 1):
            rotated, labelled = _rotated(seed, par, scene, message, f"extract:{message}")
            try:
                got = module.extract(par, labelled)
            except Exception as error:  # noqa: BLE001
                return [f"extraction raised {type(error).__name__}"]
            want = extract_sample(par, rotated, 0)
            if _lwe(got) != {"mask": tuple(want["mask"]), "body": want["body"]}:
                failures.append(_name_extract_failure(par, rotated, got))
                break

            # The phase is the coefficient, exactly. Extraction adds nothing.
            if lwe_phase(par, scene["ringKey"], _lwe(got)) != rlwe_phase(
                par, scene["ringKey"], rotated
            )[0]:
                failures.append("the extracted phase is not coefficient 0 of the rotated phase")
                break

            failures.extend(
                _envelope_failures(
                    got,
                    {
                        "kind": "lwe",
                        "keyId": scene["sourceId"],
                        "dimension": par["degree"],
                        "modulus": par["modulus"],
                        "parameterSetId": par["parameterSetId"],
                        "noiseBound": blind_rotation_noise(par),
                    },
                    "extraction",
                )
            )
            if failures:
                break
        if failures:
            continue
        if _leaks(scene, module.extract(par, labelled)):
            failures.append("the extracted sample carries a raw secret")
    return failures


def _rotated(seed: str, par: dict, scene: dict, message: int, label: str) -> tuple[dict, dict]:
    """A fixture-built blind-rotation output, bare and with the labels stage 3 stamps.

    The bare one is what `extract_sample` is measured against; the labelled one is what the
    submission is handed, since `extract` reads its input's domain to know what to relabel.
    """
    sample = _input(seed, par, scene, message, label)
    rotated = reference_rotate(
        par, scene["bootstrapKey"], reference_domain(par, sample),
        _accumulator(par, scene, {0: 0, 1: 1}),
    )
    return rotated, {
        **rotated,
        "kind": "rlwe",
        "keyId": scene["sourceId"],
        "dimension": par["degree"],
        "modulus": par["modulus"],
        "parameterSetId": par["parameterSetId"],
        "noiseBound": blind_rotation_noise(par),
    }


def _name_extract_failure(par: dict, rotated: dict, got: object) -> str:
    try:
        mine = _lwe(got)
    except (TypeError, KeyError):
        return "extraction did not return an LWE sample"
    if len(mine["mask"]) != par["degree"]:
        return "the extracted mask is not one coefficient per ring-secret slot"
    for index in range(1, par["degree"]):
        other = extract_sample(par, rotated, index)
        if mine == {"mask": tuple(other["mask"]), "body": other["body"]}:
            return f"coefficient {index} was extracted rather than coefficient 0"
    return "the extracted sample is not coefficient 0 of the rotated accumulator"


# ---------------------------------------------------------------------------
# 5. Key switching
# ---------------------------------------------------------------------------


def check_switch(module, seed: str) -> list[str]:
    """Back to the input's own key and dimension, and a mismatched key refused."""
    failures: list[str] = []
    for par in _sets(seed):
        scene = _scene(seed, par, "switch")
        key = scene["switchingKey"]
        for message in (0, 1):
            extracted = _extracted(seed, par, scene, message, f"switch:{message}")
            try:
                got = module.switch(par, key, extracted)
            except Exception as error:  # noqa: BLE001
                return [f"key switching raised {type(error).__name__}"]
            before = decode(par, lwe_phase(par, scene["ringKey"], _lwe(extracted)))
            if lwe_decrypt(par, scene["lweKey"], _lwe(got)) != before:
                failures.append("the switched sample does not decrypt to the same message")
                break
            failures.extend(
                _envelope_failures(
                    got,
                    {
                        "kind": "lwe",
                        "keyId": scene["targetId"],
                        "dimension": par["dimension"],
                        "modulus": par["modulus"],
                        "parameterSetId": par["parameterSetId"],
                        "noiseBound": extracted["noiseBound"] + key_switch_noise(par),
                    },
                    "key-switch",
                )
            )
            if failures:
                break
        if failures:
            continue

        # The target is the key the input arrived under. That is what makes the output
        # feedable back in, and a pipeline that landed anywhere else is correct once.
        if module.switch(par, key, _extracted(seed, par, scene, 1, "switch:id"))["keyId"] != (
            _input(seed, par, scene, 1, "switch:id")["keyId"]
        ):
            failures.append("the switched sample does not land on the key the input came under")
            continue

        # A key that does not match is refused, not applied: applying it produces a
        # well-formed ciphertext that decrypts to noise under both keys.
        other_ring = ring_secret(seed, par, "switch:other")
        mismatched = switching_key(
            seed, par, other_ring, scene["lweKey"], key_id(seed, "switch:other"),
            scene["targetId"], "switch:other",
        )
        extracted = _extracted(seed, par, scene, 1, "switch:bad")
        for bad in (mismatched, {**key, "sourceDimension": key["sourceDimension"] - 1}):
            try:
                module.switch(par, bad, extracted)
            except Exception:  # noqa: BLE001 - any refusal counts
                continue
            failures.append("a switching key that does not match the sample was applied")
            break
        if _leaks(scene, module.switch(par, key, extracted)):
            failures.append("the switched sample carries a raw secret")
    return failures


def _extracted(seed: str, par: dict, scene: dict, message: int, label: str) -> dict:
    """A real extraction output, built by the fixtures so `switch` is graded on its own."""
    sample = _input(seed, par, scene, message, label)
    rotated = reference_rotate(
        par, scene["bootstrapKey"], reference_domain(par, sample),
        _accumulator(par, scene, {0: 0, 1: 1}),
    )
    extracted = extract_sample(par, rotated, 0)
    return {
        **extracted,
        "kind": "lwe",
        "keyId": scene["sourceId"],
        "dimension": par["degree"],
        "modulus": par["modulus"],
        "parameterSetId": par["parameterSetId"],
        "noiseBound": blind_rotation_noise(par),
    }


# ---------------------------------------------------------------------------
# 6. Programmable function evaluation
# ---------------------------------------------------------------------------


def check_evaluate(module, seed: str) -> list[str]:
    """`Dec(bootstrap(Enc(m), f)) = f(m)`, for every unary `f`, and again on the output."""
    failures: list[str] = []
    for index, par in enumerate(_sets(seed)):
        scene = _scene(seed, par, "evaluate")
        key, switch_key = scene["bootstrapKey"], scene["switchingKey"]
        for name in sorted(UNARY):
            function = UNARY[name]
            table = {0: function(0), 1: function(1)}
            for message in (0, 1):
                sample = _input(seed, par, scene, message, f"evaluate:{name}:{message}")
                try:
                    got = module.bootstrap(par, key, switch_key, sample, table)
                except Exception as error:  # noqa: BLE001
                    return [f"the pipeline raised {type(error).__name__}"]
                if lwe_decrypt(par, scene["lweKey"], _lwe(got)) != function(message):
                    failures.append(f"bootstrapping f = {name} on m = {message} gave the wrong bit")
                    break
            if failures:
                break
        if failures:
            continue

        # A hidden table, so nothing can be special-cased by name.
        table = _hidden_table(seed, par, index)
        for message in (0, 1):
            sample = _input(seed, par, scene, message, f"evaluate:hidden:{message}")
            if lwe_decrypt(
                par, scene["lweKey"], _lwe(module.bootstrap(par, key, switch_key, sample, table))
            ) != table[message]:
                failures.append("a lookup table it had not seen came out wrong")
                break
        if failures:
            continue

        # The output is the same kind of thing as the input, so it goes back in. This is the
        # difference between bootstrapping and a one-way evaluation, and it is why the
        # output key has to be the input key.
        first = module.bootstrap(
            par, key, switch_key, _input(seed, par, scene, 1, "evaluate:compose"), {0: 1, 1: 0}
        )
        second = module.bootstrap(par, key, switch_key, first, {0: 1, 1: 0})
        if lwe_decrypt(par, scene["lweKey"], _lwe(second)) != 1:
            failures.append("bootstrapping the output of a bootstrap gave the wrong bit")
            continue

        # Ciphertexts differ across randomness; the decoded function value does not.
        decoded = set()
        artifacts = set()
        for trial in range(3):
            sample = _input(seed, par, scene, 1, f"evaluate:fresh:{trial}")
            out = module.bootstrap(par, key, switch_key, sample, {0: 0, 1: 1})
            decoded.add(lwe_decrypt(par, scene["lweKey"], _lwe(out)))
            artifacts.add(lwe_digest(_lwe(out)))
        if decoded != {1}:
            failures.append("the same message under fresh randomness did not evaluate the same")
        elif len(artifacts) == 1:
            failures.append("every fresh encryption produced the identical output ciphertext")
        if _leaks(scene, first):
            failures.append("the bootstrapped ciphertext carries a raw secret")
    return failures


# ---------------------------------------------------------------------------
# 7. The trace, and the refresh it makes visible
# ---------------------------------------------------------------------------


def check_refresh(module, seed: str) -> list[str]:
    """Six rows that name real artifacts, and a bound that does not mention the input."""
    failures: list[str] = []
    for par in _sets(seed):
        scene = _scene(seed, par, "refresh")
        key, switch_key = scene["bootstrapKey"], scene["switchingKey"]
        sample = _input(seed, par, scene, 1, "refresh:trace")
        table = {0: 1, 1: 0}
        try:
            got = module.pipeline_trace(par, key, switch_key, sample, table)
        except Exception as error:  # noqa: BLE001
            return [f"tracing the pipeline raised {type(error).__name__}"]
        want = reference_trace(par, key, switch_key, sample, table)
        if len(got) != len(want):
            failures.append("the trace does not have one record per pipeline stage")
            continue
        named = _first_row_mismatch(got, want)
        if named:
            failures.append(named)
            continue

        # The digests are the part that cannot be filled in from the final answer.
        accumulator = reference_accumulator(par, table)
        if got[2]["digest"] != rlwe_digest(par, accumulator):
            failures.append("the accumulator row does not name the accumulator that was built")
            continue

        # The refresh, stated as a measurement rather than as a claim: vary the input's
        # noise and every row from the rotation on is unmoved.
        noisy = _input(seed, par, scene, 1, "refresh:noisy", error=correctness_bound(par) // 2)
        after = module.pipeline_trace(par, key, switch_key, noisy, table)
        if [row["noiseBound"] for row in after[3:]] != [row["noiseBound"] for row in got[3:]]:
            failures.append("a post-rotation noise bound changed when the input's noise did")
            continue
        if after[3]["digest"] == got[3]["digest"]:
            failures.append("the rotation produced the same artifact for a different input")
            continue

        failures.extend(_refresh_report_failures(module, par))
        if any(_leaks(scene, row) for row in got):
            failures.append("a trace record carries a raw secret")
    return failures


def _first_row_mismatch(got, want) -> str:
    for mine, theirs in zip(got, want):
        if not isinstance(mine, dict):
            return "a trace record is not a record"
        for field in ROW_FIELDS:
            if mine.get(field) != theirs[field]:
                return f"the {theirs['stage']} record's {field} is wrong"
    return ""


def _refresh_report_failures(module, par: dict) -> list[str]:
    """The bound is a constant of the parameter set, and the contract has an edge."""
    bound = correctness_bound(par)
    probes = (0, 1, bound // 2, bound, bound + 1, 2 * bound)
    try:
        reports = [module.refresh_report(par, noise) for noise in probes]
    except Exception as error:  # noqa: BLE001
        return [f"reporting the refresh raised {type(error).__name__}"]
    expected = [reference_refresh(par, noise) for noise in probes]
    for mine, theirs in zip(reports, expected):
        if not isinstance(mine, dict):
            return ["the refresh report is not a report"]
        for field in theirs:
            if mine.get(field) != theirs[field]:
                return [f"the refresh report's {field} is wrong"]
    if len({report["outputNoiseBound"] for report in reports}) != 1:
        return ["the output noise bound varies with the input's, so nothing was refreshed"]
    if [report["withinContract"] for report in reports] != [
        True, True, True, True, False, False
    ]:
        return ["the correctness contract does not have an edge at the bound"]
    if reports[0]["outputNoiseBound"] != output_noise_bound(par):
        return ["the output noise bound is not blind rotation's plus the key switch's"]
    return []


# ---------------------------------------------------------------------------
# 8. NAND, before the bootstrap
# ---------------------------------------------------------------------------


def check_combine(module, seed: str) -> list[str]:
    """One linear combination whose sign is the gate, including the offset that separates it."""
    failures: list[str] = []
    for par in _sets(seed):
        scene = _scene(seed, par, "combine")
        signs = {}
        for left_bit in (0, 1):
            for right_bit in (0, 1):
                left = _input(seed, par, scene, left_bit, f"combine:{left_bit}{right_bit}:l")
                right = _input(seed, par, scene, right_bit, f"combine:{left_bit}{right_bit}:r")
                try:
                    got = module.nand_combine(par, left, right)
                except Exception as error:  # noqa: BLE001
                    return [f"combining the two bits raised {type(error).__name__}"]
                want = reference_combine(par, left, right)
                if _lwe(got) != {"mask": tuple(want["mask"]), "body": want["body"]}:
                    failures.append(_name_combine_failure(par, scene, left, right, got))
                    break
                phase = lwe_phase(par, scene["lweKey"], _lwe(got))
                signs[(left_bit, right_bit)] = decode(par, phase)
                failures.extend(
                    _envelope_failures(
                        got,
                        {
                            "kind": "lwe",
                            "keyId": scene["targetId"],
                            "dimension": par["dimension"],
                            "modulus": par["modulus"],
                            "parameterSetId": par["parameterSetId"],
                            "noiseBound": left.get("noiseBound", 0) + right.get("noiseBound", 0),
                        },
                        "nand-combine",
                    )
                )
                if failures:
                    break
            if failures:
                break
        if failures:
            continue
        if signs != {(0, 0): 1, (0, 1): 1, (1, 0): 1, (1, 1): 0}:
            failures.append("the combined phase is not positive exactly when NAND is 1")
            continue

        # Two bits under different keys do not add up to anything.
        other = _scene(seed, par, "combine:other")
        left = _input(seed, par, scene, 1, "combine:mixed:l")
        right = _input(seed, par, other, 1, "combine:mixed:r")
        try:
            module.nand_combine(par, left, right)
        except Exception:  # noqa: BLE001 - any refusal counts
            continue
        failures.append("two bits under different keys were combined")
    return failures


def _name_combine_failure(par: dict, scene: dict, left: dict, right: dict, got: object) -> str:
    """The dropped offset is the one worth naming: it fails two rows out of four, at random."""
    try:
        mine = _lwe(got)
    except (TypeError, KeyError):
        return "the combination did not return an LWE sample"
    modulus = par["modulus"]
    without_offset = {
        "mask": tuple((-x - y) % modulus for x, y in zip(left["mask"], right["mask"])),
        "body": (-left["body"] - right["body"]) % modulus,
    }
    if mine == without_offset:
        return "the q/8 offset is missing, so (0,1) and (1,0) sit on the decision boundary"
    summed = {
        "mask": tuple((x + y) % modulus for x, y in zip(left["mask"], right["mask"])),
        "body": (par["delta"] + left["body"] + right["body"]) % modulus,
    }
    if mine == summed:
        return "the two bits are added rather than subtracted"
    phase = lwe_phase(par, scene["lweKey"], mine)
    if phase == (par["delta"] - lwe_phase(par, scene["lweKey"], left)) % modulus:
        return "only one of the two bits is in the combination"
    return "the combination is not (0, q/8) - left - right"


# ---------------------------------------------------------------------------
# 9. HomNAND
# ---------------------------------------------------------------------------


def check_nand(module, seed: str) -> list[str]:
    """All four rows, every parameter set, and the output usable as an input again."""
    failures: list[str] = []
    for par in _sets(seed):
        scene = _scene(seed, par, "nand")
        key, switch_key = scene["bootstrapKey"], scene["switchingKey"]
        table = {}
        for left_bit in (0, 1):
            for right_bit in (0, 1):
                left = _input(seed, par, scene, left_bit, f"nand:{left_bit}{right_bit}:l")
                right = _input(seed, par, scene, right_bit, f"nand:{left_bit}{right_bit}:r")
                try:
                    got = module.homomorphic_nand(par, key, switch_key, left, right)
                except Exception as error:  # noqa: BLE001
                    return [f"the NAND gate raised {type(error).__name__}"]
                table[(left_bit, right_bit)] = lwe_decrypt(par, scene["lweKey"], _lwe(got))
                want = reference_nand(par, key, switch_key, left, right)
                if _lwe(got) != {"mask": tuple(want["mask"]), "body": want["body"]}:
                    failures.append("the gate's output is not one bootstrap of the combination")
                    break
            if failures:
                break
        if failures:
            continue
        if table != {(0, 0): 1, (0, 1): 1, (1, 0): 1, (1, 1): 0}:
            wrong = sorted(k for k, v in table.items() if v != 1 - (k[0] & k[1]))
            failures.append(f"the NAND truth table is wrong at {wrong}")
            continue

        failures.extend(
            _envelope_failures(
                module.homomorphic_nand(
                    par, key, switch_key,
                    _input(seed, par, scene, 1, "nand:env:l"),
                    _input(seed, par, scene, 0, "nand:env:r"),
                ),
                {
                    "kind": "lwe",
                    "keyId": scene["targetId"],
                    "dimension": par["dimension"],
                    "modulus": par["modulus"],
                    "parameterSetId": par["parameterSetId"],
                    "noiseBound": output_noise_bound(par),
                },
                "homnand",
            )
        )
        if failures:
            continue

        # NAND over two already-bootstrapped bits. Every gate after the first one in any
        # real circuit is this case, and it is the one that needs the refresh to have worked.
        fresh = {
            bit: module.bootstrap(
                par, key, switch_key, _input(seed, par, scene, bit, f"nand:pre:{bit}"), {0: 0, 1: 1}
            )
            for bit in (0, 1)
        }
        composed = {
            (left_bit, right_bit): lwe_decrypt(
                par,
                scene["lweKey"],
                _lwe(module.homomorphic_nand(par, key, switch_key, fresh[left_bit], fresh[right_bit])),
            )
            for left_bit in (0, 1)
            for right_bit in (0, 1)
        }
        if composed != {(0, 0): 1, (0, 1): 1, (1, 0): 1, (1, 1): 0}:
            failures.append("NAND over two already-bootstrapped bits is wrong")
    return failures


# ---------------------------------------------------------------------------
# 10. Transfer
# ---------------------------------------------------------------------------


def check_transfer(module, seed: str) -> list[str]:
    """All of it, under parameters, keys, tables and inputs no other checkpoint used."""
    failures: list[str] = []
    for phase in PHASES:
        failures.extend(phase(module, seed))
    return failures


def _guard(check):
    """A checkpoint whose submission returns nonsense fails; it does not crash the verifier.

    The starter returns `{}` from every function, so this path is taken by the very first
    thing anyone runs. Without it the child process dies and the failure arrives as a
    non-zero exit code with nothing to read.
    """

    def wrapped(module, seed: str) -> list[str]:
        try:
            return check(module, seed)
        except (AttributeError, IndexError, KeyError, TypeError, ValueError, ZeroDivisionError) as error:
            stage = check.__name__.removeprefix("check_")
            return [f"{stage} did not return a usable artifact ({type(error).__name__}: {error})"]

    wrapped.__name__ = check.__name__
    wrapped.__doc__ = check.__doc__
    return wrapped


#: Guarded, and rebound over the bare definitions so `/verify` reaches these by name too.
PHASES = tuple(
    _guard(check)
    for check in (
        check_lut,
        check_domain,
        check_rotate,
        check_extract,
        check_switch,
        check_evaluate,
        check_refresh,
        check_combine,
        check_nand,
    )
)
(
    check_lut,
    check_domain,
    check_rotate,
    check_extract,
    check_switch,
    check_evaluate,
    check_refresh,
    check_combine,
    check_nand,
) = PHASES


def run(module, seed: str) -> list[str]:
    failures: list[str] = []
    for phase in PHASES:
        failures.extend(phase(module, seed))
    return failures
