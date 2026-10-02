# DLR Lightning Lane monitor

A personal Disneyland / Disney California Adventure return-time monitor.
Alerts only: modify bookings yourself in the Disneyland app, then update the
reservation here.

## Local setup

Node 24 is required. Run commands from the repository root.

```sh
npm ci
npm run db:init
npm run probe -- --diagnostic
npm run dev:mock
```

Open http://localhost:3000. The diagnostic bootstraps the attraction catalog and
prints every attraction's queues. It is an explicit one-time exception to the
active-watch polling rule. Run a separate terminal for `npm run worker`.
The browser only reads stored observations; closing the browser does not stop
the worker. Start a single worker process.

`dev:mock` enables an explicit local mock identity and binds to 127.0.0.1.
It does not change .env. Mock auth is rejected for production builds/start.
For real Auth0, copy .env.example to .env, configure the Auth0 values and use
`npm run dev`. Builds work without Auth0 credentials; unauthenticated access
fails closed until configured. Never commit .env.

## What works

- Mobile dashboard; add/edit today's reserved window and optional target start range.
- Pause, resume, complete, and restore today's bookings.
- Auth0 Universal Login with open signup and private per-user bookings and notifications.
- Both-park polling only while a same-Pacific-day booking still needs its target.
- SQLite history for all returned attractions/queue types, with versioned migrations.
- Separate RETURN_TIME / PAID_RETURN_TIME storage; Multi Pass watches use RETURN_TIME.
- Persistent per-park backoff, timeouts, worker heartbeat and stale-data indicators.
- Approaching/reached evaluation, durable alert deduplication and bounded push retries.
- PWA manifest, Android-ready icons, service worker, subscription and test notification.
- Local Docker build assets for Next.js, worker and Caddy.

Real Auth0 login and physical-device push require credentials/configuration and
have not been verified against a tenant/device. Docker runtime and the droplet
are not verified here. Trend prediction and booking eligibility timers are deferred.

## Watch rules

All times are Pacific (America/Los_Angeles). Only today's visit date is eligible.
A target is an inclusive range of acceptable return-window START times. The default
early-warning margin is 15 minutes on either side. Unknown/unavailable, down,
invalid, expired and stale offers do not trigger alerts.

A reserved start already inside its target stops polling/alerts for that booking.
An offered target is not confirmation of a modified reservation: you update the
stored reservation after making the change in Disneyland. Each phase sends once
per booking revision. Edits and explicit resume rearm it; pending old-revision
deliveries are canceled. There is no separate expires_at cutoff.

## Push

Generate keys once with `npm run vapid:generate` and store the values plus a valid
VAPID_SUBJECT in .env. Both web and worker need these keys. Enable notifications
on your device, then use Send a test. HTTPS is required off localhost. Logging out
does not stop background watches or push; use Pause or Disable this device.
No authenticated API/page data is cached offline.

## Commands

| Command                       | Purpose                                            |
| ----------------------------- | -------------------------------------------------- |
| npm run dev:mock              | Local dashboard without an Auth0 tenant            |
| npm run dev                   | Local dashboard using configured Auth0             |
| npm run worker                | Background polling, evaluation and push delivery   |
| npm run probe                 | One cycle, subject to watch gating                 |
| npm run probe -- --diagnostic | One-time catalog/feed inspection                   |
| npm run db:backup             | SQLite online backup into ignored data/backups     |
| npm test                      | Domain, persistence and migration tests            |
| npm run typecheck             | TypeScript validation                              |
| npm run build                 | Production Next.js build (no credentials required) |
| npm start                     | Local production server; mock identity prohibited  |

Browser test: use a fresh isolated DATABASE_PATH, run
`node scripts/seed-browser-test.ts`, start `npm run dev:mock` with that same path,
then `npm run test:browser`. Requires Microsoft Edge. Set BROWSER_BASE_URL when
using a port other than 3000. To check cross-user API isolation, run
`node scripts/browser-users-check.mjs` with the same isolated DATABASE_PATH and
BROWSER_BASE_URL. The fixtures are test-only
and should not be seeded into your personal database.

See [architecture](docs/architecture.md) and [deployment](docs/deployment.md).

## User accounts

Anyone who signs in through the configured Auth0 application can use the app. Enable
your login connection for the application and turn off **Disable Sign Ups** in the
Auth0 database connection settings to allow email/password registration. The login
page includes a Create account link. Each account has private bookings and devices.

AUTH0_ALLOWED_SUB is optional and used only to assign legacy, unowned data to its
original owner. Set it to that owner’s exact Auth0 User ID before upgrading if you
need to retain existing bookings. Without it, legacy data stays unassigned and is
excluded from dashboards and monitoring. It is never claimed by the first signup.
Once assigned, changing this variable does not transfer existing data.

On a shared browser, notifications remain active after sign-out. Enabling them under
a different account replaces the browser subscription; the old account’s device
record is never transferred. Use Disable this device before handing over a browser.
