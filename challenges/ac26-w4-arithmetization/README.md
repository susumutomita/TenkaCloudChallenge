# Turning it into a polynomial is not a proof

Proving a program ran does not put the program into the proof. Translate a small state machine's trace into polynomial relations over a finite field, and find out what the translation preserves and what it does not guarantee.

## Browser workflow

1. Start the problem in the Participant Portal and open **Browser Workbench**.
2. Run `inspect` and read the deployment-specific fixture and published evidence.
3. Edit the starter sources on the page and run the public `test` command.
4. Complete any direct-answer fields from the evidence and your experiments.
5. Run `prepare`, then paste every generated value into the matching Portal checkpoint.

Direct answers are bound to the current deployment seed by `prepare`.

## Learning goals

- Generate an execution trace from a deterministic computation
- Write a state transition as a constraint between adjacent rows
- Separate pinning the initial state from the transition rules
- Interpolate a trace column into a polynomial over a finite field
- Track which row, and which kind of constraint, a violation appears in
- Detect a counterexample where one row of the trace was altered
- Explain why turning something into a polynomial is not by itself a proof

## Checkpoints

| Checkpoint | Purpose | Points |
| --- | --- | ---: |
| `trace` | Produce the execution trace |  |
| `transition` | Turn adjacent rows into a relation |  |
| `boundary` | Pin where it started |  |
| `interpolate` | Turn a column into a polynomial |  |
| `compose` | Watch the relation vanish on the domain |  |
| `locate` | Locate the first row that breaks |  |
| `underconstrained` | Build a valid proof of the wrong statement |  |
| `transfer` | Hold up in a setting you have not seen |  |

## Explanation

## The translation adds no soundness

Interpolating a trace into polynomials guarantees nothing by itself. Interpolation changes the representation; the checking power lives in the constraints. "It is a polynomial now, so it is a proof" is close to saying a table became correct when it was converted from CSV to JSON.

## The two kinds of constraint do different jobs

Transition constraints say each row follows from the one before it. Boundary constraints say where the machine started. Neither implies the other.

Drop the boundary and the system is perfectly satisfied by a trace of the same machine started from **somewhere else**. Every transition holds, every residual is zero, and the polynomials are just as valid. They are a proof of a different statement. The `underconstrained` checkpoint has you build that trace, which is what "dropping one constraint" concretely means.

## How many residuals

One per adjacent row pair, so one fewer than the number of rows. An implementation with one per row is comparing the last row against a next row that does not exist -- one of the mutations is exactly that, and it dies with an IndexError.

## Which row a violation belongs to

The i-th transition produces row i+1, so row i+1 is the first row that is wrong. Reporting i sends the reader one row away from the problem.

Row 0 has no predecessor, so the only thing that can break there is the boundary; calling that a transition failure points at the wrong place too. That is why the boundary is checked first.

## The evaluation domain

The domain is the powers of a root of unity, with row i at point g^i. Consecutive rows are consecutive points, so the transition constraint becomes a relation between a polynomial at x and the same polynomial at the next point. The primes are chosen so that `steps` divides p-1 -- otherwise no root of unity of that order exists.

## This is not a proof system

There is no commitment, no verifier randomness, and therefore no soundness against anybody. It is a bridge to arithmetization, not past it. Calling what you build here "a small SNARK" is the opposite of what the problem is trying to teach.

## Week 4 alignment

Week 4's material was not published upstream at the pinned commit. `courseAlignment` pins `week4/README.md` with `kind: "placeholder"` and takes the `transfer` role -- one of the two GOVERNANCE.md section 6 permits for an unpublished week, and accurate besides, since the problem transfers Week 1's constraints and Week 3's field into a new setting. It asserts nothing about what the official exercise will require.

## Authoring and validation

Participants do not need a checkout. Repository maintainers use the Makefile author targets and CI as the validation source of truth.
