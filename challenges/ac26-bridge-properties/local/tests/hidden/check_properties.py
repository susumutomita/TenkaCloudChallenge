"""Hidden tests. Run by /verify against a copy of the learner's files.

The rule this file enforces: a property label only counts when the learner can
demonstrate it. Marking P2 unsound is worth nothing without a witness that P2
actually accepts from outside the range, so every "False" in the matrix is
cross-checked against the corresponding counterexample.

Failure messages name the property, never the value.
"""

from __future__ import annotations

import sys
from pathlib import Path
from typing import Callable

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from fixtures.generate import (  # noqa: E402
    TRUTH,
    boundary_instance,
    in_range,
    instance,
    is_true_statement,
    protocol_for,
    protocol_ids,
    verify,
)

Classify = Callable[[str], "dict[str, bool]"]
Generator = Callable[..., int]


def check_matrix(classify: Classify, seed: str) -> list[str]:
    failures: list[str] = []
    for protocol_id in protocol_ids(seed):
        try:
            answer = classify(protocol_id)
        except Exception as error:  # noqa: BLE001
            failures.append(f"{protocol_id}: classify raised {type(error).__name__}")
            continue
        if not isinstance(answer, dict):
            failures.append(f"{protocol_id}: classify did not return a dict")
            continue
        for prop, expected in TRUTH[protocol_id].items():
            actual = answer.get(prop)
            if not isinstance(actual, bool):
                failures.append(f"{protocol_id}: '{prop}' is missing or not a boolean")
            elif actual != expected:
                failures.append(f"{protocol_id}: '{prop}' is classified wrongly")
    return failures


def check_incompleteness(generator: Generator, seed: str, label: str) -> list[str]:
    """The submitted witness must be genuinely valid AND rejected by P1."""
    inst = boundary_instance(seed, label)
    try:
        w = generator(inst.as_public())
    except Exception as error:  # noqa: BLE001
        return [f"incompleteness_witness raised {type(error).__name__}"]
    if not isinstance(w, int) or isinstance(w, bool):
        return ["incompleteness_witness did not return an integer"]
    failures: list[str] = []
    if not is_true_statement(inst, w):
        failures.append("the submitted witness is not valid for the statement")
    if verify(protocol_for(seed, "incomplete"), inst, w)[0]:
        failures.append("P1 accepts the submitted witness, so it shows no incompleteness")
    return failures


def check_unsoundness(generator: Generator, seed: str, label: str) -> list[str]:
    """The submitted witness must be outside the range AND accepted by P2."""
    inst = instance(seed, label)
    try:
        w = generator(inst.as_public())
    except Exception as error:  # noqa: BLE001
        return [f"unsoundness_witness raised {type(error).__name__}"]
    if not isinstance(w, int) or isinstance(w, bool):
        return ["unsoundness_witness did not return an integer"]
    failures: list[str] = []
    if in_range(inst, w):
        failures.append("the submitted witness is inside the claimed range, so nothing is broken")
    if not verify(protocol_for(seed, "unsound"), inst, w)[0]:
        failures.append("P2 rejects the submitted witness, so it shows no unsoundness")
    return failures


def check_extraction(extractor: Callable[[dict], int], seed: str, label: str) -> list[str]:
    """The extractor must recover the witness from the transcript alone."""
    inst = instance(seed, label)
    accepted, transcript = verify(protocol_for(seed, "leaky"), inst, inst.witness)
    if not accepted:
        return ["fixture error: P3 rejected its own honest witness"]
    try:
        recovered = extractor(transcript)
    except Exception as error:  # noqa: BLE001
        return [f"extract_witness raised {type(error).__name__}"]
    if not isinstance(recovered, int) or isinstance(recovered, bool):
        return ["extract_witness did not return an integer"]
    if recovered != inst.witness:
        return ["the recovered value is not the witness"]
    return []


def check_extraction_is_not_hardcoded(extractor: Callable[[dict], int], seed: str) -> list[str]:
    """Run the extractor over several transcripts; a constant cannot satisfy them all."""
    failures: list[str] = []
    for index in range(3):
        for message in check_extraction(extractor, seed, f"extract-{index}"):
            failures.append(f"instance {index}: {message}")
    return failures


def run(classify: Classify, module, seed: str) -> list[str]:
    """Full hidden suite. `module` supplies the three counterexample generators."""
    failures: list[str] = []
    failures.extend(check_matrix(classify, seed))
    for index in range(3):
        for message in check_incompleteness(module.incompleteness_witness, seed, f"inc-{index}"):
            failures.append(f"instance {index}: {message}")
        for message in check_unsoundness(module.unsoundness_witness, seed, f"uns-{index}"):
            failures.append(f"instance {index}: {message}")
    failures.extend(check_extraction_is_not_hardcoded(module.extract_witness, seed))
    return failures
