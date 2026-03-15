#!/bin/bash
set -euo pipefail

# ============================================
# LegendGames — резервный server-side update
# Канонический путь деплоя: локально `npm run deploy:prod`.
# Этот файл оставлен как аварийный серверный fallback и должен
# повторять тот же runtime contract: `git pull origin main`,
# backend build, frontend build с `CI=`, pm2 restart, health-check.
# ============================================

APP_DIR="/var/www/game"
HEALTH_URL="${DEPLOY_HEALTHCHECK_URL:-http://localhost:3000/api/health}"

echo "=== Обновление LegendGames ==="

cd "$APP_DIR"
echo "Получаю изменения из GitHub..."
git pull origin main
npm install

echo "Пересборка бэкенда..."
cd backend && npm install && npm run build && cd ..

echo "Пересборка фронтенда..."
cd Frontend && npm install && CI= npm run build && cd ..

echo "Перезапуск приложения..."
if pm2 describe game-backend >/dev/null 2>&1; then
  pm2 restart game-backend --update-env
else
  pm2 start ecosystem.config.js --only game-backend
fi

echo "Проверяю health-check..."
for attempt in 1 2 3 4 5 6 7 8 9 10; do
  http_code=$(curl -s -o /dev/null -w "%{http_code}" "$HEALTH_URL" || true)
  if [ "$http_code" = "200" ]; then
    echo "=== Готово! Health-check: $http_code ==="
    exit 0
  fi
  sleep 3
done

echo "Health-check не дождался 200: ${http_code:-unknown}" >&2
exit 1
