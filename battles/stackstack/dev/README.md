# StackStack local UI harness

The harness renders the real [`../portal/StatusPanel.tsx`](../portal/StatusPanel.tsx)
for each participant-visible state:

1. app URL not registered
2. first measurement pending
3. hardening in progress
4. production ready
5. a safety regression after completion

```bash
cd battles/stackstack
bun install --frozen-lockfile
bun run dev             # http://localhost:5655
bun test
bun run typecheck
```

This is a UI fixture, not a second StackStack implementation. It does not call
AWS, run the score engine, or imitate authentication. Its props are isolated
sample snapshots for one team at a time. Team-scoped endpoint and posture
storage remains the TenkaCloud platform's responsibility, so this harness must
not be cited as tenant-isolation or production-E2E evidence.
