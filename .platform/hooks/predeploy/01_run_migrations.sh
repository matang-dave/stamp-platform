#!/bin/bash
# Elastic Beanstalk predeploy hook: apply pending SQL migrations before the
# new application version starts serving traffic.
#
# Runs in /var/app/staging AFTER the platform's `npm install --omit=dev`
# (so node_modules and the `postgres` driver are present) and BEFORE the app
# is promoted to /var/app/current and (re)started.
#
# MVP assumption: single-instance environment. With multiple instances this
# hook runs on every instance concurrently and migrations could race; the
# per-file transaction + primary-key insert makes a race fail loudly rather
# than corrupt, but scale-out deploys should move migrations to a one-off
# step (documented in docs/deploy-aws.md).
set -euo pipefail

APP_DIR="$(cd "$(dirname "$0")/../../.." && pwd)"

# EB exposes environment properties to platform hooks on AL2023, but fall
# back to get-config in case DATABASE_URL isn't in the hook's environment.
if [ -z "${DATABASE_URL:-}" ] && [ -x /opt/elasticbeanstalk/bin/get-config ]; then
  DATABASE_URL="$(/opt/elasticbeanstalk/bin/get-config environment -k DATABASE_URL)"
  export DATABASE_URL
fi

echo "[migrate] applying db/migrations from ${APP_DIR}"
node "${APP_DIR}/scripts/migrate.mjs"
echo "[migrate] done"
