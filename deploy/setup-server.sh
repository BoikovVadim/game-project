#!/bin/bash
set -e

# ============================================
# LegendGames — Установка на Ubuntu 22.04/24.04
# Запускать от root: bash setup-server.sh
# ============================================

DOMAIN="legendgames.space"
APP_DIR="/var/www/game"
LOG_DIR="/var/www/game/logs"
REPO="https://github.com/BoikovVadim/game-project.git"

echo "=== 1/7. Обновление системы ==="
apt update && apt upgrade -y

echo "=== 2/7. Установка Node.js 20 ==="
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs
node -v && npm -v

echo "=== 3/7. Установка Nginx ==="
apt install -y nginx
systemctl enable nginx

echo "=== 4/7. Установка Certbot ==="
apt install -y certbot python3-certbot-nginx

echo "=== 5/7. Установка PM2 ==="
npm install -g pm2

echo "=== 6/7. Клонирование проекта ==="
mkdir -p "$APP_DIR" "$LOG_DIR"
if [ -d "$APP_DIR/.git" ]; then
  echo "Проект уже склонирован, обновляю..."
  cd "$APP_DIR" && git pull
else
  git clone "$REPO" "$APP_DIR"
fi

cd "$APP_DIR"

echo "=== 6a. Установка зависимостей проекта и бэкенда ==="
npm install
cd backend && npm install && npm run build && cd ..

echo "=== 6b. Сборка фронтенда ==="
cd Frontend && npm install && CI=true npm run build && cd ..

echo "=== 6c. Копирование .env ==="
if [ ! -f backend/.env ]; then
  cp backend/.env.production backend/.env
  echo "!!! ВАЖНО: Отредактируй backend/.env — проверь APP_URL и секреты"
fi

echo "=== 7/7. Настройка Nginx ==="
cp deploy/nginx.conf /etc/nginx/sites-available/game
ln -sf /etc/nginx/sites-available/game /etc/nginx/sites-enabled/game
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx

echo ""
echo "============================================"
echo "  Установка завершена!"
echo "============================================"
echo ""
echo "Следующие шаги:"
echo ""
echo "1. Убедись, что DNS A-запись $DOMAIN -> IP этого сервера"
echo "   (подожди 5-30 минут после настройки DNS)"
echo ""
echo "2. Получи SSL-сертификат:"
echo "   certbot --nginx -d $DOMAIN -d www.$DOMAIN"
echo ""
echo "3. Проверь/отредактируй backend/.env:"
echo "   nano $APP_DIR/backend/.env"
echo ""
echo "4. Запусти приложение:"
echo "   cd $APP_DIR"
echo "   pm2 start ecosystem.config.js --only game-backend"
echo "   pm2 save"
echo "   pm2 startup"
echo ""
echo "5. Проверь: https://$DOMAIN"
echo "============================================"
