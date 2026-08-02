# The proof was valid. It was a proof about a different account

A zkVM proves that a program ran, and nothing else. Which program, about which inputs, asserting what — the guest has to say all of that out loud, in bytes. Write the contract: public statement, private witness, public journal.

Week 6's fifth problem, and the sequel to `ac26-w6-zkvm-exploit-predicate`. That one settled the **exact exploit predicate**. This one turns that predicate into a **public / private input contract** a zkVM guest can actually stand on.

The cryptography is out of scope from the start. No proof is generated. The whole job is the two halves the proof system proves **nothing** about:

```text
the public statement   what the proof is a claim about
the public journal     what the run published, forever, to everyone
```

What the cryptography guarantees is that the journal corresponds to some run of some program. It does not say **which** program, **which** inputs, or **which** claim. Saying that is the guest's job, and saying it badly makes a perfectly valid proof into evidence for something else.

## Two things moved over from the last problem

The account (`price` / `spent` / `budget`) is no longer a constant baked into a target spec — it is **public input**. The same compiled guest proves claims about every account there is, so the only thing that says which account a proof is about is the statement it was bound to.

The integer semantics moved too. A `semantics` profile names the width **and** what the hardware does on overflow, so the same image under two profiles is two different machines:

```text
wrapping     reduced modulo 2 ** width — the only machine where the exploit exists
saturating   clamped at the largest value the machine can hold
checked      the machine traps and the run stops
```

The exploit exists on exactly one of the three. A journal that does not say which one it ran under is a proof about whichever machine the reader assumes.

## The pair at the centre of it

Every seed draws **two real accounts**. Both have real exploits. Run their statements through an encoder with no length prefixes and the two produce the same bytes — `"53" + "7"` and `"5" + "37"` are the same three characters.

This is not a malformed statement slipping through. It is that a **valid proof about one account is a valid proof about the other**, with nothing in the cryptography broken while it happens. A guest that treats canonical serialization as a formatting convention fails exactly here.

## On scoring

This problem ships 55 deliberately broken guests, and **42 of them still answer the two questions anybody writes first** — does the happy path produce a receipt that verifies, and is a receipt offered against a different program refused. `make reference-test` re-measures that count on every run. Both are stated outright in the problem text and nobody has to discover them. The rest is why there are checkpoints.

## Browser workflow

1. Start the problem in the Participant Portal and open **Browser Workbench**.
2. Run `inspect` and read the deployment-specific fixture and published evidence.
3. Edit the starter sources on the page and run the public `test` command.
4. Complete any direct-answer fields from the evidence and your experiments.
5. Run `prepare`, then paste every generated value into the matching Portal checkpoint.

Direct answers are bound to the current deployment seed by `prepare`.

## Learning goals

- Separate the public statement from the private witness as explicit types
- Demonstrate why canonical serialization is needed, with two statements that actually collide
- Fix field order, length prefixes, integer width, endianness and domain separation in one serializer
- Bind target identity to the bytes that execute rather than to a source path string
- Hand a witness to the guest without exposing it through arguments, environment or logs
- Recompute the target execution inside the guest instead of trusting a host-supplied result
- Refuse an image the statement does not name before a single step runs
- Treat wrapping, saturating and checked as a profile the statement names
- Commit the statement digest, target digest, claim result and guest version into one journal
- State the condition for a public measurement as "a reader could already compute it"
- Refuse a receipt replayed against another target, claim, semantics or protocol version
- Check a journal's convenience fields against the commitment rather than reading them as evidence
- Audit the journal, stdout, stderr, error, trace and temporary artifacts for witness disclosure
- Detect a disclosure where an approved name carries a value it was never approved for

## Checkpoints

| Checkpoint | Purpose | Points |
| --- | --- | ---: |
| `encoding` | Same statement, same bytes; different statement, different bytes |  |
| `identity` | Name the program by the bytes that run |  |
| `ingestion` | The witness goes through one door |  |
| `reexec` | The host's account is an input, not the answer |  |
| `journal` | Publish only what a reader could already compute |  |
| `replay` | Is this receipt evidence for this statement? |  |
| `privacy` | An approved name is not an approval |  |
| `transfer` | A target, a claim and a protocol version you have not seen |  |

## Explanation

## What the cryptography does not prove

A zkVM proof says that some run of some program produced this journal. **Which** program, about **which** inputs, asserting **what** — the guest has to say all of that out loud, in bytes. All eight checkpoints are about that saying, and none of them is about cryptography.

## The pair at the centre of it

Every seed draws two real accounts. Both have real exploits. Run them through an encoder with no length prefixes and they are the same bytes:

```text
left   price=53 spent=7  budget=272   ->  "53" "7"  "272"
right  price=5  spent=37 budget=272   ->  "5"  "37" "272"
```

Both concatenate to `537272`. So a receipt sealed under `left` verifies against `right`, and what you have is **evidence that an account nobody has touched is over its budget**, forged out of nothing.

`naive_encode` is not a straw man. The field order is fixed, every field is present, nothing is dropped. It is still not an encoding, because the boundary between one field and the next is not in the output. That is what the length prefix is.

And that pair is not the only one that has to stay apart. Two statements differing only in `domain`, and two differing only in `guestVersion`, are different statements — and those are the two people drop first, because they "do not affect the computation".

## A digest is about the bytes that run

An image record carries two labels a toolchain wrote (`sourcePath`, `imageId`) next to the `body` that actually executes. Of the four siblings, two are the same program as the base and two are not:

```text
rebuilt     same source path, one comparison changed, a new stamp  -> a different program
restamped   the same steps, a different build stamp                -> a different image
renamed     the same bytes, another path                           -> the same program
relabelled  the same bytes, another image id                       -> the same program
```

A digest over `sourcePath` calls the rebuild the base image. Those two disagree about every order whose total lands exactly on the budget, which is the order an attacker picks. A digest over `imageId` calls the relabelled copy a different program, and a perfectly good proof is refused for a reason nobody can find.

`restamped` is the judgement call. Settle it the way proving systems do: **"nothing observable changed" is the claim under audit rather than an input to it**, so a rebuild is a different image.

## The host's account is an input, not the answer

`env.hints()` carries the host's own account of what the run produced, and on the runs the checker builds it is confident, detailed and wrong. The host is the party being proved about. A guest that takes the hint is fast, is right almost always, and proves nothing at all.

Same reasoning: an image the statement does not name is refused **before a single step runs**. Executing first and reporting which program it was afterwards produces a run somebody can quote out of context.

## What a public measurement has to pass

One test: **could a reader already compute it?** Not "is it small", and not "is it just a number".

A cycle count that varies with the witness is not a measurement, it is the witness at lower resolution. And a journal outlives its run, which makes it the one artifact where "add it for debugging and take it out before release" is not available.

## A journal's own fields are checked, not read

Besides the statement's digest, a journal carries `imageDigest` and `guestVersion`. Those are a convenience for a reader who has the journal and not the statement, and they are **not the evidence**. Writing them down costs nothing; believing them costs everything.

The checkpoint hands in receipts nobody replayed whose journal was edited after sealing: the digest still matches, and the journal now says something the statement does not. **A journal field a verifier reads is a journal field an attacker writes.**

And a receipt whose `claimResult` is `False` is a correct journal about a run that proves nothing. Accepting it as evidence for the claim is the quietest way in of all.

## An approved name is not an approval

The privacy policy has two halves. The first is `PUBLIC_NAMES`, the names a run may disclose. The second is whether an approved name is carrying an approved **value**.

`spent` is on the list. The machine's own total wearing the name `spent` is a different disclosure — the price is public and invertible, so it is the quantity with one modular inverse left to apply. A scan that only looks at names finds nothing there.

Two of the ten runs disclose nothing, and one of those two is **loud**: it fills every channel with numbers. Reporting a leak against either is exactly as wrong as missing one against the other eight. **An audit that always finds something has not read anything.**

## Measured

This problem ships 55 deliberately broken guests, and **42 of them still get the easy two right** — the happy path verifies, and a receipt offered against a different program is refused. `make reference-test` re-measures it on every run. Both categories are written out in the problem text; nobody has to discover them.

## What the suite proves, and what it does not

It proves that these eight checkpoints catch the 55 defects shipped with the problem, and that the reference clears all of them. It does **not** prove that the contract has no other hole.

## Toy versus production

The width is seven to thirteen bits, there is one account, the program is four steps, and a receipt carries no seal. Verifying a seal is precisely the part cryptography already does, so it is out of scope — and the binding it is useless without is not. In a real zkVM the statement is a program's ELF digest and a list of public inputs, and the journal is the output the proving system commits to. The claim here is that the binding can be written as an exact contract, not that the one written here is complete.

## Not in scope

Actual zkVM proof generation and receipt verification, production binary reproducibility systems, the zero-knowledge property of a specific zkVM, and remote attestation.

## Authoring and validation

Participants do not need a checkout. Repository maintainers use the Makefile author targets and CI as the validation source of truth.
