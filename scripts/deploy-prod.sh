#!/usr/bin/env bash
set -euo pipefail

MODE="${1:-full}"
REMOTE_HOST="${DEPLOY_REMOTE_HOST:?DEPLOY_REMOTE_HOST is required}"
REMOTE_USER="${DEPLOY_REMOTE_USER:?DEPLOY_REMOTE_USER is required}"
REMOTE_PASSWORD="${DEPLOY_REMOTE_PASSWORD:-}"
REMOTE_DIR="${DEPLOY_REMOTE_DIR:-/var/www/game}"
REMOTE_PM2_APP="${DEPLOY_PM2_APP:-game-backend}"
REMOTE_HEALTHCHECK_URL="${DEPLOY_HEALTHCHECK_URL:-http://localhost:3000/api/health}"
REMOTE_SSH_KEY_PATH="${DEPLOY_SSH_KEY_PATH:-}"

if [[ -z "$REMOTE_PASSWORD" && -z "$REMOTE_SSH_KEY_PATH" ]]; then
  echo "Set DEPLOY_REMOTE_PASSWORD or DEPLOY_SSH_KEY_PATH before running deploy." >&2
  exit 1
fi

case "$MODE" in
  full)
    REMOTE_COMMAND=$(cat <<EOF
bash -lc 'set -euo pipefail
cd "$REMOTE_DIR"
git pull origin main
cd backend
npm run build
cd ../Frontend
CI= npm run build
cd ..
pm2 restart "$REMOTE_PM2_APP"
for attempt in 1 2 3 4 5 6 7 8 9 10; do
  http_code=\$(curl -s -o /dev/null -w "%{http_code}" "$REMOTE_HEALTHCHECK_URL" || true)
  if [ "\$http_code" = "200" ]; then
    printf "__DEPLOY_HTTP__%s\n" "\$http_code"
    exit 0
  fi
  sleep 3
done
printf "__DEPLOY_HTTP__%s\n" "\$http_code"
exit 1'
EOF
)
    ;;
  frontend-only)
    REMOTE_COMMAND=$(cat <<EOF
bash -lc 'set -euo pipefail
cd "$REMOTE_DIR"
git pull origin main
cd Frontend
CI= npm run build
cd ..
pm2 restart "$REMOTE_PM2_APP"
for attempt in 1 2 3 4 5 6 7 8 9 10; do
  http_code=\$(curl -s -o /dev/null -w "%{http_code}" "$REMOTE_HEALTHCHECK_URL" || true)
  if [ "\$http_code" = "200" ]; then
    printf "__DEPLOY_HTTP__%s\n" "\$http_code"
    exit 0
  fi
  sleep 3
done
printf "__DEPLOY_HTTP__%s\n" "\$http_code"
exit 1'
EOF
)
    ;;
  *)
    echo "Usage: $0 [full|frontend-only]" >&2
    exit 1
    ;;
esac

export REMOTE_COMMAND
export REMOTE_PASSWORD
export REMOTE_HOST
export REMOTE_USER
export REMOTE_SSH_KEY_PATH

if [[ -n "$REMOTE_SSH_KEY_PATH" ]]; then
  ssh -tt -i "$REMOTE_SSH_KEY_PATH" -o StrictHostKeyChecking=accept-new "$REMOTE_USER@$REMOTE_HOST" "$REMOTE_COMMAND"
else
  expect <<'EOF'
  set timeout 300
  log_user 1
  set password $env(REMOTE_PASSWORD)
  set remote_command $env(REMOTE_COMMAND)
  set remote_host $env(REMOTE_HOST)
  set remote_user $env(REMOTE_USER)
  spawn ssh -tt -o StrictHostKeyChecking=accept-new ${remote_user}@${remote_host} $remote_command
  expect {
    "password:" { send -- "$password\r"; exp_continue }
    eof
  }
  catch wait result
  exit [lindex $result 3]
EOF
fi
