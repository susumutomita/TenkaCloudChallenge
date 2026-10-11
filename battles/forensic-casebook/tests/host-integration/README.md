# Independent native-host regression fixture

`fixture.patch` is test-only scaffolding against TenkaCloud main
`40b6ab281a58d9b5103a5599e786f7932a4d0fd0`. Apply it only in a disposable clone,
never an existing event workspace. The patch extends existing owned temporary
fixtures; it does not patch the production engine, database schema or authentication.

Use this layout under a new writable directory:

```text
sandbox/
  host-integration/       TenkaCloud clone, main 40b6ab28
    problems/            clone of this updated Challenge branch
  integration-evidence/
    battles/forensic-casebook/  archived Challenge main 41d63001
```

Archive the old problem from the catalog clone without changing that clone's
branch, and apply the test patch from the new problem:

```sh
mkdir -p sandbox/integration-evidence
git -C sandbox/host-integration/problems archive \
  41d6300148ea57db977b1ddc5a07664f4e7fcb00 battles/forensic-casebook \
  | tar -x -C sandbox/integration-evidence
cd sandbox/host-integration
git apply problems/battles/forensic-casebook/tests/host-integration/fixture.patch
bun install --frozen-lockfile --ignore-scripts
bun test scripts/local-host/tests/endpoint-http.test.ts
bun run build:host
HOST_E2E_CHROMIUM='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' \
  bun run scripts/local-host/tests/endpoint-browser-e2e.ts
```

An existing read-only dependency directory may be reused instead of reinstalling,
as in the recorded run. No browser/model download is required when an existing
Chrome is available. The browser uses a separate headless browser and fresh
contexts; it does not attach to the user's browser. Servers bind loopback with
ephemeral ports. Fixture credentials are synthetic, kept in private pipes, and
excluded from screenshots. SQLite directories and owned processes are closed
and removed by fixture teardown.

The first fixture catalog contains a real compiled v1 definition from the archived
source. The event is created and scored normally. The fixture then restarts with
current catalog v2, without editing its saved event/SQLite. It verifies v1's pinned
bundle and persisted version survive and accept another correct answer. A second,
new event uses v2 and completes all six endpoint checkpoints. HTTP tests restart
after preservation and completion, verify exact receipt replay without double
awards, and keep another seat at zero.

Browser tests create/deploy/start through the real organizer UI, use only rendered
participant evidence, restart a separate host process, verify the current UI
renders v1 at 300 points, then complete v2 at 400 maximum with 100 awarded points,
five official history entries and the legacy event unchanged. Generated images
are under `.tenkacloud/host-ui-review/endpoint-*.png` in the disposable clone.

Recorded 2026-10-09: HTTP regression 1 test / 57 assertions passed; browser route
passed without page errors. Existing host forensic HTTP, coordination-core and
browser-metadata tests also passed (15 tests / 3072 assertions). Production DBs,
real events, deployments and cloud storage adapters were not exercised.
