#!/usr/bin/env bash
# Example only — replace APP_HOST and use a secret manager for CLEANUP_JOB_SECRET.
set -euo pipefail
APP_HOST="${APP_HOST:?set APP_HOST to your App Hosting URL}"
: "${CLEANUP_JOB_SECRET:?set CLEANUP_JOB_SECRET}"

curl -fsS -X POST "${APP_HOST%/}/api/cleanup/media" \
  -H "Content-Type: application/json" \
  -H "x-cleanup-secret: ${CLEANUP_JOB_SECRET}" \
  -d '{}'

echo
echo "Cleanup request completed."
