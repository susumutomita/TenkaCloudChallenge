"""Mirrors for ac26-bridge-properties.

`incompleteness` and `unsoundness` ask for a witness with a property rather than for a
computed value, so the mirror constructs the witness the fixtures make available:

  - P1 rejects `w == lo` (strict lower bound), and the boundary instance puts the honest
    witness exactly there, so `lo` is the valid-but-rejected witness.
  - P2 drops the range check, so any solution of the relation outside `[lo, hi]` is
    accepted. The relation has one solution per residue class, so `witness + p` works.
"""


def _unsoundness(server, seed):
    inst = server.instance(seed)
    return inst.witness + inst.p


EXPECTED = {
    "incompleteness": lambda server, seed: server.boundary_instance(seed).witness,
    "unsoundness": _unsoundness,
    "privacy-leak": lambda server, seed: server.instance(seed).witness,
    "property-matrix": lambda server, _seed: server.TRUTH,
}


def _public_fields(server, seed):
    inst = server.instance(seed)
    boundary = server.boundary_instance(seed)
    fields = {f"instance.{k}": v for k, v in inst.as_public().items()}
    fields.update({f"boundary.{k}": v for k, v in boundary.as_public().items()})
    # The P3 transcript is shown to the learner and carries the witness on purpose;
    # `privacy-leak` is the checkpoint about exactly that.
    fields["p3Transcript.opening"] = server.verify("p3", inst, inst.witness)[1]["opening"]["value"]
    return fields


VISIBLE = {name: _public_fields for name in ("incompleteness", "unsoundness", "privacy-leak")}


# The property matrix is nine booleans about the three verifiers. Nothing printed is a
# matrix, so there is no on-screen value it could be copied from; what makes it copyable
# is that it never varies, which the constant-answer probe already reports.
VISIBLE["property-matrix"] = lambda _server, _seed: {}
