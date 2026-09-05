# Participant-only reader record — 2026-09-05

The independent `explanation_reader` role knew junior-high mathematics and beginner
Python. Its first packet contained only Japanese participant metadata, checkpoint
hints and the visible starter. It did not inspect the generator, reference or grader.

The first pass found real gaps:

- The explanation assigned a complete w0 share pair to one person, contradicting the
  later index-by-person allocation.
- Observer reconstructions were described as though no one had opened w, A or B.
- The communication row did not show the difference shares each person actually sends.
- Copying the stated expression into the starter left predecessor names undefined.
- The last C-share hint omitted reduction after the d*e correction.
- Accidental equality of the incomplete product was ruled out without justification.
- Undeclared cryptographic vocabulary obscured the arithmetic scope of the exercise.

After revision, the reader received only the revised visible text plus the public
Inspect assignments for the local `reader-followup` fixture. It computed all eight
answers by hand, without running code. Those eight answers were submitted through the
real container's `/api/prepare` and `/verify` participant route: all eight were accepted.
The same route rejected eight wrong answers and eight unsealed submissions.

The second pass additionally caught an ordinary-equality claim where equality only
holds after taking a remainder, ambiguous use of `[i]` as always a person number, and
an unclear distinction between p and the two entries of w. All three were corrected;
the reader's final focused read found no remaining substantive reading obstacle.

The visible Japanese and English code blocks were also copied into the shipped starter
and exercised through the real `/api/test`; both passed. This caught a previously wrong
expected value in the public noleak example (48−1=47 and 96−1=95). The author regression
now runs that actual public-test entry point as well as the hidden correctness checks.

This records local participant-shaped arithmetic and API evidence. It does not claim a
live Portal deployment, a classroom playtest, or that the observer fixture protects secrets.
