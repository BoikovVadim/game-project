#!/bin/bash
set -euo pipefail

APP_URL="${APP_URL:-http://localhost:3000}"
TOURNAMENT_ID="${TOURNAMENT_ID:?TOURNAMENT_ID is required}"
USER_ID="${USER_ID:?USER_ID is required}"
AUTH_TOKEN="${AUTH_TOKEN:-}"

if [[ -z "$AUTH_TOKEN" ]]; then
  echo "AUTH_TOKEN is required. Export a valid bearer token before running this script." >&2
  exit 1
fi

curl -sS -m 15 \
  "${APP_URL%/}/tournaments/${TOURNAMENT_ID}/training-state" \
  -H "Authorization: Bearer ${AUTH_TOKEN}" | python3 -m json.tool
