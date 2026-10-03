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

## Run locally with Docker

Install and start Docker Desktop with **Linux containers** and Docker Compose v2.
Run these PowerShell commands from the repository root. Node and npm are not
required on the host for this route. Ensure ports 80 and 443 are free.

The existing Compose stack runs the production web app, worker, and Caddy.
It requires real Auth0 credentials and HTTPS; mock login is only supported by the
npm development setup above.

### Configure local settings

Copy the example only if you do not already have a .env file:

~~~powershell
if (!(Test-Path .env)) { Copy-Item .env.example .env }
~~~

Set these values in .env, along with your AUTH0_DOMAIN, AUTH0_CLIENT_ID,
AUTH0_CLIENT_SECRET, and AUTH0_SECRET:

~~~dotenv
APP_DOMAIN=localhost
APP_BASE_URL=https://localhost
IMAGE_TAG=local
DEV_MOCK_AUTH=false
~~~

In your Auth0 Regular Web Application, add https://localhost/auth/callback to
Allowed Callback URLs, and https://localhost to Allowed Logout URLs and Allowed
Web Origins. Keep any existing production URLs.

Build the images, then generate an Auth0 session secret if you do not have one:

~~~powershell
docker compose build
docker compose run --rm --no-deps worker node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
~~~

Save that output as AUTH0_SECRET in .env. To enable push notifications, generate
a VAPID pair and copy both printed values into .env; also set VAPID_SUBJECT
to your contact address, such as mailto:you@example.com:

~~~powershell
docker compose run --rm --no-deps worker node scripts/vapid.mjs
~~~

Keep these secrets stable between restarts and never commit .env.

### Initialize and start

~~~powershell
docker compose run --rm --no-deps worker node scripts/init-db.ts
docker compose run --rm --no-deps worker node scripts/probe.ts --diagnostic
docker compose up -d
docker compose ps
~~~

The diagnostic populates the attraction catalog and inspects the live feed once.
The worker runs in the background and subsequently polls only when an active
booking needs its target. Do not also start a separate npm worker against this database.

Caddy issues a local HTTPS certificate for localhost. After Caddy starts, trust
its local root certificate on your Windows account:

~~~powershell
New-Item -ItemType Directory -Force data | Out-Null
docker compose cp caddy:/data/caddy/pki/authorities/local/root.crt ./data/caddy-local-root.crt
Import-Certificate -FilePath ./data/caddy-local-root.crt -CertStoreLocation Cert:\CurrentUser\Root
~~~

This adds this local Caddy instance's certificate authority to your account's trusted
roots. Restart your browser if needed, then open [https://localhost](https://localhost)
and sign in. If the certificate is not yet available, check the Caddy logs and retry
after startup. On macOS or Linux, import the same root certificate into your
system/browser trust store using that platform's certificate tools.

### Everyday commands

~~~powershell
# Follow logs (Ctrl+C stops following; containers keep running)
docker compose logs -f web worker caddy

# Rebuild and restart after changing application code
docker compose up -d --build

# Stop and remove containers while keeping saved data
docker compose down

# Start again using the existing images and saved data
docker compose up -d
~~~

There is no source-code hot reload in this production Docker setup; rebuild after
edits. SQLite is stored in the sqlite-data named Docker volume shared by web and
worker, separate from the npm setup's ./data/lightning-lane.sqlite. Caddy's
certificates also persist in named volumes. Do not use **docker compose down -v**
unless you intend to delete the local database and certificates.

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

Time dropdowns use the selected park’s regular operating schedule from ThemeParks.wiki,
cached for six hours. They offer five-minute choices during opening hours; missing
hours disable selection. Special-event and extra-hours schedules are excluded.
