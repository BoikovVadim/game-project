# Backend

NestJS backend для LegendGames.

## Обязательные env-переменные

Минимальный набор:

- `JWT_SECRET`
- `DB_HOST`
- `DB_PORT`
- `DB_USER`
- `DB_PASS`
- `DB_NAME`

Платёжные env-переменные задаются только если реально используются провайдеры:

- `YOOKASSA_SHOP_ID`
- `YOOKASSA_SECRET_KEY`
- `ROBOBASSA_MERCHANT_LOGIN`
- `ROBOBASSA_PASSWORD1`
- `ROBOBASSA_PASSWORD2`

## Запуск

Локальная сборка:

```bash
npm install
npm run build
```

Локальный запуск backend:

```bash
npm run start
```

Основной dev-сценарий проекта запускается из корня через `npm run dev:live`.

## Health endpoint

Backend отдаёт публичный health-check:

```bash
GET /api/health
```

Ответ:

```json
{
  "ok": true,
  "timestamp": "..."
}
```

## Важные замечания

- production bootstrap больше не использует insecure fallback secrets
- `backend/.env` загружается раньше `backend/.env.production`, поэтому реальные server secrets не должны затираться шаблонными значениями
- startup backfill-и не должны автоматически мутировать данные на каждом старте
- денежные операции и критичные tournament write-path должны выполняться через транзакции

## Audit / Smoke

Канонический локальный прогон backend-проверок:

```bash
npm run lint
npm run test
npm run audit:tournaments
npm run preview:reusable-tournaments
npm run build
```

`lint` покрывает controllers/dto и расширенный набор service/domain/scripts, а `test` запускает и `*.test.ts`, и `*.spec.ts`, чтобы service/domain/tests не выпадали из проверки.

Быстрый аудит продовых auth/payment данных:

```bash
npm run audit:auth-payments
```

Безопасное исправление очевидного противоречия "`emailVerified=true`, но verification token не очищен":

```bash
npm run fix:auth-payments-data
```
