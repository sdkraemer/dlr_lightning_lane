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

## Running Docker locally

These PowerShell commands run the web app, monitoring worker, and Caddy at
https://localhost using the repository's Docker Compose configuration. Run them
from the repository root. Docker uses a separate persistent SQLite volume;
bookings from the normal local development database are not copied automatically.

### One-time setup

Install and start Docker Desktop with Linux containers enabled. Ports 80 and 443
must be available. If `.env` does not exist, copy `.env.example` to `.env`, then
configure the Auth0 settings and VAPID keys described below. Keep existing VAPID
keys stable and use a subject such as `mailto:you@example.com`. Docker requires
real Auth0 configuration; mock authentication is not supported.

In your Auth0 application's settings, add these entries alongside any existing
development URLs:

- **Allowed Callback URLs:** `https://localhost/auth/callback`
- **Allowed Logout URLs:** `https://localhost`

Set the local Docker overrides, build the images, initialize the database, and
bootstrap the attraction catalog:

```powershell
$env:APP_DOMAIN = "localhost"
$env:APP_BASE_URL = "https://localhost"
$env:IMAGE_TAG = "local"

docker compose build
docker compose run --rm worker node scripts/init-db.ts
docker compose run --rm worker node scripts/probe.ts --diagnostic
docker compose up -d --no-build
```

Once Caddy is running, copy its local root certificate and trust it for your
Windows user. This allows the browser to use local HTTPS without certificate
errors; Caddy inside Docker cannot install the certificate on Windows itself.
See [Caddy's local HTTPS documentation](https://caddyserver.com/docs/running#local-https-with-docker).

```powershell
docker compose cp caddy:/data/caddy/pki/authorities/local/root.crt "$env:TEMP\dlr-caddy-root.crt"
certutil -user -addstore -f Root "$env:TEMP\dlr-caddy-root.crt"
```

Restart Edge and open https://localhost. Sign in and enable notifications for this
address; subscriptions from http://localhost:3000 do not carry over. Certificate
setup only needs repeating if Caddy's certificate volume is recreated.

### Running after setup

Start Docker Desktop. In each new PowerShell session, set the same overrides
before running Compose. They override `.env` only for that session, so the normal
development settings in `.env` can stay unchanged.

```powershell
$env:APP_DOMAIN = "localhost"
$env:APP_BASE_URL = "https://localhost"
$env:IMAGE_TAG = "local"

docker compose up -d --no-build
```

Open https://localhost. The monitoring worker runs inside Docker; no separate
`npm run worker` is needed. Docker Desktop and the computer must stay running
for monitoring and notification delivery.

```powershell
# Check container status.
docker compose ps

# Follow logs; Ctrl+C exits the log view without stopping the containers.
docker compose logs -f --tail 100 web worker caddy

# Stop the stack while preserving the database and certificates.
docker compose down

# Rebuild and restart after code changes.
docker compose up -d --build
```

Avoid `docker compose down -v` unless you intend to delete the stored database
and certificates. For release migrations and backups, see [deployment](docs/deployment.md).

## Running on a DigitalOcean droplet

Use the same three-container stack tested locally: web, worker, and Caddy. The
steps below build images on your computer and transfer them to the droplet, so
the server does not need Node.js, npm, a Git checkout, or a separate database.
Local Docker operation has been confirmed; deployment to a droplet still needs
verification.

### One-time server setup

1. Create an **Ubuntu 24.04 LTS, x86_64** droplet. Start with **2 GB RAM and
   1 vCPU** for this small deployment and check usage after launch. Add your SSH
   public key when creating it. Follow DigitalOcean's
   [server setup guide](https://docs.digitalocean.com/products/droplets/getting-started/recommended-droplet-setup/)
   to create a sudo-capable login user.
2. Install Docker Engine and the Compose plugin using the official
   [Ubuntu installation instructions](https://docs.docker.com/engine/install/ubuntu/).
   The server commands below use `sudo docker`; Docker Desktop is only needed
   on your local computer.
3. Point a domain or subdomain, such as `lightning.example.com`, to the droplet's
   public IPv4 address using a DNS **A record**. Only add an AAAA record if IPv6
   is configured on the droplet.
4. Attach a [DigitalOcean Cloud Firewall](https://docs.digitalocean.com/products/networking/firewalls/how-to/create/):
   allow inbound TCP **22 from your IP**, and **80/443 from the internet**.
   Keep outbound access enabled for DNS, HTTPS, Auth0, the feed, and push services.
   Port 3000 does not need to be exposed. Any host firewall must also allow 80/443.
5. In Auth0, add `https://lightning.example.com/auth/callback` to **Allowed
   Callback URLs** and `https://lightning.example.com` to **Allowed Logout URLs**.
   Keep the local URLs if you still develop locally. Keep signup enabled.

Replace `deployuser`, `DROPLET_IP`, and the example domain throughout these steps.
Connect from your computer:

```powershell
ssh deployuser@DROPLET_IP
```

On the droplet, create a stable deployment directory and verify Docker:

```sh
mkdir -p ~/dlr-lightning-lane/deploy
cd ~/dlr-lightning-lane
sudo systemctl enable --now docker
sudo docker version
sudo docker compose version
umask 077
touch .env
chmod 600 .env
nano .env
```

Fill the server's `.env` with your real settings. It is separate from your local
`.env`; do not use localhost URLs here or commit secrets to Git.

```dotenv
IMAGE_TAG=release-1
APP_DOMAIN=lightning.example.com
APP_BASE_URL=https://lightning.example.com
AUTH0_DOMAIN=your-tenant.auth0.com
AUTH0_CLIENT_ID=your-client-id
AUTH0_CLIENT_SECRET=your-client-secret
AUTH0_SECRET=your-stable-random-32-byte-hex-secret
VAPID_PUBLIC_KEY=your-public-key
VAPID_PRIVATE_KEY=your-private-key
VAPID_SUBJECT=mailto:you@example.com
MONITORING_ENABLED=true
POLL_INTERVAL_SECONDS=120
```

Generate a production `AUTH0_SECRET` with `openssl rand -hex 32` on the droplet.
Use your existing VAPID key pair or generate a production pair once with
`npm run vapid:generate` locally, then keep it stable across deployments.
Leave `AUTH0_ALLOWED_SUB` unset for a fresh database. Compose sets the database
path to its persistent volume automatically.

### Build and deploy from your computer

Run in PowerShell from the repository root with Docker Desktop running. Explicit
`linux/amd64` builds match the x86_64 droplet even on an ARM computer. The ignored
`data` directory keeps the image archive out of Git and the Docker build context.

```powershell
New-Item -ItemType Directory -Force data | Out-Null
docker buildx build --platform linux/amd64 --load -f deploy/Dockerfile.web -t dlr-web:release-1 .
docker buildx build --platform linux/amd64 --load -f deploy/Dockerfile.worker -t dlr-worker:release-1 .
docker save -o data/dlr-images.tar dlr-web:release-1 dlr-worker:release-1
scp data/dlr-images.tar compose.yaml deployuser@DROPLET_IP:dlr-lightning-lane/
scp deploy/Caddyfile deployuser@DROPLET_IP:dlr-lightning-lane/deploy/
```

On the droplet:

```sh
cd ~/dlr-lightning-lane
sudo docker load -i dlr-images.tar
sudo docker compose run --rm worker node scripts/init-db.ts
sudo docker compose run --rm worker node scripts/probe.ts --diagnostic
sudo docker compose up -d --no-build
sudo docker compose ps
sudo docker compose logs --tail 100 web worker caddy
```

Check each command succeeds before proceeding. The **diagnostic probe is required
for a fresh database**: it loads attractions before any bookings exist. Normal
polling skips without pending same-day watches, so it cannot bootstrap the first
booking by itself.

Caddy starts with the other services and obtains a public HTTPS certificate once
DNS and ports 80/443 are working. No local certificate import is needed. Open
your production URL, verify login/logout, add a booking, and enable notifications
on each device. Use **Send a test**, then verify an actual target alert. Local
bookings and notification subscriptions do not automatically carry over.

The droplet keeps monitoring when your computer is off. Keep one worker replica.
Check `sudo docker stats` for memory use; the Compose service memory limits still
need validation under your production workload.

### Updates, restarts, and backups

Keep using the same deployment directory so Compose reuses the existing volumes.
For an ordinary restart or `.env` change, run:

```sh
cd ~/dlr-lightning-lane
sudo docker compose up -d --no-build
```

Before upgrading, create an online SQLite backup in the persistent volume. The
explicit working directory makes the backup output writable by the container user:

```sh
sudo docker compose exec -w /data worker node /app/scripts/backup-db.ts
```

The command prints a path like `/data/data/backups/TIMESTAMP.sqlite`. Substitute
the actual path below and copy the backup off the droplet before upgrading:

```sh
sudo docker compose cp worker:/data/data/backups/TIMESTAMP.sqlite ./backup.sqlite
sudo chown "$(id -u):$(id -g)" backup.sqlite
chmod 600 backup.sqlite
```

From your computer, download it to a distinct filename and retain it securely:

```powershell
scp deployuser@DROPLET_IP:dlr-lightning-lane/backup.sqlite data/droplet-before-release-2.sqlite
```

Build and transfer new images using a new tag such as `release-2` in the build
commands above. On the droplet, load the archive, stop the old web/worker, update
`IMAGE_TAG` in `.env`, migrate using the new image, then start the stack:

```sh
sudo docker load -i dlr-images.tar
sudo docker compose stop web worker
nano .env
sudo docker compose run --rm worker node scripts/init-db.ts
sudo docker compose up -d --no-build
sudo docker compose logs --tail 100 web worker caddy
```

Do not proceed if migration fails. Keep the previous images and backup available;
database migrations may require restoring a compatible backup to roll back.
Arrange regular off-droplet backups and test restoring into a separate volume.
Avoid `docker compose down -v`, which deletes the database and certificate volumes.
See [deployment notes](docs/deployment.md) for additional operational checks.

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

Real Auth0 login and physical-device push require credentials/configuration.
Local Docker operation has been confirmed; the droplet deployment still needs
verification. Trend prediction and booking eligibility timers are deferred.

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
