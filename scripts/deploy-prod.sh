#!/usr/bin/env bash
set -euo pipefail

MODE="${1:-full}"
REMOTE_HOST="95.163.226.154"
REMOTE_USER="root"
REMOTE_PASSWORD="ffsP7Tb7KBjxeHXw"
REMOTE_DIR="/var/www/game"

case "$MODE" in
  full)
    REMOTE_COMMAND=$(cat <<'EOF'
bash -lc 'set -euo pipefail
cd /var/www/game
git pull origin main
cd backend
npm run build
cd ../Frontend
CI= npm run build
cd ..
pm2 restart all
sleep 8
http_code=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/)
printf "__DEPLOY_HTTP__%s\n" "$http_code"
test "$http_code" = "200"'
EOF
)
    ;;
  frontend-only)
    REMOTE_COMMAND=$(cat <<'EOF'
bash -lc 'set -euo pipefail
cd /var/www/game
git pull origin main
cd Frontend
CI= npm run build
cd ..
pm2 restart all
sleep 8
http_code=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/)
printf "__DEPLOY_HTTP__%s\n" "$http_code"
test "$http_code" = "200"'
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

expect <<'EOF'
set timeout 300
log_user 1
set password $env(REMOTE_PASSWORD)
set remote_command $env(REMOTE_COMMAND)
spawn ssh -tt -o StrictHostKeyChecking=no root@95.163.226.154 $remote_command
expect {
  "password:" { send -- "$password\r"; exp_continue }
  eof
}
catch wait result
exit [lindex $result 3]
EOF
