#!/usr/bin/env bash
# Uploaded and invoked by scripts/deploy-release.mjs; requires an existing deployment.
set -Eeuo pipefail
umask 077
app=$1
project=$2
tag=$3
release=$(pwd)
cd "$app"
exec 9>"$app/.deploy/deploy.lock"
flock -n 9 || { echo "Another deployment is running"; exit 1; }
old=(docker compose --project-directory "$app" --env-file "$app/.env" -p "$project" -f "$app/compose.yaml")
new=(docker compose --project-directory "$app" --env-file "$app/.env" -p "$project" -f "$release/compose.yaml")
stage=preflight
trap 'echo "Deployment failed during $stage. Production .env and volumes are preserved. Recovery files: $release. If services were stopped, inspect the backup and migration state before restarting." >&2' ERR
test -f .env
test -f deploy/Caddyfile
"${old[@]}" config --quiet
web=$("${old[@]}" ps -q web)
worker=$("${old[@]}" ps -q worker)
test -n "$web" && test -n "$worker" || { echo "Expected running web and worker in project $project; refusing a fresh deployment."; exit 1; }
volume=$(docker inspect "$web" --format '{{range .Mounts}}{{if eq .Destination "/data"}}{{if eq .Type "volume"}}{{.Name}}{{end}}{{end}}{{end}}')
worker_volume=$(docker inspect "$worker" --format '{{range .Mounts}}{{if eq .Destination "/data"}}{{.Name}}{{end}}{{end}}')
test -n "$volume" && test "$volume" = "$worker_volume"
expected=$("${new[@]}" config --format json | python3 -c 'import json,sys; print(json.load(sys.stdin)["volumes"]["sqlite-data"]["name"])')
test "$volume" = "$expected" || { echo "SQLite volume mismatch; check --project."; exit 1; }
# Caddy certificates must remain in the same project volumes, too.
for service in web worker caddy; do
  id=$("${old[@]}" ps -q "$service")
  test -n "$id"
  actual_dir=$(docker inspect "$id" --format '{{index .Config.Labels "com.docker.compose.project.working_dir"}}')
  test "$(realpath "$actual_dir")" = "$(realpath "$app")" || { echo "Existing project belongs to a different directory."; exit 1; }
done
caddy=$("${old[@]}" ps -q caddy)
for mapping in "caddy-data:/data" "caddy-config:/config"; do
  key=${mapping%%:*}
  target=${mapping#*:}
  actual=$(docker inspect "$caddy" --format "{{range .Mounts}}{{if eq .Destination \"$target\"}}{{.Name}}{{end}}{{end}}")
  expected=$("${new[@]}" config --format json | python3 -c 'import json,sys; print(json.load(sys.stdin)["volumes"][sys.argv[1]]["name"])' "$key")
  test -n "$actual" && test "$actual" = "$expected" || { echo "Caddy volume mismatch; refusing to replace certificate storage."; exit 1; }
done
docker load -i "$release/images.tar"
arch=$(docker info --format '{{.Architecture}}')
case "$arch" in x86_64|amd64) platform=linux/amd64;; aarch64|arm64) platform=linux/arm64;; *) echo "Unsupported host architecture"; exit 1;; esac
for service in web worker; do
  actual=$(docker image inspect "dlr-$service:$tag" --format '{{.Os}}/{{.Architecture}}')
  test "$actual" = "$platform" || { echo "Image architecture does not match droplet"; exit 1; }
done
"${new[@]}" config --quiet
"${new[@]}" run --rm --no-deps --pull never worker node scripts/check-vapid.ts
"${new[@]}" run --rm --no-deps --pull never web node --input-type=module -e '
for (const name of ["APP_BASE_URL","AUTH0_DOMAIN","AUTH0_CLIENT_ID","AUTH0_CLIENT_SECRET","AUTH0_SECRET"]) {
 if (!process.env[name] || process.env[name].includes("replace-me")) throw Error("Missing/placeholder " + name);
}
if (new URL(process.env.APP_BASE_URL).protocol !== "https:") throw Error("APP_BASE_URL must use HTTPS");
'
cp compose.yaml "$release/previous-compose.yaml"
cp deploy/Caddyfile "$release/previous-Caddyfile"
docker inspect "$web" "$worker" --format '{{.Config.Image}} {{.Image}}' > "$release/previous-images.txt"
stage=backup
"${old[@]}" stop web worker
# SQLite online backup includes WAL contents. Store it outside the database volume.
docker run --rm --network none --user 0 --mount "type=volume,src=$volume,dst=/data" --mount "type=bind,src=$release,dst=/backup" "dlr-worker:$tag" node --input-type=module -e '
import { DatabaseSync, backup } from "node:sqlite";
import { chmodSync } from "node:fs";
const db = new DatabaseSync("/data/lightning-lane.sqlite", {readOnly:true});
try {
 await backup(db, "/backup/database-before.sqlite");
 const check = new DatabaseSync("/backup/database-before.sqlite", {readOnly:true});
 try { if (check.prepare("PRAGMA quick_check").get().quick_check !== "ok") throw Error("Backup integrity check failed"); }
 finally { check.close(); }
 chmodSync("/backup/database-before.sqlite", 0o600);
} finally { db.close(); }
'
stage=migrations
"${new[@]}" run --rm --no-deps --pull never worker node scripts/init-db.ts
stage=restart
cp "$release/compose.yaml" compose.yaml
cp "$release/Caddyfile" deploy/Caddyfile
started=$(date +%s)
"${old[@]}" up -d --no-build --pull never
"${old[@]}" exec -T caddy caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile
stage=health-check
healthy=false
for attempt in $(seq 1 30); do
  if "${old[@]}" exec -T web node -e 'fetch("http://127.0.0.1:3000/", {signal:AbortSignal.timeout(5000)}).then(r=>{if(r.status!==200)process.exit(1)}).catch(()=>process.exit(1))' &&
     "${old[@]}" exec -T worker node --input-type=module -e 'import {DatabaseSync} from "node:sqlite"; const db=new DatabaseSync("/data/lightning-lane.sqlite",{readOnly:true}); const row=db.prepare("SELECT heartbeat_at FROM worker_state WHERE id=1").get(); db.close(); if(!row || row.heartbeat_at < Number(process.argv[1])*1000)process.exit(1)' "$started"; then
    healthy=true
    break
  fi
  sleep 2
done
test "$healthy" = true
"${old[@]}" ps
echo "Deployed $tag. SQLite backup: $release/database-before.sqlite"
echo "Verify HTTPS login and push notifications from your phone. Keep backup copies off the droplet."
