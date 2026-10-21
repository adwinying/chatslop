# Convex backend and TanStack Start in one container

Ticket: #3. Researched 2026-10-21 against convex-backend `95d8719` (2026-10-16), latest precompiled release `precompiled-2026-10-10-72ce13c`.

## Answer

Yes. Build `FROM ghcr.io/convex/convex-backend:<rev>`, add the built Start app, and replace the entrypoint with a small bash script. The script starts the backend, waits for it to be healthy, runs `convex deploy` against it, starts the Start server, and exits when either process dies. Use one volume at `/convex/data`, SQLite, and local file storage. Leave the dashboard out of the image.

Convex does not ship this layout. Its docs assume separate backend, dashboard, and frontend services ([README][readme]). Everything below is built from documented pieces, but the combination is untested.

## Findings

### The official backend image already fits

- Base `ubuntu:noble`, with Node and npm copied in from the build stage, plus `curl`. Ships `convex-local-backend`, `generate_key`, `run_backend.sh`, `read_credentials.sh`, `generate_admin_key.sh`. Workdir `/convex`, `VOLUME /convex/data`, entrypoint `./run_backend.sh`, exposes 3210 and 3211 ([Dockerfile.backend][dockerfile]).
- Node is the `.nvmrc` version (`22.22.2`). The backend uses `node` on `PATH` for `"use node"` actions and accepts v20, v22, or v24 ([node_executor/local.rs][node-exec]). The Start server can share that same Node.
- `run_backend.sh` maps env vars to flags: `POSTGRES_URL`/`MYSQL_URL` select the DB (SQLite at `$DATA_DIR/db.sqlite3` otherwise), all six `S3_*` buckets enable S3 (local `$DATA_DIR/storage` otherwise), and `CONVEX_CLOUD_ORIGIN`/`CONVEX_SITE_ORIGIN` set the public URLs. It `exec`s the binary ([run_backend.sh][run-backend]). Call it from our entrypoint instead of reimplementing it.
- Precompiled `convex-local-backend` binaries for linux x86_64/aarch64 are also published as GitHub releases, along with a `dashboard.zip` ([releases][releases]). Basing on the image is simpler because it also brings the scripts and Node.

### Process model

- Docker documents three options for multiple processes: `--init`, a wrapper script with `wait -n`, or supervisord. It calls supervisord "more involved" ([Docker docs][docker-multi]).
- **Pitfall:** the backend only handles Ctrl-C (SIGINT) for graceful shutdown ([main.rs#L208][main-rs]). The official compose file sets `stop_signal: SIGINT` for this reason ([docker-compose.yml][compose]). SIGTERM kills it without running destructors, and each stop then leaks temp dirs onto the volume ([#608][i608]). The wrapper must turn TERM into INT for the backend.
- Nitro shuts down gracefully on both SIGINT and SIGTERM ([Nitro node docs][nitro-node]), so forwarding INT to both processes works.
- The backend spawns Node child processes for actions (`kill_on_drop`) ([node_executor/local.rs][node-exec]). Run with `init: true` (tini) so a PID 1 reaps them.

### Ports and URLs

- Backend: 3210 serves the API, the sync WebSocket, and HTTP actions under `/http/` ([router.rs#L417][router]). 3211 is a separate HTTP-actions port ([config.rs][config]). Fly's guide exposes only 3210 and sets `CONVEX_SITE_ORIGIN=<url>/http` ([fly README][fly]). Do the same and leave 3211 unpublished.
- The browser opens the WebSocket at `<CONVEX_URL>/api/<version>/sync` ([client.ts#L339][client]), so 3210 must be publicly reachable. Give it its own hostname (`api.<domain>`), as in [hosting_on_own_infra.md][own-infra]. Serving it under a path prefix on the app hostname looks possible from the client code, but storage and action URLs are built from `CONVEX_CLOUD_ORIGIN`. Untested.
- Start server (Nitro `node-server` output): `node .output/server/index.mjs`. Nitro reads `PORT`/`NITRO_PORT` (default 3000) and `HOST`/`NITRO_HOST` ([TanStack hosting][start-hosting], [Nitro node docs][nitro-node]). Server-side code can reach the backend at `http://127.0.0.1:3210`.
- **Pitfall:** `VITE_*` vars are inlined into the client bundle at build time ([TanStack env vars][start-env]). Either build the image for one public `VITE_CONVEX_URL`, or have the server hand the URL to the client at runtime.

### Persistent storage

- One volume at `/convex/data` holds `credentials/`, `db.sqlite3`, `storage/` (files), and `tmp/` ([run_backend.sh][run-backend], [read_credentials.sh][read-creds]).
- SQLite is the default. Convex recommends Postgres or MySQL only for production workloads that need guaranteed uptime, and moving between them takes an export and import ([postgres_or_mysql.md][pg]). SQLite fits a group of fewer than 20 users.
- **Pitfall:** `TMPDIR` defaults to `/convex/data/tmp`, and backend temp dirs survive SIGTERM, SIGKILL, and OOM kills. One production report found 13.8 GB of them ([#608][i608]). Sweep `.tmp*` there at startup, which is the fix that issue proposes.

### Instance secret and admin key

- `read_credentials.sh` takes `INSTANCE_SECRET` from env, then from `credentials/instance_secret`, then generates one with `openssl rand -hex 32`. It always writes the value back to the file. `INSTANCE_NAME` defaults to `convex-self-hosted` ([read_credentials.sh][read-creds]).
- The secret is the root credential. Rotating it invalidates every key and session ([running_binary_directly.md][binary]). Since the backend has no fallback secret anymore (`854910c`), `--instance-secret` is required ([config.rs][config]).
- Admin keys come from name + secret through `./generate_key` (what `generate_admin_key.sh` runs) or `convex-local-backend keygen admin-key` (added `0ba4a76`, 2026-05) ([config.rs][config]). The entrypoint can mint one at boot, so no admin key needs storing. For remote CLI or dashboard use, run `docker compose exec app ./generate_admin_key.sh`.
- Let the volume own the secret: leave `INSTANCE_SECRET` unset and the first boot generates and persists it. If you set it in env, it overwrites the file on every boot.
- The secret is passed on argv, so it shows in `ps` inside the container ([#595][i595]).

### Deploying Convex functions: boot, not build

- `convex deploy` pushes to a running backend (`CONVEX_SELF_HOSTED_URL` + `CONVEX_SELF_HOSTED_ADMIN_KEY`). There is no dev/prod distinction on a self-hosted instance ([README][readme], [fly README][fly]). `docker build` has no backend or volume to push to, so deploy at boot, after `/version` responds (the compose healthcheck uses that endpoint ([docker-compose.yml][compose])).
- At boot, use `--typecheck disable --codegen disable` because CI already ran both ([command.ts][command]). The image still needs the `convex/` sources and the `convex` npm package so the CLI can bundle.
- **Pitfall:** non-TTY confirmation prompts crash the CLI, for example on large index backfills or deletions and staged validator removal ([prompts.ts][prompts], [deploy2.ts][deploy2]). Let the boot fail loudly, or pass `--skip-large-indexes-check` / `--allow-unstaging-schema` on purpose.
- **Pitfall:** one report saw ~4.5 minutes of query rejections after `convex deploy` whenever a WebSocket session was open, and a Convex engineer acknowledged the post-deploy load spike ([#466][i466]). Open tabs reconnect to 3210 before the boot deploy finishes. This matters little for fewer than 20 users, but is worth knowing.
- Self-hosted memory grows with each push ([#563][i563], [#597][i597]). Pushing once per boot keeps that bounded.
- Convex deployment env vars (e.g. for Better Auth, #4) live in the backend DB, not the container env. Set them at boot with `convex env set` if they come from container env ([upgrading.md][upgrading]).

### Dashboard

- Optional. It is a separate Next.js image (`ghcr.io/convex/convex-dashboard`) that runs in the browser against `NEXT_PUBLIC_DEPLOYMENT_URL` and logs in with an admin key ([docker-compose.yml][compose], [fly README][fly]).
- Keep it out of the monolith. When needed, run it on a laptop: `docker run -e NEXT_PUBLIC_DEPLOYMENT_URL=https://api.<domain> -p 6791:6791 ghcr.io/convex/convex-dashboard:<same rev>` ([fly README][fly]). Dashboard and backend versions must match ([CHANGELOG][changelog]). The `npx convex` CLI (`data`, `logs`, `env`, `run`, `export`) covers most needs without it.

### Upgrades and migrations

- Pin the image to a revision rather than `:latest` ([docker-compose.yml][compose]). Bump the `convex` npm package at the same time: a newer CLI has broken deploys against an older backend ([#258][i258]).
- In-place upgrade: the new binary migrates the DB on start. Watch for `MigrationComplete(N)` in the logs, and run `npx convex export` first ([upgrading.md][upgrading]).
- Fallback: export, save env vars (`convex env list --include-values`), upgrade, `convex import --replace-all`, restore env vars ([upgrading.md][upgrading]). The docs describe no downgrade path, so the export is the rollback.
- The docs list no memory or CPU requirements for self-hosting yet ([#225][i225]).

### Known examples

- Official: compose (backend + dashboard as two services), Fly (two apps), Railway, devcontainer ([self-hosted/][self-hosted]). None put the app in the same container.
- I found no first-party or issue-tracker example of a backend + frontend monolith.

## Recommended layout

```
image:   FROM ghcr.io/convex/convex-backend:<rev>   (Node 22 + backend + scripts)
         + /app/.output        (vite build, Nitro node-server)
         + /app/convex, /app/node_modules (for `convex deploy` at boot)
         ENTRYPOINT ["/app/entrypoint.sh"]
compose: init: true, stop_signal: SIGINT, stop_grace_period: 30s
         volume convex-data:/convex/data
         env  CONVEX_CLOUD_ORIGIN=https://api.<domain>
              CONVEX_SITE_ORIGIN=https://api.<domain>/http
              DISABLE_BEACON=1  REDACT_LOGS_TO_CLIENT=1
         ports 3000 (app) and 3210 (Convex) to the reverse proxy; 3211 unpublished
proxy:   <domain> -> :3000, api.<domain> -> :3210 (WebSocket upgrade on)
```

Entrypoint sketch (untested):

```bash
#!/usr/bin/env bash
set -euo pipefail
cd /convex
find /convex/data/tmp -mindepth 1 -maxdepth 1 -name '.tmp*' -exec rm -rf {} + 2>/dev/null || true

./run_backend.sh & backend=$!
trap 'kill -INT $backend ${app:-} 2>/dev/null || true' TERM INT

until curl -sf http://127.0.0.1:3210/version >/dev/null; do
  kill -0 "$backend" || exit 1
  sleep 1
done

source ./read_credentials.sh
export CONVEX_SELF_HOSTED_URL=http://127.0.0.1:3210
CONVEX_SELF_HOSTED_ADMIN_KEY=$(./generate_key "$INSTANCE_NAME" "$INSTANCE_SECRET")
export CONVEX_SELF_HOSTED_ADMIN_KEY
(cd /app && npx convex deploy --typecheck disable --codegen disable)

node /app/.output/server/index.mjs & app=$!
set +e
wait -n
status=$?
kill -INT "$backend" "$app" 2>/dev/null
wait
exit "$status"
```

Either process dying stops the container, and the restart policy (`unless-stopped`) restarts both. This beats supervisord, which restarts one child in place and hides the failure.

Open for #9: Postgres instead of SQLite, the build-time vs runtime source of `VITE_CONVEX_URL`, and backups (listed under "Not yet specified" on the map).

[readme]: https://github.com/get-convex/convex-backend/blob/95d8719cb6931cd2322453bb900dfcd5a732fe81/self-hosted/README.md
[self-hosted]: https://github.com/get-convex/convex-backend/tree/95d8719cb6931cd2322453bb900dfcd5a732fe81/self-hosted
[dockerfile]: https://github.com/get-convex/convex-backend/blob/95d8719cb6931cd2322453bb900dfcd5a732fe81/self-hosted/docker-build/Dockerfile.backend
[run-backend]: https://github.com/get-convex/convex-backend/blob/95d8719cb6931cd2322453bb900dfcd5a732fe81/self-hosted/docker-build/run_backend.sh
[read-creds]: https://github.com/get-convex/convex-backend/blob/95d8719cb6931cd2322453bb900dfcd5a732fe81/self-hosted/docker-build/read_credentials.sh
[compose]: https://github.com/get-convex/convex-backend/blob/95d8719cb6931cd2322453bb900dfcd5a732fe81/self-hosted/docker/docker-compose.yml
[binary]: https://github.com/get-convex/convex-backend/blob/95d8719cb6931cd2322453bb900dfcd5a732fe81/self-hosted/advanced/running_binary_directly.md
[own-infra]: https://github.com/get-convex/convex-backend/blob/95d8719cb6931cd2322453bb900dfcd5a732fe81/self-hosted/advanced/hosting_on_own_infra.md
[pg]: https://github.com/get-convex/convex-backend/blob/95d8719cb6931cd2322453bb900dfcd5a732fe81/self-hosted/advanced/postgres_or_mysql.md
[upgrading]: https://github.com/get-convex/convex-backend/blob/95d8719cb6931cd2322453bb900dfcd5a732fe81/self-hosted/advanced/upgrading.md
[fly]: https://github.com/get-convex/convex-backend/blob/95d8719cb6931cd2322453bb900dfcd5a732fe81/self-hosted/advanced/fly/README.md
[changelog]: https://github.com/get-convex/convex-backend/blob/95d8719cb6931cd2322453bb900dfcd5a732fe81/self-hosted/CHANGELOG.md
[config]: https://github.com/get-convex/convex-backend/blob/95d8719cb6931cd2322453bb900dfcd5a732fe81/crates/local_backend/src/config.rs
[main-rs]: https://github.com/get-convex/convex-backend/blob/95d8719cb6931cd2322453bb900dfcd5a732fe81/crates/local_backend/src/main.rs#L208
[router]: https://github.com/get-convex/convex-backend/blob/95d8719cb6931cd2322453bb900dfcd5a732fe81/crates/local_backend/src/router.rs#L417
[node-exec]: https://github.com/get-convex/convex-backend/blob/95d8719cb6931cd2322453bb900dfcd5a732fe81/crates/node_executor/src/local.rs#L129-L200
[client]: https://github.com/get-convex/convex-backend/blob/95d8719cb6931cd2322453bb900dfcd5a732fe81/npm-packages/convex/src/browser/sync/client.ts#L339
[command]: https://github.com/get-convex/convex-backend/blob/95d8719cb6931cd2322453bb900dfcd5a732fe81/npm-packages/convex/src/cli/lib/command.ts#L344-L392
[prompts]: https://github.com/get-convex/convex-backend/blob/95d8719cb6931cd2322453bb900dfcd5a732fe81/npm-packages/convex/src/cli/lib/utils/prompts.ts#L129-L151
[deploy2]: https://github.com/get-convex/convex-backend/blob/95d8719cb6931cd2322453bb900dfcd5a732fe81/npm-packages/convex/src/cli/lib/deploy2.ts#L509-L519
[releases]: https://github.com/get-convex/convex-backend/releases/tag/precompiled-2026-10-10-72ce13c
[i225]: https://github.com/get-convex/convex-backend/issues/225
[i258]: https://github.com/get-convex/convex-backend/issues/258
[i466]: https://github.com/get-convex/convex-backend/issues/466
[i563]: https://github.com/get-convex/convex-backend/issues/563
[i595]: https://github.com/get-convex/convex-backend/issues/595
[i597]: https://github.com/get-convex/convex-backend/issues/597
[i608]: https://github.com/get-convex/convex-backend/issues/608
[docker-multi]: https://docs.docker.com/engine/containers/multi-service_container/
[nitro-node]: https://github.com/nitrojs/nitro/blob/main/docs/2.deploy/10.runtimes/1.node.md
[start-hosting]: https://tanstack.com/start/latest/docs/framework/react/guide/hosting
[start-env]: https://tanstack.com/start/latest/docs/framework/react/guide/environment-variables
