#!/bin/bash
set -e

# ============================================
# LegendGames — Обновление на сервере
# Запускать: bash /var/www/game/deploy/update.sh
# ============================================

APP_DIR="/var/www/game"

echo "=== Обновление LegendGames ==="

cd "$APP_DIR"
echo "Получаю изменения из GitHub..."
git pull
npm install

echo "Пересборка бэкенда..."
cd backend && npm install && npm run build && cd ..

echo "Пересборка фронтенда..."
cd Frontend && npm install && CI=true npm run build && cd ..

echo "Перезапуск приложения..."
if pm2 describe game-backend >/dev/null 2>&1; then
  pm2 restart game-backend --update-env
else
  pm2 start ecosystem.config.js --only game-backend
fi

echo "=== Готово! Проверь: https://legendgames.space ==="
