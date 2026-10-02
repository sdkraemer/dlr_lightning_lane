# Local build and droplet deployment

Docker is not installed in the current development environment, so the Docker
images and Compose stack still need a runtime verification. No droplet was changed.

## Build locally

Install a Docker engine that can build Linux images. Set IMAGE_TAG to a release
identifier in your local .env. Match the image architecture to the droplet; the
example below assumes an x86_64 droplet. GitHub Actions is optional.

```sh
docker buildx build --platform linux/amd64 --load -f deploy/Dockerfile.web -t dlr-web:initial .
docker buildx build --platform linux/amd64 --load -f deploy/Dockerfile.worker -t dlr-worker:initial .
docker save -o dlr-images.tar dlr-web:initial dlr-worker:initial
scp dlr-images.tar user@droplet:/path/to/app/
```

Copy compose.yaml and deploy/Caddyfile to the droplet, preserving paths. Create a
production .env there: IMAGE_TAG=initial, APP_DOMAIN=your domain,
APP_BASE_URL=https://your domain, Auth0 and VAPID settings. Use restrictive file
permissions and never transfer local test data or credentials in an image.
Point DNS at the droplet and allow inbound 80/443 plus your restricted SSH access.

On the droplet:

```sh
docker load -i dlr-images.tar
docker compose run --rm worker node scripts/init-db.ts
docker compose run --rm worker node scripts/probe.ts --diagnostic
docker compose up -d --no-build
docker compose logs --tail 100 web worker caddy
```

For later releases, back up first, stop web/worker, run migrations once through
the new worker image, then restart the stack. The SQLite mount is a named local
volume, shared by both processes. Do not scale the worker beyond one replica.
Caddy persists certificates in its own volume.

## Auth0

One Regular Web Application with Universal Login. Configure the exact production
/auth/callback URL and root logout URL; local development uses
http://localhost:3000/auth/callback and http://localhost:3000.
AUTH0_ALLOWED_SUB must match your user identity. An authenticated different user
receives no data. No local passwords or Auth0 credentials in the worker.

The Docker web entrypoint requires all Auth0 settings and HTTPS at runtime.
The build itself accepts empty configuration. DEV_MOCK_AUTH is never passed
through Compose and is rejected in production.

## Ubuntu swap

Inspect existing swap and available disk space first using swapon --show and df.
Only if no appropriate swap exists, create the requested 1 GB swapfile:

```sh
sudo fallocate -l 1G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
```

Add /swapfile none swap sw 0 0 to /etc/fstab once (check for an existing entry).
Verify with swapon --show. Do not overwrite an existing swapfile. Swap is not a
substitute for measuring memory: validate web 384 MB, worker 192 MB and Caddy 64 MB
limits with docker stats and adjust after testing on the actual 1 GB droplet.

## Backups and acceptance

Use SQLite online backup, never copy just the live .sqlite file while WAL writes
are occurring. For example, run scripts/backup-db.ts in the worker container and
copy the reported backup path out with docker cp. Encrypt and retain off-droplet
copies. Test a restore into a separate volume before relying on the backup.

Check login/logout, wrong-user denial, phone PWA install, test notification,
approaching/reached alerts, suppression after editing, process restart, data
persistence, midnight rollover and memory use. A push-service acceptance does not
guarantee device display. Notifications already in flight cannot be recalled.
