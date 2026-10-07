# Research scope and independent mathematical review

OpenAI/math references are pinned to `adc7f1241b42e322a6451854ab7e4b4c146bf78a`, inspected on 2026-10-07. Selected family: 017, *The irrationality exponent of π is 2*. Grading depends on elementary facts and finite constraints, not the claimed new theorem.

## Primary material read

- [Full paper](https://github.com/openai/math/blob/adc7f1241b42e322a6451854ab7e4b4c146bf78a/preprints/The-irrationality-exponent-of-pi-is-2-September-24-2026/paper.pdf): question and proof architecture.
- [Interpolation](https://github.com/openai/math/blob/adc7f1241b42e322a6451854ab7e4b4c146bf78a/preprints/The-irrationality-exponent-of-pi-is-2-September-24-2026/build/sections/interpolation.tex): full row rank, nonzero minor, ordering of weights and centers.
- [Determinants](https://github.com/openai/math/blob/adc7f1241b42e322a6451854ab7e4b4c146bf78a/preprints/The-irrationality-exponent-of-pi-is-2-September-24-2026/build/sections/determinant.tex): arithmetic lower bound; exhaustive analytic branches; candidate degrees and error powers a−β.
- [Conclusion](https://github.com/openai/math/blob/adc7f1241b42e322a6451854ab7e4b4c146bf78a/preprints/The-irrationality-exponent-of-pi-is-2-September-24-2026/build/sections/conclusion.tex): Lemma 4.1 and parameter choices.
- [Lean scope](https://github.com/openai/math/blob/adc7f1241b42e322a6451854ab7e4b4c146bf78a/lean/docs/017.md), PiExponent Main, AdmissibleMatrixGeometry, InterpolationConsequence, comparator configuration and formalization status.
- [Zeilberger–Zudilin, A New Upper Bound for the Irrationality Measure of π](https://arxiv.org/html/1912.06345v2): historical context; computer-assisted integral parameter exploration followed by rigorous arithmetic/asymptotic estimates; bound 7.103205334137… .

The new claim concerns every ν>2 and sufficiently large denominators. It is neither |π−p/q|≥1/q² for every q nor a uniform c/q² bound. The threshold is not effective. A finite exception such as 355/113 below the cubic benchmark is allowed. The game challenges insufficient evidence for an infinite statement, rather than declaring the statement false by using the manuscript as an oracle.

## Mapping and limits

1. **Records.** Machin's identity and alternating arctangent series enclose π with BigInt fractions. Displayed error is explicitly an approximate rounded value; decisions use the unrounded enclosure. Error×q² is the game comparison, not the paper's proof.
2. **Integer clearing.** Δ=ad−bc. Clearing denominators with D multiplies Δ by D². Nonzero integer magnitude is ≥1, so |Δ|≥1/D² if Δ≠0. Negative differences are supported. The game grades that derived floor and |Δ|≤1/8, not a stronger bound read from the actual difference. The paper obtains its nonzero minor through interpolation, not arbitrary small tables or coefficient counting alone.
3. **Candidate arrangements.** β=0, types a∈{0,1}, coefficient upper bound 1, decay factors 1/2. Candidate exponent is Σa+Σd. A split n₀,n₁ costs n₁+n₀(n₀−1)/2+n₁(n₁−1)/2 at minimum. All splits give minima 4/6/9 for 4/5/6 rows. An exponent counterexample invalidates that combinatorial guarantee; a looser upper estimate does not prove an actual term is nonzero or large. Coefficients, residuals, term count and their sum remain outside this model. The two paper branches cover all terms, rather than being optional attacks.
4. **Allocation.** Lemma 4.1 starts with 1/2<b<1−1/ν. δ=1/10, θ=1−δ, A=1−bδ give θ−A²=(2b−1)δ−b²δ² and ν(A−θ)−(1−θ)=[ν(1−b)−1]δ. The quadratic term is retained. ν=9/4 has no valid tenth-grid choice; 26/50 and 27/50 pass all four conditions. 51/100 has positive entry margins but fails the adjusted collision condition. Bonus compares the smaller entry margin only after validity. B,C, interpolation, separation, shared simplex budget, residuals and the infinite argument are outside the game. The closed entry window at ν=2 proves neither the theorem nor impossibility of other methods.

The actual paper order is dimension, separated weights, denominators/centers, then large H. A shared weighted simplex budget is not independent rectangular budgets. These are research boundaries, not playable proofs.

## Manuscript verification status

The official repository describes different verification stages. `lean/docs/017.md` selects the exponent statement and excludes the Flint–Hills convergence consequence. Main.lean also declares convergence results; declarations do not establish comparator success. The `sorry` in the comparator challenge is a target placeholder, not by itself a missing solution proof.

An independent reviewer searched pinned `lean/formalization.yaml`, found no PiExponent/irrationality/Flint entry, and reported global review status unchecked. That does not show the proof is false. The comparator configuration names a solution module and allowed axioms; configuration is not an executed audit. Full dependency builds, axiom audit and Comparator execution were not run. Participant text says the manuscript **claims a proof and publishes formalization sources**, not “a verified breakthrough.”

## Independent review and repairs

An independent reviewer read the primary sections, checked the design's quantifiers, finite exceptions, exhaustive branches, parameter order, shared budget, a−β and Lean scope, then invoked the implemented math module and examined scoring, hints and debrief. The second pass caught real defects:

- Decimal rounding collapsed a purported error interval to an incorrect point. It now says “approximately”; decisions remain exact.
- Nonzero integer ≥1 omitted magnitude. The text now covers negative values.
- A nonzero table was confused with a nonzero determinant. The required property is explicit.
- A failed exponent guarantee was said to establish an actual large term. Feedback now limits the conclusion to the combinatorial claim.
- Positive entry margins were said to suffice despite δ². All four conditions and the exact bonus comparator are stated.
- Terms, degrees, coefficient, decay, weights and a/β lacked definitions; the two meanings of exponent could be confused. Definitions precede use, and live cards show types/degrees without calculating the audit answer.

The reviewer independently confirmed: 355/113 passes the cubic benchmark but 710/226 does not; ±1/8 with D=8 both give floor 1/64; candidate minima 4/6/9; 51/100 fails and 26/50, 27/50, 53/100 pass; selected Lean scope excludes convergence. This is mathematical review, not independent human usability testing or validation of the infinite theorem.

A follow-up review confirmed all six repairs. It additionally caught β being called a correction to d; wording now identifies it as the original row's assigned index, with a−β applied per direction. The playable model has one direction and β=0. See [execution evidence](EVIDENCE.md) for the actual checks and remaining integration limits.

## Bilingual preparation review

Independent source comparison and actual migration reproduction found further concrete issues: negative differences needed a magnitude-based size-audit label; English lost the target of the prior 7.103… exponent bound; floor and computable threshold needed first-use explanations; migrated English history initially lost the 4<6 counterexample. These were corrected. State migration now replays retained accepted operations, compares the old Japanese/structural state (independent of object-key order), and restores bilingual numerical evidence. Real schema-1 scope and mixed-audit fixtures cover this. Coefficient estimates explicitly bound magnitude in both languages. The final review confirmed the mixed-audit repair, with two remaining Japanese wording omissions subsequently corrected. This review is not a native-host, human-usability or full Lean verification claim.
