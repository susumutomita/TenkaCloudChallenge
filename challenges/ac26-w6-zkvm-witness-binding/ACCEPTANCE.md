# Issue #716 — zkVM witness-binding acceptance

Scope: only `challenges/ac26-w6-zkvm-witness-binding`, 2026-09-08. No platform branches, shared runtime, scoring dispatch, deployment, or release changes.

## Participant-only first read and revision

The original public materials offered a target without defining the complete representation a learner had to implement:

- README incorrectly generalized that zkVM proofs do not identify their program. The task is application input/output binding around a proving system; the toy receipt has no seal.
- Encoding did not give the complete fixed-width, UTF-8 and double-framed `params` contract in a usable free reference.
- Body bytes versus external source/build labels, the private witness object, statement vocabulary/ranges and public/private `Env` methods were dispersed across an oversized starter.
- Completed instruction count, static body length, malformed receipt types, one-level disclosure inspection and the actual submit workflow were insufficiently explicit.
- Seven checkpoints had a single hint; `transfer` had none. The final checkpoint repeated independent tests without composing the participant's stages.

The free JA/EN guides now state role, symptom, first operation and success, define terms and all seven signatures, and provide encoding/arithmetic examples before the hints. The starter supplies real imports and concise function contracts. Each of eight checkpoints has mechanism → small example → actual file/control/feedback hints at 2 points each (24 hints, 48 points). Base points remain 300 and wrong submissions remain 15 points.

A separate root-agent participant-role read used `GUIDE.ja.md` without the hidden implementation. It found two remaining omissions: accepted `body` types and a constructible witness example. Both are now next to the free APIs: bytes/bytearray normalization, and quantity/aux/search including integer bounds and list/tuple search. This is repository/public-material review, not independent third-party playtesting.

## Consistency and grading corrections

### Public length versus private execution progress

Before this change, the privacy rule permitted only the decoded public program length while `seal_journal` and its checker published completed instructions. Checked arithmetic can stop at a private-quantity-dependent position. Identical public claims could therefore disclose different progress.

The internal `RUN_FIELDS` now distinguishes `steps` (completed instructions) and `programSteps` (decoded body length). Journal `measurements.steps` takes `programSteps`. Synchronized producers and consumers:

- Supplied `participant/lab.py` constants and starter/API contracts.
- Independent reference `run_guest` and hidden `_run`.
- Hidden misleading host reports and independent synthetic journal/receipt runs.
- Reference/hidden journal policy, public tests, final composed transfer and Inspect display.
- Existing fixture disclosure records already derived measurements from decoded body length and retain that source. Fixture `_machine` produces arithmetic witness data, not a `RUN_FIELDS` record. Public JSON contains no run record requiring migration.

Public and hidden regressions run the same checked statement with two different private quantities. Their completed counts differ, their public claim is False in both, and their complete journals must be identical. The resulting public journal must also pass the participant's own disclosure audit. Transfer additionally composes input → execution → journal → accept/reject → disclosure audit for wrapping, saturating and checked profiles under changed fixtures.

### Types and refusal behavior

- Nontext semantics/domain values are rejected as malformed statements, instead of raising lookup `TypeError`.
- Run decisions and receipt decisions must be actual booleans; integer/float/string truthiness is not accepted as the documented result type.
- Step measurements require integers, excluding bool, with the declared bounds and exact field set.
- Public numeric-name policies check type as well as numeric equality, so a float equal to an allowed integer does not silently pass.
- Invalid input ingestion must refuse before any public or private write.
- Identity accepts both bytes and bytearray with identical contents. A mutation rejecting the documented second representation is caught, protecting valid solutions.
- Body stamp identity is explicitly this model's byte-format rule, not a universal claim about real zkVM rebuilds.

Changed failure strings identify documented properties or types only. Runtime verification checked the 1900-character feedback bound; no hidden expected values were added.

## Executed evidence

- Native `python3 local/mutation.py`: reference passes all eight hidden phases; **66/66 mutations killed** (65 broken guests plus forged-verdict attack). Output: `/private/tmp/binding-mutation-results.txt`.
- Reference independently passed all eight phases for three additional fixture draws. This is author regression, not participant evidence.
- `python3 -m compileall -q local` and `git diff --check` passed.
- Catalog root `make install && make agent-gate`: **116 metadata files valid**. JA/EN guide-to-metadata equality, eight checkpoint identities, 24 hint pairs, 48 hint points and 300 base points were checked.
- Real `participant.server.Handler` and `verifier.server.Handler` ran as separate native Python HTTP servers bound only to local ports 18317/18361, with public evidence fetched over the same verifier/proxy path. They were stopped after verification.
- Through `/api/config`, `/api/inspect`, `/api/starter`, `/api/test`, `/api/prepare` and `/verify`: shipped starter imports; Inspect names the first edit; a free-contract-derived `encode_statement` implementation passes that public test and earns `encoding=true` while later functions remain unfinished. Script: `/private/tmp/w6-binding-workbench-smoke.py`.
- Through the same routes, the author reference passes **11 public tests and all 8 checkpoint submissions**. Public output: `/private/tmp/binding-workbench-public-output.txt`. Mutated private-progress publication, integer receipt decisions and bytearray refusal are rejected with documented-property feedback.

The first-edit script was written after author inspection of this repository. It demonstrates that the free contract is sufficient to implement the first operation and that the actual APIs accept it; it is not independent beginner-playability evidence. The root public-reader review supplies a separate reading check.

## Sources and assurance boundary

Read the actual course assignment at pinned commit `a3aa4b56fa88fbe803b57d320fbc87c1a203b480`, path `week6/problems/zkvm-exploit/README.md`, from the course checkout. Read the user's `advanced-cryptography-note/week6/index.html` guest/public-claim, initial-state and output-boundary discussion. The independently authored Python problem implements these application-boundary ideas; it does not copy the Rust assignment answer.

The public guide cites the primary [RISC Zero Receipt documentation](https://docs.rs/risc0-zkvm/latest/risc0_zkvm/struct.Receipt.html): verification uses the expected image ID and proven journal. This corrects the earlier claim that zkVM cannot identify the program.

Root additionally ran Docker `make reference-test`: participant and author images build, and all 66 mutations are rejected. Log: `/private/tmp/binding66-docker.log`.

Not run for this revision: rendered Portal/browser layout, Compose deployment, AWS deployment, live platform score-event persistence, or an independent third-party playtest. Native HTTP execution does not establish those claims. No real zkVM proof/seal is implemented; the one-level disclosure policy and removal of this progress field do not establish general zero knowledge or timing-channel safety.


## PR #836 independent scoring-boundary follow-up

A bounded review found that the old verifier trusted the child process's last JSON line as its verdict. A submission that printed a success-shaped record and exited early was accepted by both encoding and transfer. This was a pre-existing verifier defect. The prior single spoof mutation tested only an exit callback; “66 mutations rejected” did not establish rejection of an early process exit.

The problem now reuses the existing ac26-w2-private-aggregate bounded execution channel and Linux isolation policy. Hidden checks, fixture generation and the final verdict remain in the supervisor; learner code executes in a fresh restricted worker with only supplied public helpers and per-call inputs. Replies are untrusted typed function values, not verdicts. Fresh call IDs correlate replies; they do not attest execution. Env methods are callbacks on the actual parent Env so a child cannot replace writes, reads or transcript counters. The typed codec preserves bytes/bytearray, bool/int, list/tuple and Disclosure data without pickle or arbitrary-object deserialization. A ValueError subclass remains a valid refusal.

No platform code, shared runtime or other problem was modified. `runtimes/` has no existing Python execution family for this adapter. The existing transport/isolation source is reused locally; the Env and disclosure adapters are specific to this problem's contract. Broader sibling migration is tracked separately in Issue #837.

Executed after migration:

- Docker `make reference-test`: **65/65 logic mutations killed**, separately **3/3 grading boundary probes rejected**, and **12/12 execution-boundary tests passed**. Log: `/private/tmp/binding-boundary-reference-test.log`.
- The twelve boundary tests include the complete reference through all eight real verifier checkpoint paths, valid sequence and exception-subclass alternatives, forged/absent/preprinted verdicts across all checkpoints, early exit during a function, fake child-side Env counters, hidden-import and parent-vocabulary tampering, timeout recovery, the 1900-character failure-message limit, the typed-codec depth cap and the nonroot/time-budget deployment contract.
- `make agent-gate`: **116 metadata files valid**. Log: `/private/tmp/binding-boundary-catalog.log`.
- `python3 -m compileall -q local` and `git diff --check` passed.

- The migrated nonroot Linux author image ran real Workbench/verifier HTTP handlers with no host-published ports. Config/Inspect/starter/test/prepare/proxy preserve the first encoding-only success, 11 public test successes and all eight correct reference submissions; private-progress publication and forged verdicts are rejected. Script: `/private/tmp/binding-boundary-http.py`; log: `/private/tmp/binding-boundary-http.log`. Servers were terminated after the run. This is runtime-route evidence, not an independently derived solution or rendered browser playtest.
- Peer review confirmed the parent-observed Env boundary and found the previous 60-second evaluator budget exceeded the 15-second upstream timeout, and the container still used root without an init process. The evaluator now has a total 12-second budget, the image runs as UID 10001, both Compose services enable init, and author Docker runs use --init. Both issues were corrected before the final twelve-test/Docker HTTP runs.

The Linux-restricted verifier deliberately fails closed outside Linux. The earlier native Workbench smoke belongs to the pre-migration revision; current scoring-boundary evidence is the Docker and Linux HTTP routes above. No current browser, full Compose HTTP, AWS deployment or live score-event persistence claim is added by these tests. Isolation is defense in depth for the deployed container, not secrecy from a person controlling Docker or a claim that the toy receipt is a real cryptographic proof.
