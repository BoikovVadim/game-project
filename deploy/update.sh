#!/bin/bash
set -e

# ============================================
# LegendGames — Обновление на сервере
# Запускать: bash /home/legend/app/deploy/update.sh
# ============================================

APP_DIR="/home/legend/app"

echo "=== Обновление LegendGames ==="

cd "$APP_DIR"
echo "Получаю изменения из GitHub..."
git pull

echo "Пересборка бэкенда..."
cd backend && npm install && npm run build && cd ..

echo "Пересборка фронтенда..."
cd Frontend && npm install && CI=true npm run build && cd ..

echo "Перезапуск приложения..."
pm2 restart legendgames

echo "=== Готово! Проверь: https://legendgames.ru ==="
