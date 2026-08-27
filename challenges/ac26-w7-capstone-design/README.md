# Do not start from the tool

> This track is an independent, unofficial companion to the Advanced Cryptography Program 2026.
> It is not affiliated with or endorsed by the course or its operators. All problem statements,
> code, fixtures, and figures here are written independently. Questions about this track go to
> the TenkaCloud repository, not to the course operators.

**Track:** `advanced-cryptography-2026` · **Order:** 710 · **Chapter:** Week 7 / Capstone Design
· **Role:** `synthesis` · **Time:** 120–180 minutes · **Points:** 300

## The story

You are handed a brief. It names the actors, the assets, who may know what and who may not, who
acts on a value they did not compute, and what the deadline rules are.

It names no primitive. Not one.

That is the exercise. Begin a design at "should this be ZK or MPC" and you will get an answer;
whether the answer fits the problem is a separate question, usually asked too late.

## Participant Portal workflow

1. Start the problem in Participant Portal; the problem editor appears on the same page.
2. Select **Inspect evidence** to read this deployment's fixture and published evidence.
3. Edit the starter source in the Portal editor.
4. Select **Run public tests** and fill any direct-answer fields from the evidence.
5. Submit each checkpoint directly. Portal prepares and sends the current files and answers.

No checkout, terminal, local editor, second screen, or copy-and-paste step is required. Code
checkpoints use the current editor source. Direct answers are bound to the current deployment
seed, so a value copied from another deployment is rejected.

## Scoring

Eight checkpoints, scored independently. Wrong answers cost 15 points each.

| Checkpoint | Points | What is checked |
|---|---:|---|
| `assets` | 30 | Every asset classified, with its owner; nothing secret labelled public |
| `requirements` | 45 | Exactly the properties the brief asks for — no more |
| `alternatives` | 30 | Every option compared honestly, including the non-cryptographic one |
| `selection` | 50 | Sufficient, admissible, minimal — and free of cryptography when it can be |
| `architecture` | 45 | Every asset in the flow; nothing secret arriving in the clear |
| `attacks` | 35 | Every required property attacked, each with something observable |
| `matrix` | 35 | Each property carried by a component that actually provides it |
| `revision` | 30 | The same four artifacts, right, for a brief you have not seen |

Hints on four of the eight, each inside that checkpoint's 50% cap.

## What you are graded on

| Population | Count | Where it lives |
|---|---:|---|
| Briefs in the repository | 6 | `local/fixtures/generate.py`, in a checkout — not in your image |
| Variants — one fact moved | 18 | derived from those six |
| Briefs generated from the seed | 12 | nowhere; they exist only at grading time |

The third row is why a lookup table keyed by `brief["id"]` does not work. The second is why a
design that was decided once rather than derived fails the last checkpoint. Both are deliberate.

## More than one answer can be right

The smallest sufficient combination need not be unique — `delegated-scoring` passes with MPC and
with FHE. Nothing compares your selection against a reference. The grading asks only whether it
covers what the brief requires, relies on no party the brief does not supply, and contains
nothing spare.

## The toy warning

`PRIMITIVES` is a teaching abstraction, chosen so the trade-offs fit on one screen. It flattens
setup assumptions, malicious-versus-semi-honest security, circuit size, and ciphertext expansion.
It is not production guidance, and a real deployment differs.

## Assurance scope

Local mode is **self-paced, honor-system verification**. You own the machine, the Docker
daemon, and the image, so nothing inside the image you build is hidden from you.

What changed with Issue 537/538 is **which image holds what**. Grading runs in a second,
unpublished container. `fixtures/`, `tests/hidden/` and `verifier/` exist only there, reachable
from the Workbench over an internal network and never present on the Workbench's filesystem —
so `make test` and `make inspect` start that container too (`make verifier-up` on its own
starts it, `make verifier-down` stops it), and `show.py` and the public tests read this
deployment's brief from its `GET /public` instead of importing the fixtures.

That is a misdelivery boundary, not a confidentiality one: build the `verifier` or `author`
stage yourself and you can read all of it.

What the verifier does guarantee is narrower and real: a submission cannot hang or crash it,
a checkpoint can only credit the id it echoes, results do not leak expected values, and the
fixtures come from this deployment's seed so a memorized answer does not carry.

That supports self-study and honest practice. It does **not** support competition ranking,
examination, or completion certification — those need a verifier the participant does not
administer, tracked in [#271](https://github.com/susumutomita/TenkaCloudChallenge/issues/271).

## Cost

Zero. No cloud account, no AWS resources.

## For authors

`make reference-test` runs the mutation suite: seventeen broken designs plus two verifier
defects. Every one of them still returns a complete, plausible-looking design — which is the
point, because in a design problem the wrong answers are never empty.

Two defects surfaced while writing it, both from the hidden tests running against generated
briefs rather than from reading the code. An input owned by the component that computes on it
produced no edge at all, so the asset vanished from the flow. And requiring a dedicated operator
*role* before the non-cryptographic baseline could be admissible meant a lone party computing on
its own data counted as untrusted — and got answered with a ZK proof.

One mutation was removed rather than baselined. Pruning a greedy cover is unreachable with six
options, so no test could distinguish it from the reference. The selection is an exact
smallest-cover search instead — minimal by construction rather than by repair — which made the
mutation killable.

### Two things found by running the container, which no test covers

Both are inherited from the scaffolder's template and affect **every** AC26 problem, not only
this one. This problem carries the fix; the others still need it.

- **The pinned base-image digest does not exist.** `sha256:4efa69bf…` returns 404 from Docker
  Hub for every platform, so `make build` fails before anything runs. Nothing in CI goes
  through Docker — the tests invoke `python3` directly — so a dead pin passes every check.
- **The verifier bound the container's own loopback.** A published port is forwarded to the
  container's bridge address, so `HTTPServer(("127.0.0.1", port))` accepts nothing from
  outside the container: every request is opened and closed with no response, and no
  checkpoint can score. The Workbench loopback restriction that matters lives in
  `docker-compose.yml`, and is unaffected.

The second one is the more instructive failure. Every checkpoint passed in CI, because the
tests call `evaluate()` directly and never cross a socket. The scoring logic was correct and
entirely unreachable — which is the same shape of mistake as delegating a property to a
component that does not provide it.
