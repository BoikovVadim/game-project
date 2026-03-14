# Legacy Cleanup Inventory

Файл отделяет то, что уже безопасно удалено, от того, что пока нельзя убирать вслепую без отдельной проверки runtime, сервера или данных.

## Скрипты деплоя и сервера

- `deploy/update.sh`
  Статус: legacy.
  Почему: дублирует текущий production flow, использует `git pull` и `CI=true npm run build`, но не соответствует каноническому сценарию через `npm run deploy:prod` и встроенный health-check.
  Следующий шаг: либо переписать как thin-wrapper над `scripts/deploy-prod.sh`, либо удалить после проверки, что на сервере больше никто не использует этот файл.

- `deploy/setup-server.sh`
  Статус: historical bootstrap.
  Почему: полезен как черновик первичной настройки, но жёстко зашивает старые шаги клонирования, `.env` copy flow и прямую настройку nginx/pm2.
  Следующий шаг: вынести в отдельный documented bootstrap guide или обновить под текущие env-переменные и deploy pipeline.

- `rebuild-frontend.sh`
  Статус: legacy local helper.
  Почему: продвигает `npm run dev`, тогда как канонический локальный режим теперь `npm run dev:live`.
  Следующий шаг: либо удалить после проверки отсутствия использования, либо превратить в явно названный full-build helper с предупреждением о non-default режиме.

## Backend one-off scripts

### Оставить, но задокументировать назначение

- `backend/src/scripts/audit-auth-payments.ts`
- `backend/src/scripts/backfill-tournament-round-resolutions.ts`
- `backend/src/scripts/fix-question-encoding.ts`
- `backend/src/scripts/normalize-admin-credit-ledger.ts`
- `backend/src/scripts/normalize-refund-descriptions.ts`
- `backend/src/scripts/recompute-correct-counts.ts`

Это полезные audit/backfill/retrofix скрипты. Следующий cleanup должен дать каждому короткое описание входных env и безопасного сценария запуска.

### Проверить на перенос, переименование или архив

- `backend/src/scripts/add-balance.ts`
- `backend/src/scripts/check-user.ts`
- `backend/src/scripts/seed-referral-once.ts`
- `backend/src/scripts/set-password.ts`
- `backend/src/scripts/swap-user-ids.ts`
- `backend/src/scripts/verify-email-user.ts`

Это ручные операционные утилиты. Следующий шаг: решить, должны ли они жить как поддерживаемые admin tools, или их лучше убрать в `manual/` или `archive/`.

### Требуют отдельной осторожной проверки

- `backend/src/scripts/migrate-sqlite-to-pg.ts`
- `backend/src/scripts/regenerate-questions.ts`
- `backend/src/scripts/seed-questions.ts`

Это скрипты с высоким риском побочного эффекта или историческим контекстом миграции данных. Удалять их без отдельного решения нельзя.

## Документы с признаками устаревания

- `РЕШЕНИЯ_И_СОСТОЯНИЕ_ПРОЕКТА.md`
  Признаки: ссылается на уже удалённые `Frontend/src/components/Home.tsx` и `Frontend/src/components/ProfilePlaceholder.tsx`.

- `DATA_TRANSFER.md`
  Признаки: опирается на `backend/db.sqlite` и `npm run dev`, что больше не является каноническим сценарием проекта.

Следующий шаг для обоих файлов: либо актуализировать под текущий runtime и архитектуру, либо перевести в архивные заметки с явной legacy-пометкой.
