"""Ground truth for the eight specimens: what each one reaches, opens, discloses and leaks.

This module does **not** ship in the participant image (see ../Dockerfile). The specimens
themselves do -- they are runnable objects the learner audits, and `participant/specimens.py`
is where they live. What is here is the table of answers about them.

Issue 537/538 (Issue 543 option B2): until that split the two halves were one file in the
single Docker stage a learner's own `make build` produced, so `GROUND_TRUTH` shipped in the
learner's own image. It names, per specimen, the capabilities reached beyond the protocol's
own, how many openings were unauthorized, the `(channel, name)` pairs disclosed, and which
secret an auditor can rebuild from the disclosure -- which is `capability`, `open-set`,
`leakage` and `evidence` written out as data, for exactly the eight provers the problem asks
about. `MALFORMED_TRUTH` is the same again for the error path the `capability` checkpoint
exists to make a learner probe.

The hidden checker imports these to decide whether a submitted answer is right. Nothing in
the participant image imports this module.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

# Re-exported so `tests/hidden/check_prover.py` and `mutation.py` keep importing the
# specimens and the ground truth about them from one place.
from participant.specimens import (  # noqa: E402,F401 - re-export, after the sys.path insert
    SPECIMENS,
    SPECIMEN_IDS,
    run_specimen,
    specimen,
)


#: Ground truth, for the hidden checker only. Never imported by a participant module.
#:
#:  capabilities   the capability names the specimen reaches beyond S1's
#:  unauthorized   how many of its openings are not the multiplication's own d and e
#:  disclosed      (channel, field name) pairs it puts in front of the participant that are
#:                 not on the allowlist, or are on it carrying the wrong kind of value
#:  recoverable    the secret an auditor can derive from the disclosure alone, if any
GROUND_TRUTH = {
    "S1": {"capabilities": (), "unauthorized": 0, "disclosed": (), "recoverable": None},
    "S2": {
        "capabilities": ("reconstruct",),
        "unauthorized": 0,
        "disclosed": (("metrics", "prover.left_half"),),
        "recoverable": "A",
    },
    "S3": {
        "capabilities": ("peek",),
        "unauthorized": 0,
        "disclosed": (("log", "x"),),
        "recoverable": "A",
    },
    "S4": {
        "capabilities": ("reconstruct",),
        "unauthorized": 0,
        "disclosed": (("artifact", "C"),),
        "recoverable": "C",
    },
    "S5": {"capabilities": (), "unauthorized": 1, "disclosed": (), "recoverable": None},
    "S6": {"capabilities": (), "unauthorized": 0, "disclosed": (), "recoverable": None},
    "S7": {"capabilities": ("peek",), "unauthorized": 0, "disclosed": (), "recoverable": None},
    "S8": {
        "capabilities": ("reconstruct",),
        "unauthorized": 0,
        "disclosed": (("log", "witness_digest"),),
        "recoverable": "B",
    },
}

#: The same four facts for the specimens that only misbehave when the input is malformed.
#: `GROUND_TRUTH` above is the honest path, so an audit that never probes the error path
#: reads S6 as spotless -- which it is, right up until it is not.
MALFORMED_TRUTH = {
    "S6": {
        "capabilities": ("peek",),
        "unauthorized": 0,
        "disclosed": (("error", "shares"),),
        "recoverable": "A",
    },
}

#: S6 is only defective on the error path, so the audit has to feed it one. A row whose
#: declared width disagrees with its coefficient vector is enough.
MALFORMED_SPECIMENS = tuple(MALFORMED_TRUTH)
