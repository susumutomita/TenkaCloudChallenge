# First-time event host

A fictional event needs an organizer. Use attendance and availability to plan resources; decide whether rehearsal evidence supports starting; route a score inquiry; hand over unfinished teardown. Four scenes turn the [LP runbook](https://tenkacloud.com/docs/operate/run-an-event/index.en.html) into an interactive rehearsal.

## Participant route

Open the Web endpoint. Read the current scene, fill the plan/decision and press Check. A confirmed scene issues a receipt. Copy it into the matching Portal checkpoint (plan, rehearsal, incident, closeout). Press Next scene to continue. Each checkpoint awards 25 points; wrong Portal submissions cost 2/1/1/1 points. Practice-page mistakes do not change scores. Three hints per checkpoint cost 0/2/3 points. Required methods and conditions are free on screen.

The interface supports Japanese and English. After finishing, copy the linked runbook's planning table into your private workspace and replace the fictional conditions with your actual event. This does not book a venue, contact helpers, deploy resources or certify real readiness.

## Runtime and verification

One non-root Node container serves the planning page on 8080 and the separate verifier on 8081. Both host ports bind to loopback. The existing `multi-verify` contract accepts `{checkpointId, submission}`; it awards no points itself. Receipts depend on the injected per-run `FLAG_SEED` and a successfully confirmed scene. The seed and receipts are not served as static assets. Earlier scenes must be confirmed before later ones. Different valid owners are accepted when available throughout the event. Reloading the page lets participants redo scenes and retrieve their receipt; restarting the container resets practice progress. Already recorded Portal points belong to the platform.

No AWS resources are created. Local Docker/Node is required; the problem is not selectable in the AWS deployment picker. No new platform adapter is needed.

## Local checks

From this directory: `make test` (Node 24). Tests cover varying attendance, alternate available owners, prerequisites, correct/incorrect operational decisions, receipt validation and the HTTP submission contract. Tests/reference decisions are outside the Docker build context.

Use TenkaCloud's existing local runner for `event-host-rehearsal`; it injects `FLAG_SEED`. Alternatively set a fresh secret in your local environment and run `docker compose -f local/docker-compose.yml up --build`. Do not publish the secret or expose the loopback ports remotely. Stop with the matching Compose `down`; no cloud resources remain. State is in memory only.

The browser and runtime validation record is in VALIDATION.md. A real event, venue booking, account access, cloud deployment and billing checks remain the organizer's pre-event rehearsal.
