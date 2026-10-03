# Handoff — 2026-10-03

## Resumed verification completed — 2026-10-03

This status supersedes the unfinished checklist below, which is retained as history.

- Added tests/deploy-flow.test.mjs. Six Linux tests exercise the actual Bash helper
  with mocked Docker commands: success, SQLite volume mismatch, Caddy volume
  mismatch, configuration failure, backup failure, and migration failure.
  They verify ordering, failure stopping points, and preservation of .env/Compose.
- Added a 5-second timeout to the web health-check fetch.
- Built fresh release **releases/2026-10-03-ready-01** with final safeguards included.
  Use this bundle instead of the earlier deploy-scripts test bundle.
- 30 app/release tests passed on Windows; the six Linux-only tests passed separately
  in a Linux container. TypeScript and both production Docker builds passed.
- Actual new images were started in disposable, network-disabled local containers:
  web HTTP 200, worker fresh heartbeat, SQLite migrations, online backup integrity
  and preservation of heartbeat data all passed. Test containers were removed.
- Deployment dry-run and local bundle checksums passed.
- No production connection, deployment, commit or push was performed.
- The full SSH/SCP/Compose deployment has NOT been exercised against a real droplet.
  Docker commands in the failure-ordering suite are mocked; runtime smoke checks
  use real Docker but do not test Caddy TLS or Auth0 login.
- Remaining operational prerequisites: working SSH from the deploying computer
  and confirmation of the existing Compose project name with docker compose ls.
- Scripts are ready for the first supervised production deployment when requested.
  See docs/deployment.md for commands and failure recovery.

## Original request
Create a local production build script and a separate deployment script for the
DigitalOcean app. User paused work to turn off the computer. Resume verification
before declaring the scripts complete. Do not deploy automatically.

## Repository / environment
- Actual repo: C:/Users/tfcma/code/dlr_lightning_lane
- This chat's workspace is still the old C:/Users/tfcma/Documents/ChatGPT/DLR Lightning Lane 2.
  Writes to actual repo required elevated tool permission.
- GitHub remote: git@github.com:sdkraemer/dlr_lightning_lane.git
- Production: https://dlrll.com, root@209.38.73.15.
- User confirmed production Compose and .env are in ~/dlr-lightning-lane
  (default for root: /root/dlr-lightning-lane).
- Existing Compose project name is NOT confirmed. Require --project; user can
  inspect docker compose ls. Likely dlr-lightning-lane, but don't assume when deploying.
- SSH from this computer previously failed publickey. Surface Laptop had access.
- Docker Desktop works, Linux engine. Executable:
  C:/Users/tfcma/AppData/Local/Programs/DockerDesktop/resources/bin/docker.exe
- Node 24.21.0. Local Prettier package was missing; attempted formatting did not run.

## Files added / changed this turn
- scripts/release-common.mjs: strict argument parsing, Docker discovery, command
  runner, SHA-256 streaming, SSH shell quoting.
- scripts/build-release.mjs: tests/typecheck, sequential buildx Linux web and worker
  builds, docker image save, release bundle with pinned Compose images, Caddy config,
  remote deployment helper, manifest and checksums. Defaults linux/amd64.
- scripts/deploy-release.mjs: requires --release and --project, defaults host/path
  above; optional --identity/--port/--dry-run. Validates hashes, uses SSH/SCP with
  strict known-host checks and batch auth, uploads unique release dir and invokes helper.
- deploy/apply-release.sh: remote flock; existing running project and volume checks;
  image load/architecture check; Auth0 and VAPID preflight; stops web/worker;
  SQLite online backup + quick_check saved in release directory; migrations;
  pinned Compose/Caddy installation; restart; Caddy reload; web and worker
  heartbeat checks. No automatic rollback, volume deletion, image pruning or .env replacement.
- tests/release.test.mjs: parser/quoting checks and dry-run/tamper rejection checks.
- package.json: release:build, release:deploy; test now includes *.test.mjs.
- .gitignore and .dockerignore: exclude releases and .deploy.
- docs/deployment.md: rewritten with usage, SSH prerequisites, recovery, existing
  volume preservation, backup and swap instructions.

## Verification completed
- Actual local release build succeeded:
  node scripts/build-release.mjs --tag 2026-10-03-deploy-scripts
- 28 existing app tests passed, TypeScript checks passed, both Docker images built,
  Next.js production compilation passed, images.tar and bundle generated.
- 2 new release script tests passed separately.
- Remote helper passed bash -n in Linux Docker.
- deploy --dry-run against generated bundle succeeded; no SSH/deployment performed.
- Build process session 26629 completed; no background task from this work remains.

## Important unfinished details
- The generated bundle releases/2026-10-03-deploy-scripts predates the final
  Caddy volume preservation guard added to deploy/apply-release.sh.
  It also predates the new test file / package test command.
  Build a NEW tag after final review to capture everything; do not deploy this old test bundle.
- Inspect the newly added Caddy volume guard (bash syntax passed, runtime not tested).
- Review remote helper end-to-end, particularly Compose volume/project resolution,
  backup, migration failure handling, and health verification. Actual remote flow
  is not tested. Prefer isolated local containers/fixtures if further testing is needed.
- Consider verifying local Docker runtime startup (build success alone doesn't validate runtime).
- Formatter failed only because local node_modules/prettier is missing. Don't claim
  formatting passed. Can format after installing dependencies or leave consistent style.
- No commits, pushes, production changes or actual SSH calls made this turn.
- Use new unique release tag when rebuilding. Build refuses existing bundle directory.
- No need for another approval to write requested code, but filesystem restrictions
  still require escalated tool writes to the moved repo.
- Existing unrelated changes MUST be preserved; do not reset files or restore HEAD.

## Existing uncommitted work predating this request
VAPID config validation and daily farthest offered return time feature:
apps/web/app/api/push/route.ts, dashboard.tsx, styles.css, next-env.d.ts,
docs/architecture.md, packages/core/dashboard.ts, push.ts, core.test.ts,
users.test.ts; new offer-history.ts, vapid.ts, check-vapid.ts,
offer-history.test.ts and vapid.test.ts.
These passed app tests/typecheck/build previously. They are included in local builds.
Authentication is now multi-user; AUTH0_ALLOWED_SUB only assigns legacy data,
not an access restriction.

## Commands after resuming
From actual repository:
    node --test tests/release.test.mjs
    npm run release:build -- --tag NEW-UNIQUE-TAG
    npm run release:deploy -- --release releases/NEW-UNIQUE-TAG --project EXISTING_PROJECT --dry-run

Only run the real deploy when requested and SSH/project readiness is established.
