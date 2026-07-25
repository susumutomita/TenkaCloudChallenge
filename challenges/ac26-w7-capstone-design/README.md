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

## What you write

A design, as code. Eight functions in `local/starter/design.py`, each deriving its answer from
the brief in front of it:

```text
classify_assets       who owns what, and how far it is hidden
required_properties   which of the six properties this brief actually asks for
compare_alternatives  every option -- including using none of them
select_primitive      exactly as much as the brief needs
architecture          a typed data-flow graph: what crosses which boundary, in what form
attack_plan           how it breaks, in a form you could observe
property_matrix       which component carries each property, and the evidence
revise                all of the above again, for a brief whose facts have moved
```

Design written as prose is un-checkable, and un-checkable design documents are how "privacy"
ends up delegated to a component that does not provide it. Written as code, the same design has
a boundary a test can cross.

## Three things the checkpoints turn on

**Privacy and zero knowledge are different columns.** The lender must not see the balance — but
the lender does not take part in the computation, it only reads the answer. That is not "hide it
from the party doing the work" (privacy); it is "get somebody to believe a value they did not
compute" (soundness), and zero knowledge enters only when the value they must believe is derived
from the value you are hiding. Soundness alone is an ordinary signature.

**Minimality.** Drop one option from your selection. If the requirements are still covered, that
option was doing nothing — and it is not free: it adds an assumption, a surface, and something
more to explain. One of the six briefs requires no cryptography at all.

**`non_goals` is not decoration.** FHE does not remove key management: somebody holds the
decryption key and stays an actor in the threat model. MPC does not remove the collusion
assumption; it relocates it. A ZK proof does not hide the public inputs. Check `PRIMITIVES`
before making a component responsible for something.

## How to play

```bash
make inspect            # your brief, and the same brief after one fact moves
make test               # public tests
make reset              # restore starter/design.py
```

You edit one file, `local/starter/design.py`.

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
| Briefs in the repository | 6 | `local/fixtures/generate.py` |
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
daemon, and the image, so nothing inside that image is hidden from you: `reference/` and
`tests/hidden/` are not bind-mounted, which keeps them out of your git checkout rather than
out of reach.

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
  checkpoint can score. The host-side loopback restriction that matters lives in
  `docker-compose.yml`, and is unaffected.

The second one is the more instructive failure. Every checkpoint passed in CI, because the
tests call `evaluate()` directly and never cross a socket. The scoring logic was correct and
entirely unreachable — which is the same shape of mistake as delegating a property to a
component that does not provide it.
