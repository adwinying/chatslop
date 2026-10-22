#!/usr/bin/env bash
# Runs the Convex backend and the Start server in one container (ADR 0001).
# Boots Convex, deploys and seeds it, then serves the app. When either process
# exits, the container stops.
set -euo pipefail
shopt -s nullglob
# A Convex CLI prompt then crashes the boot instead of hanging it.
exec </dev/null

CONVEX_URL=http://127.0.0.1:3210
DATA=/convex/data
BACKUPS=$DATA/backups
BACKUP_INTERVAL_SECONDS=${BACKUP_INTERVAL_SECONDS:-86400}
KEEP_BACKUPS=7
# Convex-side env, reapplied on every boot so the env file stays the source of truth.
CONVEX_ENV=(SITE_URL BETTER_AUTH_SECRET ADMIN_EMAIL ADMIN_USERNAME ADMIN_PASSWORD)
# Optional; unset ones are removed from Convex too.
CONVEX_ENV_OPTIONAL=(TRUSTED_ORIGINS MOCK_MODEL)

for name in "${CONVEX_ENV[@]}"; do
  : "${!name:?$name is required}"
done

# Unclean stops leak backend temp dirs onto the volume.
rm -rf "$DATA"/tmp/.tmp*

cd /convex
./run_backend.sh &
backend=$!

# The backend only shuts down cleanly on SIGINT, so TERM is forwarded as INT.
stop() {
  kill -INT "$backend" 2>/dev/null || true
  kill -TERM ${app:-} ${backup_loop:-} 2>/dev/null || true
  wait
}
trap stop EXIT
trap 'exit 0' TERM INT

until curl -fs "$CONVEX_URL/version" >/dev/null; do
  kill -0 "$backend" 2>/dev/null || exit 1
  sleep 1
done

# In a subshell, so the instance secret stays out of the app's env.
admin_key=$(source ./read_credentials.sh && ./generate_key "$INSTANCE_NAME" "$INSTANCE_SECRET")
cd /app

convex() {
  CONVEX_SELF_HOSTED_URL=$CONVEX_URL CONVEX_SELF_HOSTED_ADMIN_KEY=$admin_key \
    node_modules/.bin/convex "$@"
}

# Storage URLs go through the /convex proxy. convexSite stays on loopback, where
# Better Auth's issuer and JWKS live.
curl -fsS "$CONVEX_URL/api/update_canonical_url" \
  -H "Authorization: Convex $admin_key" \
  -H 'Content-Type: application/json' \
  -d "{\"requestDestination\":\"convexCloud\",\"url\":\"${SITE_URL%/}/convex\"}" \
  >/dev/null

for name in "${CONVEX_ENV[@]}"; do
  # Through stdin, so the value stays off argv.
  printf '%s' "${!name}" | convex env set "$name"
done
for name in "${CONVEX_ENV_OPTIONAL[@]}"; do
  if [[ -n ${!name:-} ]]; then
    printf '%s' "${!name}" | convex env set "$name"
  else
    convex env remove "$name" >/dev/null
  fi
done
convex deploy --typecheck disable --codegen disable
convex run seed:firstAdmin
convex run seed:providers

node .output/server/index.mjs &
app=$!

# kopia ships the exports; the live database and files change under it.
cat >"$DATA/.kopiaignore" <<'EOF'
/db.sqlite3*
/storage/
/tmp/
EOF

# Called as `if ! backup`, which disables errexit inside it.
backup() {
  local stamp zips
  stamp=$(date -u +%Y%m%dT%H%M%SZ)
  # Partial exports stay hidden until complete.
  rm -f "$BACKUPS"/.*.zip
  convex export --include-file-storage --path "$BACKUPS/.$stamp.zip" || return
  mv "$BACKUPS/.$stamp.zip" "$BACKUPS/$stamp.zip" || return
  zips=("$BACKUPS"/*.zip)
  if ((${#zips[@]} > KEEP_BACKUPS)); then
    rm -f -- "${zips[@]:0:${#zips[@]}-KEEP_BACKUPS}"
  fi
}

# A backup is due one interval after the newest, so restarts don't reset the clock.
mkdir -p "$BACKUPS"
while :; do
  zips=("$BACKUPS"/*.zip)
  due=0
  if ((${#zips[@]})); then
    due=$(($(stat -c %Y "${zips[-1]}") + BACKUP_INTERVAL_SECONDS - $(date +%s)))
  fi
  if ((due > 0)); then sleep "$due"; fi
  if ! backup; then
    echo "Backup failed; retrying in $BACKUP_INTERVAL_SECONDS s" >&2
    sleep "$BACKUP_INTERVAL_SECONDS"
  fi
done &
backup_loop=$!

# A dead backup loop also stops the container, rather than backups quietly ending.
wait -n "$backend" "$app" "$backup_loop"
