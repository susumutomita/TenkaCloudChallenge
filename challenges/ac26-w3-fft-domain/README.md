# Does Your Domain Actually Divide?

`advanced-cryptography-2026` Week 3. An evaluation domain is handed in, one equation is
checked, and everything downstream quietly stands on points that repeat.

## The gap this problem is built on

The starter checks ``omega ** n == 1`` and nothing else. That equation is satisfied by
every element of every smaller subgroup — 1 included. Every domain in the public tests
is real, so the equation-only starter passes all of them; the hidden phases hand over
omegas for which the equation and the order disagree, over primes the public tests
never use.

This is the consumer side of `ac26-w3-ntt-roots`: there the code *derives* its own
omega, here it is *handed* one and must decide whether to trust it — then keep the
transform, the inverse, the index order, and interpolation standing on it.

## Layout

```
local/starter/fftdomain.py    the one file a participant edits
local/reference/fftdomain.py  the answer (author image only)
local/tests/public/           tests the broken starter passes
local/tests/hidden/           the properties that actually decide the checkpoints
local/mutation.py             breaks the reference eight ways and requires each to be caught
local/fixtures/generate.py    orientation: field family, one real and one fake domain
local/participant/server.py   the Workbench: Portal editor API, and /verify forwarded inward
local/verifier/server.py      /verify and GET /public, in a second, unpublished container
local/show.py                 `make inspect` — participant-visible orientation only
```

## How the hidden properties decide

The checker owns its copy of the order test, written from the definition rather than
imported from the reference. Every parameter set mixes primes where the textbook
``3 ** ((p-1)/n)`` rule is right with primes where it lands in a smaller subgroup, at
least half the second kind, so trusting ``omega ** n == 1`` fails by necessity. The
ordering phase transforms ``f(x) = x`` and unit coefficients, so any bit-reversal or
recursion-order leak is directly visible; the interpolation phase checks members
against their listed values and non-members against the checker's own inverse.

## Author commands

```bash
make build           # participant image
make test            # public tests against local/starter
make inspect         # print the participant-visible orientation
make reference-test  # reference passes its hidden suite, all eight mutations die
make verifier-up     # start the verifier container the two above read from
make verifier-down   # stop it
```

## Assurance scope

Local mode is self-paced, honor-system verification. Someone who owns the Docker daemon and every
container in the compose stack cannot be prevented from inspecting hidden material. The boundary
here is misdelivery, not confidentiality against that person: the Workbench container you build
and run carries the starter, the public tests and the orientation printer only — no fixtures, no
hidden tests, no reference solution, no verifier. Those live only in a second, unpublished
container the Workbench reaches over the compose network, and in the author-only image
`make reference-test` builds.

Because of that, `make test`, `make test-one` and `make inspect` bring the verifier up first
(`make verifier-up`, run for you): `make inspect` reads this deployment's field family and its two
example domains from it over the compose network instead of computing them locally.
`make verifier-down` stops it.

Submissions run with time, memory, process, and output caps; both containers run non-root,
read-only, without privileges, and only the Workbench is published, on loopback.

It does **not** support competition ranking, examination, or completion certification. Those uses
need a verifier the participant does not administer, tracked in
[#271](https://github.com/susumutomita/TenkaCloudChallenge/issues/271).

## What you proved

You did not make the FFT fast. You decided whether a handed domain is real — order
exactly n, over a prime where n divides p-1 — and made the transform, its inverse, and
interpolation hold only over real ones. That is a precise, useful guarantee—and no
larger than the evidence supports.
