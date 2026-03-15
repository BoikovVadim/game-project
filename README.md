# LegendGames

Монорепозиторий проекта игры:

- `Frontend/` — React-клиент
- `backend/` — NestJS API и сервер отдачи SPA
- `scripts/` — локальные служебные скрипты

## Локальный запуск

Рекомендуемый режим разработки из корня проекта:

```bash
npm install
cd Frontend && npm install && cd ..
npm run dev:live
```

После старта:

- фронтенд доступен на `http://localhost:3000`
- backend API работает на `http://localhost:3001`
- фронтенд использует hot reload

Production-like запуск одним сервером:

```bash
npm run start:simple
```

## Сборка

Backend:

```bash
cd backend
npm run build
```

Frontend:

```bash
cd Frontend
CI= npm run build
```

## Health checks

- SPA root: `http://localhost:3000/`
- API health: `http://localhost:3000/api/health` или `http://localhost:3001/api/health` в dev-режиме

## Деплой

Продовые доступы не должны храниться в репозитории. Актуальный production contract в проекте такой:

- серверный путь: `/var/www/game`
- PM2 app: `game-backend`
- backend listener: `127.0.0.1:3000`
- public health-check: `https://legendgames.space/api/health`
- основной домен: `https://legendgames.space`

Перед запуском деплоя нужно передать переменные окружения:

```bash
export DEPLOY_REMOTE_HOST=example.com
export DEPLOY_REMOTE_USER=deploy
export DEPLOY_REMOTE_DIR=/var/www/game
export DEPLOY_PM2_APP=game-backend
export DEPLOY_HEALTHCHECK_URL=http://localhost:3000/api/health
export DEPLOY_SSH_KEY_PATH=~/.ssh/id_rsa
```

Полный деплой:

```bash
npm run deploy:prod
```

Только фронтенд:

```bash
npm run deploy:prod:frontend
```

## Проверка изменений

Канонический локальный прогон перед push/deploy:

```bash
npm run verify:ci
```

Что входит в `verify:ci`:

- contract-layer lint для backend и frontend
- backend unit + runtime e2e
- frontend tests
- smoke stability check
- production build backend/frontend

Дополнительный ручной чек-лист описан в `QA_CHECKLIST.md`.

Перед production deploy обязательно проверь:

- `backend/.env` на сервере заполнен реальными значениями и имеет приоритет над шаблонным `backend/.env.production`
- `pm2 describe game-backend` показывает один процесс
- Nginx использует один активный конфиг `game` и проксирует `/api/health` в backend
