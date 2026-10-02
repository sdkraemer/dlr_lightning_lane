# Proposed architecture

## Repository and runtime

One private GitHub monorepo, one npm lockfile once external dependencies are
added. Web, worker, shared types and migrations ship together. Avoid a separate
backend service: Next.js route handlers cover this small single-user API.

Recommend Next.js App Router with standalone Docker output. Its supported
self-hosting path fits a droplet; build Linux images in GitHub Actions and pull
them onto the droplet. Do not run Next.js production builds on 1 GB RAM. A Vite
React SPA plus a small Node API is the fallback if measured memory is excessive,
but adds an API/static-asset integration step without a current requirement.

References: https://nextjs.org/docs/app/guides/self-hosting and
https://docs.docker.com/guides/nextjs/

Proposed Compose services: Caddy (HTTPS), web (Next.js), worker (Node), with one
local SQLite volume mounted into web and worker. No Redis, Postgres or separate
queue server. Current Compose implements only the probe worker.

Use WAL, foreign keys, busy timeout and short transactions. HTTP calls happen
outside transactions. Single worker replica avoids duplicate polls. Add a
database lease before permitting overlapping deploys or multiple workers.

## Data and target semantics

Park/attraction catalog uses API IDs, not names. Manual entry should select an
attraction from that catalog to handle seasonal renames safely. Bookings carry
reserved windows, visit date and optional earliest/latest acceptable start.
Confirmed user preference: a custom acceptable START range, Android notifications.

Store instants in UTC Unix milliseconds for booking math; preserve source ISO
strings and raw JSON for observations. Display and accept park-local time using
America/Los_Angeles, including DST, regardless of the phone/server timezone.

Observation history includes every fetched attraction and every queue type,
source update timestamp, fetch timestamp, status, standby wait and raw payload.
Keep successful unchanged samples: they establish how long an offer persisted.
Poll failures do not overwrite the last good observation with a false zero/null.

Target reached = AVAILABLE RETURN_TIME with a valid start inside the inclusive
acceptable range. Approaching = outside but within the early-warning margin;
direction and post-alert behavior remain to be confirmed. Confirmed warning margin:
15 minutes. An offer jumping across the range is not a target hit. Never alert on
missing, FINISHED, null or invalid windows. Treat ride-down behavior explicitly
before implementing alerts. Finishing inventory may later reopen; keep waiting
until watch expiry, manual stop or agreed target-reached policy.

Persist alert event and per-device delivery jobs in one transaction with watch
state changes. Unique booking/revision/phase keys deduplicate logical alerts;
use a stable push notification tag for retry duplicates. Increment revision when
the target changes or the user rearms. Web Push acceptance is not proof a device
displayed a notification. Implement bounded retries, remove expired endpoints,
and expose last successful poll/push status.

## Scheduling, reliability and prediction

Probe uses a non-overlapping loop, 20-second request timeout, independent park
failure handling and no requests without an eligible watch. A diagnostic CLI
bypasses the gate only when explicitly requested. Future production worker needs
per-park exponential backoff and Retry-After enforcement for 429/503 responses;
the starter currently records those failures and retries at the normal interval.

Polling only during active watches creates deliberate historical gaps. Retain
all collected history initially; measure actual database growth before setting
a retention/rollup policy. Keep logs rotated separately from durable observations.
Use rolling robust slopes only over continuous, recent AVAILABLE observations
from the same visit date. Exclude outage gaps and inventory resets; allow negative
velocity and jumps. Show insufficient data instead of misleading ETAs. Prediction
must remain advisory because cancellations can cause discontinuous availability.

## Deployment plan (not yet executed)

Ubuntu 24.04, Docker Compose, Caddy, persistent named SQLite volume. Initial
memory budgets to validate: web 384 MB, worker 192 MB, proxy 64 MB, leaving host
headroom. These are targets, not measured usage. Add 1 GB swap and measure RSS,
swap pressure and polling lag under production builds before relying on alerts.

Create a swapfile only after checking existing swap; apply restrictive permissions,
enable it and persist in fstab. No droplet has been provisioned or changed yet.

Publish immutable Linux container images from CI; droplet pulls images and runs
versioned migrations before restarting services. Keep .env outside Git: origin,
session secret, password hash and VAPID keys. Store VAPID keys persistently so
redeploys do not invalidate push subscriptions. HTTPS and a domain are required
for the deployed PWA. Use secure HttpOnly sessions, CSRF/origin checks for writes,
login rate limiting and authenticated subscription endpoints. Cache app assets
in the service worker; do not serve cached live data as current availability.

Back up SQLite using its online backup API (not a bare copy of an open WAL file),
encrypt off-droplet backups and test restores. SSH keys and host firewall should
expose only SSH and HTTP/HTTPS. Add a worker heartbeat and stale-data indicator.

## Open decisions

GitHub owner/name/privacy and authenticated access; earlier/later/either approach;
watch behavior after target reached; same-day-only gating; warning margin;
domain/DigitalOcean readiness; acceptance of monitoring gaps; desired login flow.
Create and push the GitHub repository before bulk web/alert implementation.
