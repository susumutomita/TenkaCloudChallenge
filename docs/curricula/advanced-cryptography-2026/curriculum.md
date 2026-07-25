# Curriculum map — Advanced Cryptography 2026 companion track

The source of truth for how TenkaCloud's `advanced-cryptography-2026` track maps
onto the Advanced Cryptography Program 2026: what each week teaches, what its
official exercise evaluates, what TenkaCloud adds around it, and in what order a
learner should meet it.

Reuse, attribution, and spoiler rules are in [`GOVERNANCE.md`](./GOVERNANCE.md).
This track is an **independent, unofficial** companion.

## Source snapshot

| Field | Value |
| --- | --- |
| Repository | `zk-tokyo/advanced-cryptography-2026` |
| Commit | `5e80999306608a45aecf9a0e4e3394a0b62f34d2` |
| Read on | 2026-07-25 |
| Visibility | Public |
| Licence | None found — see `GOVERNANCE.md` §1 |

Everything below marked "published" was read directly at that commit. Everything
marked "not published" was verified absent at that commit. Nothing is inferred
from the public roadmap alone.

### Week numbering

The repository directory names and the course's week numbers agree: `week1/`
through `week6/` are Weeks 1–6. There is no `week7/` directory; Demo Day exists
on the public roadmap but has no repository presence at this commit.

`week0/slide.pdf` exists at the repository root level. No week README references
it, and it is not part of the numbered sequence. This track treats it as
**out of scope**: TenkaCloud does not map it, open it, or derive from it.

### Publication state

| Week | Theme | Official exercise | State at pinned commit |
| --- | --- | --- | --- |
| 1 | Programmable Cryptography / arithmetic circuits | `proof-of-exploit` | Published |
| 2 | MPC | — | **Not published** — README says materials are in preparation; `problems/` holds only `.gitkeep` |
| 3 | Finite fields, elliptic curves, Sigma, Fiat–Shamir, Schnorr | `schnorr-from-scratch` | Published |
| 4 | ZKP / SNARK / STARK | — | **Not published** — same state as Week 2 |
| 5 | TFHE, Programmable Bootstrapping, HomNAND | `tfhe-toy-python` | Published |
| 6 | Programmable Cryptography Stack Design | `co-snark-prove`, `zkvm-exploit` | Published |
| 7 | Demo Day / capstone | — | **No `week7/` directory exists** |

The official exercises are Python, except `zkvm-exploit`, which is Rust.
Submissions go to `weekN/submissions/<github-username>/`; participants fork and
open a pull request.

## Alignment roles

Each companion challenge declares exactly one role, recorded in
`courseAlignment.role`.

| Role | Sits | Answers the question |
| --- | --- | --- |
| `diagnostic` | Before the lecture | Do I have the prerequisites to follow this week? |
| `mechanism` | Alongside the lecture | What is actually happening inside this construction? |
| `assignment-companion` | Beside the official exercise | Do I understand what the exercise is asking, without being told its answer? |
| `transfer` | After the exercise | Can I apply this where the setting has changed? |
| `synthesis` | End of a week or the track | Can I combine several weeks into one working thing? |

An `assignment-companion` is the most delicate role: it must build the
understanding the official exercise assumes **without** handing over what to
write in its blanks. `GOVERNANCE.md` §3 governs it.

Earlier drafts of the challenge issues used the ad-hoc labels `prerequisite`,
`surrounding-mechanism`, and `security-audit`. Those are not schema values. They
normalize to `mechanism`, `mechanism`, and `transfer` respectively, and the
normalized value is what appears in this table and in `metadata.json`.

## Concept registry

Concept ids are stable across editions and shared by every challenge's education
graph. `relations.type=requires` between concepts is the authority on learning
order; `track.order` only sequences presentation.

### Method and framing

| Concept id | Meaning |
| --- | --- |
| `concept.experimental-method` | Predict before running, then compare prediction to measurement |
| `concept.invariant` | A property that must hold at every step; the first step where it breaks locates the fault |
| `concept.correctness` | The construction produces the right answer on honest inputs |
| `concept.soundness` | A false statement cannot be made to pass |
| `concept.privacy` | The transcript reveals nothing beyond what is intended |

### Week 1 — circuits

| Concept id | Meaning |
| --- | --- |
| `concept.arithmetic-circuit` | Computation expressed as a set of constraints over a field |
| `concept.constraint-system` | The constraint collection a witness must satisfy |
| `concept.witness` | The value assigned to each signal |
| `concept.boolean-constraint` | `b(b−1)=0`, forcing a signal into `{0,1}` |
| `concept.membership-constraint` | Constraining a signal to a small allowed set |
| `concept.underconstraint` | A missing constraint that admits an invalid witness |

### Week 2 — MPC

| Concept id | Meaning |
| --- | --- |
| `concept.additive-secret-sharing` | Splitting a secret so any proper subset learns nothing |
| `concept.share-reconstruction` | Recombining shares, and the threshold at which it succeeds |
| `concept.local-linear-operation` | Linear operations on shares need no communication |
| `concept.beaver-triple` | Preprocessed randomness turning multiplication into one opening round |
| `concept.over-opening` | Revealing more than the protocol requires, leaking the secret |
| `concept.threat-model` | Actors, assets, trust boundaries, and what the adversary can do |

### Week 3 — fields, curves, signatures

| Concept id | Meaning |
| --- | --- |
| `concept.finite-field` | Arithmetic modulo a prime |
| `concept.modular-inverse` | Inversion via the extended Euclidean algorithm |
| `concept.elliptic-curve-group` | Curve points under the group law |
| `concept.double-and-add` | Scalar multiplication in logarithmic time |
| `concept.sigma-protocol` | The commit / challenge / response three-move shape |
| `concept.fiat-shamir` | Replacing the verifier's challenge with a hash |
| `concept.schnorr-signature` | The signature Fiat–Shamir produces from a Sigma protocol |
| `concept.special-soundness` | Two transcripts sharing a commitment extract the witness |
| `concept.nonce-reuse` | Reusing a nonce turns special soundness into key recovery |

### Week 4 — proof systems

| Concept id | Meaning |
| --- | --- |
| `concept.arithmetization` | Turning an execution trace into polynomial relations |
| `concept.polynomial-commitment` | Committing to a polynomial, opening it at a point |
| `concept.binding` | A commitment cannot later be opened to a different value |
| `concept.challenge-ordering` | Why the challenge must come after the commitment |
| `concept.proof-pipeline` | Trace → constraints → commitment → opening → verification |

### Week 5 — FHE

| Concept id | Meaning |
| --- | --- |
| `concept.plaintext-encoding` | Placing a message in the ciphertext's value space |
| `concept.noise-budget` | The error term, its growth, and the rounding boundary |
| `concept.lwe` | Learning With Errors |
| `concept.rlwe` | The polynomial-ring variant |
| `concept.gadget-decomposition` | Base-`B` decomposition that keeps products' noise small |
| `concept.rgsw` | The ciphertext type that multiplies into RLWE |
| `concept.external-product` | RGSW × RLWE → RLWE |
| `concept.cmux` | Encrypted selection between two ciphertexts |
| `concept.blind-rotation` | Rotating an encrypted polynomial by an encrypted amount |
| `concept.sample-extraction` | Extracting an LWE sample from an RLWE ciphertext |
| `concept.key-switching` | Moving a ciphertext between keys or domains |
| `concept.programmable-bootstrapping` | Noise reset that simultaneously evaluates a function |
| `concept.homomorphic-gate` | A boolean gate evaluated under encryption |

### Week 6 — stack design

| Concept id | Meaning |
| --- | --- |
| `concept.co-snark` | Proving over a secret-shared witness |
| `concept.zkvm` | Proving that a program ran, without revealing its inputs |
| `concept.guest-program` | The code that runs inside the zkVM |
| `concept.public-input-binding` | Tying public inputs and program identity to the proof |
| `concept.exploit-predicate` | The exact condition a proof of exploit asserts |
| `concept.stack-composition` | Where ZK, MPC, and FHE meet, and what breaks there |

### Week 7 — capstone design

| Concept id | Meaning |
| --- | --- |
| `concept.primitive-selection` | Deriving which primitive to use from the required properties, not the reverse |
| `concept.non-cryptographic-baseline` | The option that uses none, without which nothing shows what cryptography bought |
| `concept.security-property-matrix` | Each property tied to the asset, adversary, component, evidence, and limitation |
| `concept.design-assumption` | What must hold in the world for a primitive's guarantee to apply — and so, what to attack |
| `concept.reproducible-experiment` | Randomness taken explicitly, so the same inputs give the same observation — and so the space can be enumerated |
| `concept.adversarial-validation` | Turning a hypothesis about how it breaks into a test that runs, instead of exercising the happy path |
| `concept.public-evidence-bundle` | Each property mapped one-to-one onto the experiment that ran, its verdict, and its limitation |

### Misconceptions

Named so a challenge can target one deliberately and assert that it was corrected.

| Misconception id | The belief to break |
| --- | --- |
| `misconception.public-tests-are-complete` | Passing the visible tests means the solution is general |
| `misconception.constraint-is-an-if-statement` | A constraint executes like control flow |
| `misconception.witness-is-the-proof` | The witness and the proof are the same object |
| `misconception.boolean-name-implies-boolean-value` | Naming a signal `b` makes it boolean |
| `misconception.one-valid-example-proves-soundness` | One passing witness proves the circuit sound |
| `misconception.shares-are-encryption` | A single share is "encrypted" and safe to publish |
| `misconception.linear-ops-need-communication` | Every operation on shares costs a round |
| `misconception.noise-is-a-bug` | The error term is an implementation defect, not the security basis |
| `misconception.bootstrapping-is-only-noise-reset` | Bootstrapping cannot also compute |
| `misconception.zk-hides-everything` | A ZK proof hides the public inputs too |
| `misconception.start-with-a-primitive-then-find-a-problem` | Pick the tool first, then look for a problem it fits |
| `misconception.more-cryptography-is-safer` | Each primitive added makes the design safer, not merely larger |
| `misconception.fhe-removes-key-management` | Encrypting the computation removes the question of who holds the key |
| `misconception.mpc-removes-collusion-assumptions` | Multi-party computation removes the collusion assumption rather than relocating it |
| `misconception.design-document-needs-no-executable-check` | A design cannot be tested, only reviewed |
| `misconception.right-answer-means-right-protocol` | Producing the correct output means the protocol that produced it is correct |
| `misconception.privacy-can-be-asserted` | Privacy is a property of the design, not something a finite space lets you measure |
| `misconception.one-adversary-is-every-adversary` | Safety against one coalition is safety against all of them |
| `misconception.threshold-is-a-protocol-defect` | The coalition threshold is a hole in the protocol rather than a limit the output imposes |
| `misconception.working-demo-equals-secure-system` | A demo that runs is a system that holds; the happy path validates the threat model |

## Week-by-week mapping

`Order` is `track.order`. `Issue` is the TenkaCloudChallenge issue that owns the
implementation.

### Bridge 0 — experimental workflow

Not a course week. It exists so the first real cryptography challenge is not also
the learner's first encounter with the tooling.

| Order | Problem id | Role | Teaches | Issue |
| --- | --- | --- | --- | --- |
| 10 | `ac26-bridge-experiment` | `diagnostic` | `concept.experimental-method`, `concept.invariant` | #215 |
| 20 | `ac26-bridge-properties` | `diagnostic` | `concept.correctness`, `concept.soundness`, `concept.privacy` | #216 |

Prerequisite for: every `ac26-*` challenge.

### Week 1 — Programmable Cryptography

- **Source**: `week1/README.md`, `week1/problems/proof-of-exploit/README.md`
- **Official goals**: understand that a circuit is a set of constraints that must
  all evaluate to zero and that a witness assigns values to signals; understand
  why an under-constrained circuit is exploitable, from both the building and the
  attacking side.
- **Official exercise**: build an access-control circuit (Part A), then exploit a
  circuit with one constraint deliberately removed (Part B).
- **Prerequisites**: modular arithmetic, Python.
- **What the exercise does not force**: reading a *failing* witness. A learner can
  pass Part A without ever inspecting which constraint broke and why.

| Order | Problem id | Role | Teaches | Issue |
| --- | --- | --- | --- | --- |
| 110 | `ac26-w1-constraint-lab` | `mechanism` | `concept.constraint-system`, `concept.witness`, `concept.boolean-constraint`, `concept.membership-constraint` | #217 |
| 120 | `ac26-w1-underconstraint` | `assignment-companion` | `concept.underconstraint`, `concept.soundness` | #218 |

### Week 2 — MPC

- **Source**: `week2/README.md`
- **State**: not published. The README states materials are in preparation and
  lists no goals, exercise, or submission target.
- **Known only**: the theme is MPC — secure and collaborative computation.
- **Not decided**: official goals, exercise, evaluation.

Companion challenges are authored from the publicly stated theme alone and make
no claim about what the official exercise will require. Confirmation is tracked
by #219, with a 2026-09-30 review cutoff. Each pins `week2/README.md` with
`kind: "placeholder"`, so the day the material appears the drift check reports it
as a publication rather than an edit — see [`SYNC.md`](./SYNC.md) §2.

| Order | Problem id | Role | Teaches | Issue |
| --- | --- | --- | --- | --- |
| 210 | `ac26-w2-secret-sharing` | `mechanism` | `concept.additive-secret-sharing`, `concept.share-reconstruction` | #220 |
| 220 | `ac26-w2-linear-shares` | `mechanism` | `concept.local-linear-operation` | #221 |
| 230 | `ac26-w2-beaver-mul` | `mechanism` | `concept.beaver-triple` | #222 |
| 240 | `ac26-w2-privacy-audit` | `transfer` | `concept.over-opening`, `concept.privacy` | #223 |
| 250 | `ac26-w2-private-aggregate` | `synthesis` | combines the four above | #224 |

### Week 3 — elliptic curves and Schnorr

- **Source**: `week3/README.md`, `week3/problems/schnorr-from-scratch/README.md`
- **Official goals**: implement finite-field arithmetic, including inversion by
  the extended Euclidean algorithm; understand that curve points form a group and
  that scalar multiplication is fast via double-and-add; understand the Sigma
  protocol's three moves and how Fiat–Shamir turns an interactive proof into a
  signature; confirm from the attacker's side why nonce reuse leaks the key.
- **Official exercise**: one continuous fill-in-the-blanks build from field to
  curve to Schnorr, finishing on secp256k1.
- **What the exercise does not force**: seeing *why* the group law's case split
  exists, or recovering a key from two signatures rather than reasoning about it.

| Order | Problem id | Role | Teaches | Issue |
| --- | --- | --- | --- | --- |
| 310 | `ac26-w3-field-inverse` | `mechanism` | `concept.finite-field`, `concept.modular-inverse` | #225 |
| 320 | `ac26-w3-ec-group` | `mechanism` | `concept.elliptic-curve-group`, `concept.double-and-add` | #226 |
| 330 | `ac26-w3-schnorr` | `assignment-companion` | `concept.sigma-protocol`, `concept.fiat-shamir`, `concept.schnorr-signature` | #227 |
| 340 | `ac26-w3-nonce-reuse` | `transfer` | `concept.nonce-reuse`, `concept.special-soundness` | #228 |

### Week 4 — ZKP / SNARK / STARK

- **Source**: `week4/README.md`
- **State**: not published, identical in form to Week 2.
- **Known only**: the theme is ZKP, with SNARK and STARK in scope.

Confirmation is tracked by #229, with a 2026-09-30 review cutoff. As with Week 2,
each challenge pins `week4/README.md` as `kind: "placeholder"`.

| Order | Problem id | Role | Teaches | Issue |
| --- | --- | --- | --- | --- |
| 410 | `ac26-w4-arithmetization` | `transfer` | `concept.arithmetization`, `concept.execution-trace`, `concept.transition-constraint`, `concept.boundary-constraint`, `concept.evaluation-domain` | #230 |
| 420 | `ac26-w4-commit-open` | `transfer` | `concept.merkle-commitment`, `concept.commitment-binding`, `concept.challenge-ordering`, `concept.authentication-path` | #231 |
| 430 | `ac26-w4-proof-pipeline` | `transfer` | `concept.proof-pipeline-stage`, `concept.artifact-flow`, `concept.stage-contract`, `concept.trusted-setup`, `concept.transparent-setup`, `concept.succinctness` | #232 |

All three shipped as `transfer` rather than the `mechanism` this table originally
planned. GOVERNANCE.md §6 permits only `diagnostic` or `transfer` for a week whose
material is unpublished, and `transfer` is also what these three are: they carry Week 1's
constraints, Week 3's field, and Week 3's Fiat–Shamir into a new setting rather than
reconstructing a mechanism the course has taught. The role reverts to a claim about the
official material only when #229 confirms what Week 4 actually covers.

### Week 5 — TFHE

- **Source**: `week5/README.md`, `week5/week5_supplementary_reading.md`,
  `week5/problems/tfhe-toy-python/README.md`
- **Official goals**: implement toy TFHE, arriving at Programmable Bootstrapping
  and HomNAND.
- **Official exercise**: fill in `NotImplementedError` stubs in `solution.py`.
- **What the exercise does not force**: watching the noise budget move. A learner
  can complete the stubs while treating noise as an opaque constant, which is
  precisely the quantity the security and the correctness both rest on.

Week 5 has the longest internal dependency chain in the track; each step below is
a prerequisite for the next.

| Order | Problem id | Role | Teaches | Issue |
| --- | --- | --- | --- | --- |
| 510 | `ac26-w5-encoding-noise` | `mechanism` | `concept.plaintext-encoding`, `concept.noise-budget` | #233 |
| 520 | `ac26-w5-lwe-rlwe` | `mechanism` | `concept.lwe`, `concept.rlwe` | #234 |
| 530 | `ac26-w5-rgsw-external` | `mechanism` | `concept.gadget-decomposition`, `concept.rgsw`, `concept.external-product` | #235 |
| 540 | `ac26-w5-cmux-blind-rotation` | `mechanism` | `concept.cmux`, `concept.blind-rotation` | #236 |
| 550 | `ac26-w5-extract-key-switch` | `mechanism` | `concept.sample-extraction`, `concept.key-switching` | #237 |
| 560 | `ac26-w5-pbs-homnand` | `assignment-companion` | `concept.programmable-bootstrapping`, `concept.homomorphic-gate` | #238 |

### Week 6 — Programmable Cryptography Stack Design

- **Source**: `week6/README.md`, `week6/problems/co-snark-prove/README.md`,
  `week6/problems/zkvm-exploit/README.md`
- **Official goals**: with ZK and MPC assumed, build applications that combine
  them and computations that run inside or on top of a primitive.
- **Official exercises**: `co-snark-prove` — implement, in Python, the prover
  computation a co-SNARK runs on top of MPC (linear combination plus Beaver
  multiplication), with the secret-sharing primitives supplied. `zkvm-exploit` —
  implement, in Rust, the guest program and its public/witness design; the zkVM
  itself is not run.
- **Prerequisites**: Weeks 1–3, plus Week 2's Beaver multiplication. A learner who
  met MPC only through the unpublished Week 2 arrives here without it, which is
  why `ac26-w2-beaver-mul` is a hard prerequisite of `ac26-w6-cosnark-beaver`.
- **What the exercises do not force**: noticing that a prover which opens one
  value too many silently destroys the privacy the whole construction exists for.

| Order | Problem id | Role | Teaches | Issue |
| --- | --- | --- | --- | --- |
| 610 | `ac26-w6-cosnark-linear` | `mechanism` | `concept.co-snark`, `concept.local-linear-operation` | #239 |
| 620 | `ac26-w6-cosnark-beaver` | `assignment-companion` | `concept.beaver-triple`, `concept.co-snark` | #240 |
| 630 | `ac26-w6-cosnark-privacy` | `transfer` | `concept.over-opening`, `concept.privacy` | #241 |
| 640 | `ac26-w6-zkvm-exploit-predicate` | `mechanism` | `concept.zkvm`, `concept.guest-program`, `concept.exploit-predicate` | #242 |
| 650 | `ac26-w6-zkvm-public-witness-binding` | `assignment-companion` | `concept.public-input-binding` | #243 |
| 660 | `ac26-w6-stack-design` | `synthesis` | `concept.stack-composition` | #244 |

### Week 7 — Demo Day

- **Source**: none. No `week7/` directory exists at the pinned commit.
- **State**: Demo Day appears on the public roadmap. Deliverables, evaluation
  criteria, and publication scope are not published anywhere TenkaCloud can read.

The two capstone challenges are therefore authored against **TenkaCloud's own**
rubric, not the course's. They do not claim to prepare a course submission.
Confirmation is tracked by #245, with a 2026-09-30 review cutoff.

| Order | Problem id | Role | Teaches | Issue |
| --- | --- | --- | --- | --- |
| 710 | `ac26-w7-capstone-design` | `synthesis` | threat modelling, primitive selection | #246 |
| 720 | `ac26-w7-capstone-demo` | `synthesis` | implementation, adversarial review, reproducible demo | #247 |

## Evidence of understanding

A passing test is weak evidence: it is reachable by copying. Each challenge must
therefore evaluate at least two distinct kinds of evidence. The kinds are defined
in [`ASSESSMENT.md`](./ASSESSMENT.md), which also fixes the rule that any
`assignment-companion` challenge must include at least one `predict` or
`counterexample` checkpoint — the two kinds that a copied solution cannot satisfy.

## Maintenance

- Re-pin the source commit only through the drift review in `GOVERNANCE.md` §5,
  following the runbook in [`SYNC.md`](./SYNC.md).
- Adding a challenge means adding its row here in the same pull request. A
  challenge whose `courseAlignment.week` has no row is an unmapped challenge.
- Adding a concept id means adding it to the registry above. Ids are referenced
  by education-graph `nodes` across many problems and must not be renamed
  casually.
