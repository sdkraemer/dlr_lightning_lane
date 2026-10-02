# DLR Lightning Lane monitor

Personal alerts only; no Disney credentials or automated booking changes.

Initial phase: runnable data probe, guarded worker, SQLite schema and architecture
proposal. UI, authentication, alert evaluation, push delivery and predictions are
not implemented. GitHub owner/repository selection is pending.

## Layout

- `apps/web`: proposed Next.js PWA and same-origin API
- `apps/worker`: independent polling process
- `packages/themeparks`: live feed client
- `packages/db`: shared SQLite access and initial schema
- `scripts`: database initialization and queue inspection
- `tests`: polling gate and persistence checks
- `deploy`: Docker assets
- `docs`: architecture and findings

## Run (Node 24)

No runtime dependencies are needed for this phase. Node runs erasable TypeScript
directly; this does not type-check it. Node's built-in SQLite may print an
experimental warning. Add TypeScript checking and lockfile with the web toolchain.

```sh
npm run db:init
npm test
npm run probe
npm run probe -- --diagnostic
npm run worker
docker compose up -d --build worker
```

`probe` checks SQLite before any request. `worker` repeats that check every
60–120 seconds (default 120), after the previous cycle completes. No overlapping
cycles. Run one worker replica. It polls BOTH parks when at least one unexpired,
same-Pacific-day booking has a target range and state `waiting` or `watch`.
Bookings without targets do not trigger polling. Same-day gating is a proposed
default, awaiting product confirmation. No sample bookings are inserted.

`--diagnostic` explicitly bypasses the gate for a one-time inspection and stores
the result. It is never enabled by the scheduled worker. Output is JSON lines,
one per attraction, containing every queue key and both return-time payloads.
All queue payloads, including future queue types, are retained in SQLite.

The worker does not yet transition watches or send alerts. Bookings must be
inserted through SQLite until the booking editor/API is implemented. Database
and secrets are ignored by Git. Environment variables configure the process;
for a local `.env` use `node --env-file=.env apps/worker/src/main.ts`.
Compose reads its interpolation values from `.env` automatically.

The initial schema is for fresh databases; it is not a versioned migration system.
Introduce versioned migrations before changing a deployed schema.

See [architecture](docs/architecture.md) and [queue findings](docs/queue-findings.md).
