# Local build and droplet deployment

Local Docker operation has been confirmed by the user. No droplet was changed;
production deployment still needs verification. Follow the complete
[DigitalOcean walkthrough](../README.md#running-on-a-digitalocean-droplet) for
server setup, image transfer, production configuration, and updates.

## Build locally

Install a Docker engine that can build Linux images. Set IMAGE_TAG to a release
identifier in your local .env. Match the image architecture to the droplet; the
example below assumes an x86_64 droplet. GitHub Actions is optional.

```sh
docker buildx build --platform linux/amd64 --load -f deploy/Dockerfile.web -t dlr-web:initial .
docker buildx build --platform linux/amd64 --load -f deploy/Dockerfile.worker -t dlr-worker:initial .
mkdir -p data
docker save -o data/dlr-images.tar dlr-web:initial dlr-worker:initial
scp data/dlr-images.tar user@droplet:/path/to/app/
```

Copy compose.yaml and deploy/Caddyfile to the droplet, preserving paths. Create a
production .env there: IMAGE_TAG=initial, APP_DOMAIN=your domain,
APP_BASE_URL=https://your domain, Auth0 and VAPID settings. Use restrictive file
permissions and never transfer local test data or credentials in an image.
Point DNS at the droplet and allow inbound 80/443 plus your restricted SSH access.

On the droplet:

```sh
cd ~/dlr-lightning-lane
docker compose ls
```

Use the existing project's NAME below. It is usually `dlr-lightning-lane` unless
you originally chose a custom name. The deploy script requires this explicitly
and checks the existing running containers, application directory and SQLite volume.
It refuses to initialize a fresh deployment accidentally.

## 3. Preview and deploy

```powershell
npm run release:deploy -- --release releases/2026-10-03-01 --project dlr-lightning-lane --dry-run
npm run release:deploy -- --release releases/2026-10-03-01 --project dlr-lightning-lane
```

Defaults are `--host root@209.38.73.15` and
`--path /root/dlr-lightning-lane`. Override either if needed. Paths must be absolute
Linux paths; do not use `~`. Optional `--identity C:/Users/you/.ssh/id_ed25519`
and `--port 22` select the SSH key and port. SSH config and ssh-agent also work.
Dry-run validates local checksums and prints the plan; it does not connect or
prove remote readiness.

The scripts require working key-based SSH access and an already trusted host key.
Connect manually with `ssh root@209.38.73.15` first and verify the server fingerprint
if prompted. A `Permission denied (publickey)` error must be resolved before deployment.
Remote prerequisites: Bash, Python 3, Docker Engine with Compose v2, and `flock`
(standard on Ubuntu 24.04). The SSH user must have Docker access and write access
to the application directory. The existing web, worker and Caddy must be running.

Deployment:

1. Checks bundle hashes locally, uploads to `.deploy/releases/TAG`, and verifies hashes remotely.
2. Acquires a deployment lock, checks the existing project/volume, loads images,
   verifies architecture, and validates Auth0/VAPID configuration.
3. Saves the previous Compose/Caddy files and image references, stops web and worker,
   then makes and integrity-checks a SQLite online backup.
4. Runs migrations using the new worker image against the existing data volume.
5. Installs the pinned Compose/Caddy files, starts the services without building,
   reloads Caddy, and checks the web response and a fresh worker heartbeat.

There is brief downtime during backup, migration and restart. The production
`.env` is never overwritten. Its `IMAGE_TAG` is ignored by the deployed pinned
Compose file. No volumes or images are deleted, and the worker stays single-instance.
Afterward check HTTPS login and a push notification on your phone.

## Failure recovery and backups

Every attempt has a unique `.deploy/releases/TAG` directory. An existing directory
is not overwritten; investigate a failed attempt before retrying with a new release
tag. Preflight errors leave the existing app running. Errors after services stop
can leave the application offline; the error identifies the failing stage.
There is deliberately no automatic rollback across database migrations.

Recovery files in that directory:

- `database-before.sqlite`: integrity-checked pre-migration backup (created during backup stage).
- `previous-compose.yaml`, `previous-Caddyfile`, `previous-images.txt`.

Review the failure and migration state first. If restoring the previous version,
stop web/worker, restore its database backup into the same volume (including
removing stale SQLite WAL/SHM sidecars while all database users are stopped), preserve
the database's UID/GID, restore the previous Compose/Caddy files, then start the
previous images. Do not run an older app against a migrated schema without verifying
compatibility. Do not use `docker compose down -v`.

Keep encrypted backup copies off the droplet. Release directories contain private
database backups and should not be served publicly or committed. They and old Docker
images are retained until you deliberately remove them. Test restores separately.

## Auth0

One Regular Web Application with Universal Login. Configure the production
`https://dlrll.com/auth/callback` and root logout URL. Anyone authenticated through
this application accesses their own data. `AUTH0_ALLOWED_SUB` is optional and
assigns unowned legacy records; it is no longer an access restriction.
The build accepts empty auth configuration; production requires valid settings.
Keep Auth0 secrets and the matching VAPID key pair in the droplet's `.env`.

## Ubuntu swap

Inspect existing swap and disk space with `swapon --show` and `df -h`.
Only if no appropriate swap exists, create the requested 1 GB swapfile:

```sh
sudo fallocate -l 1G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
```

Add `/swapfile none swap sw 0 0` to /etc/fstab once and verify with `swapon --show`.
Do not overwrite an existing swapfile. Check memory use with `docker stats`;
current limits are web 384 MB, worker 192 MB, Caddy 64 MB.
