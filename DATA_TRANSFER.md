# Перенос проекта на другой компьютер

Документ обновлён под текущий канонический flow проекта.

## Что является source of truth

- исходный код и все рабочие скрипты: Git-репозиторий
- канонический локальный запуск: `npm run dev:live`
- каноническая проверка перед деплоем: `npm run verify:ci`
- продовый деплой: `npm run deploy:prod`

## Шаг 1. На текущем компьютере

```bash
git add .
git commit -m "Сохраняю изменения"
git push origin main
```

Если есть локальные `.env` или production secrets, они не должны лежать в Git. Их нужно перенести отдельно.

## Шаг 2. На новом компьютере

```bash
git clone <URL_репозитория> game-project-main
cd game-project-main
npm install
cd Frontend && npm install && cd ..
npm run verify:ci
npm run dev:live
```

После старта открыть `http://localhost:3000`.

## Что проверить после переноса

- `http://localhost:3000/` отвечает
- `http://localhost:3001/api/health` в dev-режиме отдаёт `200`
- `npm run verify:ci` проходит без ошибок
- локальные `.env` и deploy variables перенесены отдельно и не потеряны
