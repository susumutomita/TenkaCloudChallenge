# Validation — 2026-09-10

## Automated checks

- `make test`: three tests pass, covering 25 generated scenarios, quantities, multiple valid owners, prerequisite stages, invalid decisions, per-run receipts and all four stages through HTTP and the existing `{checkpointId, submission}` verification contract.
- Catalog `make install agent-gate`: 117 problem metadata files validate.
- Docker image builds with Node 24, runs as non-root, and binds its Web and verifier endpoints to loopback on the host.

## Browser rehearsal

Using the built Docker image, completed all four Japanese scenes: 19 participants, five teams, 21 computers and Mei as the available owner; held sign-off pending scoring verification; referred the displayed ORDER-84 to the technical lead for reconciliation; recorded unfinished teardown with an owner and a deletion/cost recheck. Each scene issued its own receipt. The English completion screen was inspected at 390 × 844; text and controls fit without horizontal overflow.

The generated LP runbook was inspected at 1280 × 900. Its organizer link, timeline, quantities and rehearsal link are rendered from the developer documentation source.

## Boundaries

The HTTP verifier is exercised by the tests. Actual Portal score/history integration was not exercised in this standalone browser rehearsal. No AWS deployment, real event, participant contact, venue booking or live cost verification was performed. The exercise is Docker-only and does not appear in the AWS deployment picker. A fictional pass does not certify an actual event.
