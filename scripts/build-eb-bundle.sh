#!/usr/bin/env bash
# Builds the Elastic Beanstalk deploy bundle (zip) for the API.
#
# Prerequisites: `npm ci` at the repo root, then build core + api so that
# packages/core/dist and apps/api/dist exist:
#   npm run build --workspace @stamp/core
#   npm run build --workspace api
#
# Usage: scripts/build-eb-bundle.sh [output.zip]   (default: build/eb-bundle.zip)
#
# Bundle layout (npm workspaces, prebuilt — the EB instance only runs
# `npm install --omit=dev`, no compilation):
#   Procfile                       -> starts node apps/api/dist/main.js
#   .platform/hooks/predeploy/     -> runs scripts/migrate.mjs
#   package.json + package-lock.json (root; apps/web is intentionally absent —
#     npm workspace globs only match existing directories, so web deps are
#     never installed on the instance)
#   apps/api/{package.json,dist}
#   packages/core/{package.json,dist}
#   vendor/nestjs-throttler/       -> resolves the file: dependency
#   db/migrations/ + scripts/migrate.mjs
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="${1:-${ROOT}/build/eb-bundle.zip}"
case "${OUT}" in /*) ;; *) OUT="${PWD}/${OUT}" ;; esac

for f in \
  "${ROOT}/apps/api/dist/main.js" \
  "${ROOT}/packages/core/dist/index.js"; do
  if [ ! -f "$f" ]; then
    echo "error: $f missing — build core and api first (see header)" >&2
    exit 1
  fi
done

STAGE="$(mktemp -d)"
trap 'rm -rf "${STAGE}"' EXIT

mkdir -p "${STAGE}/apps/api" "${STAGE}/packages/core" "${STAGE}/vendor" \
  "${STAGE}/db" "${STAGE}/scripts"

cp "${ROOT}/Procfile" "${STAGE}/Procfile"
cp -R "${ROOT}/.platform" "${STAGE}/.platform"
chmod +x "${STAGE}"/.platform/hooks/*/*.sh

cp "${ROOT}/package.json" "${ROOT}/package-lock.json" "${STAGE}/"

cp "${ROOT}/apps/api/package.json" "${STAGE}/apps/api/"
cp -R "${ROOT}/apps/api/dist" "${STAGE}/apps/api/dist"

cp "${ROOT}/packages/core/package.json" "${STAGE}/packages/core/"
cp -R "${ROOT}/packages/core/dist" "${STAGE}/packages/core/dist"

# vendored file: dependency — copy only what npm needs (skip node_modules if any)
mkdir -p "${STAGE}/vendor/nestjs-throttler"
cp "${ROOT}/vendor/nestjs-throttler/package.json" "${STAGE}/vendor/nestjs-throttler/"
cp -R "${ROOT}/vendor/nestjs-throttler/dist" "${STAGE}/vendor/nestjs-throttler/dist"
[ -f "${ROOT}/vendor/nestjs-throttler/LICENSE" ] && cp "${ROOT}/vendor/nestjs-throttler/LICENSE" "${STAGE}/vendor/nestjs-throttler/"

cp -R "${ROOT}/db/migrations" "${STAGE}/db/migrations"
cp "${ROOT}/scripts/migrate.mjs" "${STAGE}/scripts/"

mkdir -p "$(dirname "${OUT}")"
rm -f "${OUT}"
# zip from inside the stage dir so paths are bundle-relative; include dotfiles (.platform)
(cd "${STAGE}" && zip -q -r "${OUT}" . -x '*.DS_Store')

echo "wrote ${OUT} ($(du -h "${OUT}" | cut -f1))"
