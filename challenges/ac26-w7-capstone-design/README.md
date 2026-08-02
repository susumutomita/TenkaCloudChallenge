# Do not start from the tool

The brief names actors, assets, and who trusts whom. It names no primitive. Derive the properties it requires, select exactly that much, type every boundary, then answer the same brief with one fact moved.

## Browser workflow

1. Start the problem in the Participant Portal and open **Browser Workbench**.
2. Run `inspect` and read the deployment-specific fixture and published evidence.
3. Edit the starter sources on the page and run the public `test` command.
4. Complete any direct-answer fields from the evidence and your experiments.
5. Run `prepare`, then paste every generated value into the matching Portal checkpoint.

Direct answers are bound to the current deployment seed by `prepare`.

## Learning goals

- Break a problem statement into actors, assets, and trust before thinking about tools.
- Derive the required security properties from the brief, and require nothing beyond them.
- Compare against the option that uses no cryptography, and say what cryptography bought.
- Design the boundary by typing each edge as plaintext, ciphertext, share, or proof.
- Tie every property to a responsible component and to evidence you could observe.
- Answer a brief whose facts have changed by re-deriving the design.

## Checkpoints

| Checkpoint | Purpose | Points |
| --- | --- | ---: |
| `assets` | List what belongs to whom, and how far it is hidden |  |
| `requirements` | Take from the brief only the properties it asks for |  |
| `alternatives` | Lay the options out, including using none of them |  |
| `selection` | Select as much as the brief asked for, and no more |  |
| `architecture` | Say what crosses each boundary, and in what form |  |
| `attacks` | Write down how it breaks, in a form you could observe |  |
| `matrix` | Say, for each property, which component carries it |  |
| `revision` | Answer a brief in which one fact has moved |  |

## Explanation

## Not starting from the tool

Begin a design at "should this be ZK or MPC" and you will get an answer. Whether the answer
fits the problem is a separate question, and it is usually asked too late.

None of the briefs here names a primitive. They name who is involved, what exists, who must
not learn what, and who acts on a value they did not compute. The required properties follow
from that, and the options follow from the properties. A design built the other way round
usually works, and usually protects the wrong thing.

## Privacy and zero knowledge are different columns

The lender must not see the `balance`. Is that privacy?

The lender does not take part in the computation; it only reads the answer. So this is not
"hide it from the party doing the work" — it is "get somebody to believe a value they did not
compute". The first is privacy. The second is soundness, and zero knowledge is required only
when the value they must believe is derived from the value you are hiding.

Soundness alone is an ordinary signature. Collapse the two and you bring a proof system to a
place a signature would have done.

## Where minimality bites

Drop one option from your selection. If the requirements are still covered, that option was
doing nothing — and an option that does nothing is not free. It adds an assumption, a surface
to attack, and something you now have to explain.

`shift-board` is in the set as the brief that needs no cryptography. Nothing is secret,
nobody distrusts the operator, and nobody depends on somebody else's computation. A design
that reaches for a primitive there started from the tool.

Note also that the smallest sufficient combination need not be unique: `delegated-scoring`
passes with MPC and with FHE. The grading asks only whether the selection covers what is
required, relies on no party this brief does not supply, and contains nothing spare.

## `non_goals` is not decoration

Every option in `PRIMITIVES` carries a `non_goals` list. FHE does not remove key management:
somebody holds the decryption key, and that somebody remains an actor in the threat model.
MPC does not remove the collusion assumption; it relocates it. A ZK proof does not hide the
public inputs.

So when the property matrix says a component is responsible for privacy, check that the
component implements an option that actually provides it. A design that delegates a property
to something which does not provide it is complete on the diagram.

## A derived design and a decided one

The last checkpoint hands you briefs in which one fact has moved: the operator is no longer
trusted, an outside party now depends on the result, the answer must arrive with one party
unreachable.

If your functions read the brief, this is four calls. If any of them wrote an answer down,
that is the one that does not move. Design documents go stale for exactly this reason — the
difference being that a document does not tell you it has.

## Where this leads

Week 7's implementation challenge turns this property matrix and attack plan into experiments
that actually run. The experiment ids you put in the `evidence` column are the ones it
executes.

## Authoring and validation

Participants do not need a checkout. Repository maintainers use the Makefile author targets and CI as the validation source of truth.
