# Say the same number in another key's words

Take one coefficient out of what blind rotation left behind as an LWE sample, then move it to a different key and dimension. Nothing is decrypted at either step.

The fifth Week 5 problem. Take the wanted coefficient out of the RLWE ciphertext blind rotation left behind, as an LWE sample, then move that sample to a different secret key and dimension by key switching.

Everything up to blind rotation is supplied -- the ring, RLWE, RGSW, the external product, CMUX and the rotation loop are the previous three problems' output. This problem is the two steps after.

Sample extraction rewrites coefficient k of the phase polynomial `b - a*s` as an LWE phase over the ring secret's own coefficients. Among the products collected into `(a*s)_k`, the ones whose indices crossed the degree arrive negated, so the matching mask slot has to carry that negation -- it is the rotation problem's `X^N = -1` seen from the other side. Nothing is decrypted, no noise is added, and the extracted phase is the polynomial's coefficient exactly.

And the extracted sample's secret is the ring secret read as a vector. That being not the key the rest of the system uses is precisely why the second step exists.

The switching key holds `LWE_new(B^l * s_old[j])` for every old index and level. Decompose the mask, subtract the matching entries, and `<mask, s_old>` cancels out of the phase. Nothing is decrypted here either: `s_old` appears only inside the switching key's ciphertexts and `s_new` appears nowhere. It is not a decrypt followed by a re-encrypt.

On scoring: a mask slot wraps only when its secret index is above the extracted one, so at the last coefficient nothing wraps and an implementation correct only there passes every test that checks a single index. Extraction is therefore checked at every index. And an implementation that reverses both the digit order and the key's read order agrees with itself completely, so the checks are crossed.

None of this is secure. The parameters are small enough to enumerate and both secrets fall to linear algebra.

## Browser workflow

1. Start the problem in the Participant Portal and open **Browser Workbench**.
2. Run `inspect` and read the deployment-specific fixture and published evidence.
3. Edit the starter sources on the page and run the public `test` command.
4. Complete any direct-answer fields from the evidence and your experiments.
5. Run `prepare`, then paste every generated value into the matching Portal checkpoint.

Direct answers are bound to the current deployment seed by `prepare`.

## Learning goals

- Derive the LWE phase corresponding to a chosen coefficient of an RLWE ciphertext
- Build the extracted mask including the negacyclic ring's sign
- Confirm that plaintext semantics match on both sides of extraction
- Decompose an old-key LWE mask into base-B digits
- Convert a sample to a new key using a switching key
- Explain why only the key and the dimension change, and not the message
- Identify defects that confuse the source, target and ring keys
- State why key switching is not a decrypt followed by a re-encrypt

## Checkpoints

| Checkpoint | Purpose | Points |
| --- | --- | ---: |
| `phase` | Write down the number to preserve |  |
| `extract` | Take one coefficient out |  |
| `trace` | Show the mapping |  |
| `decompose` | Break the mask into digits |  |
| `switch` | Move it to another key |  |
| `domains` | Classify which key it is about |  |
| `endtoend` | Three routes, one answer |  |
| `transfer` | Hold up in a setting you have not seen |  |

## Explanation

## The last coefficient is unfairly easy

A mask slot wraps when its secret index is above the extracted one, so at `degree - 1` nothing wraps at all -- an implementation that ignores the sign completely still preserves the phase there, and only there. Index 0 is the opposite: every slot but one wraps. All four public tests use the last coefficient to make that visible; the hidden tests run every index.

## Nothing was decrypted

Extraction is handed no key. Neither is key switching. `s_old` appears only inside the switching key's ciphertexts and `s_new` appears nowhere at all -- and the phase is still preserved. The picture of key switching as a decrypt followed by a re-encrypt fits no step of that derivation.

## The key you extract is not the key you want

The extracted sample's secret is the ring secret read as a vector, at dimension `degree`. That is not the key the rest of the system uses, which is why key switching is needed. The two steps exist separately for that reason.

## Crossed, or it proves nothing

Reverse the digit order and the key's read order together and a test that runs your decomposition through your switch still passes. So the hidden tests cross them: fixture-built samples through the submission's switch, and the submission's samples through the fixtures'.

## `compatible` is decided from metadata

Neither secret is on hand, so it cannot be settled by trying the switch and seeing whether the result decrypts -- and a system that settled it that way would need the secrets in the one place they must not be. The noise figure is a bound for the same reason: measuring it takes a phase, and a phase takes a key.

## Not in scope

Production switching-key generation, compressed switching keys, noise-security parameter analysis, multi-key or proxy re-encryption.

## This is not secure

The parameters are small enough to enumerate and both secrets fall to linear algebra. A toy of the mechanism, not of the hardness.

## Authoring and validation

Participants do not need a checkout. Repository maintainers use the Makefile author targets and CI as the validation source of truth.
