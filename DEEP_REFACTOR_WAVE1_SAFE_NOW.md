# Deep Refactor Wave 1: Safe Now

## Цель волны

Зафиксировать безопасные seams для дальнейшей декомпозиции без смены внешних контрактов, без смешивания `read/write` responsibility и без второго source of truth.

## Backend seams

### Admin

- `backend/src/admin/project-cost-dashboard.service.ts`
  - Выделен отдельный read-model/service для парсинга `.cursor/project-cost-tracking.md`.
  - `AdminService` больше не хранит у себя file-reading и parsing-логику для project cost dashboard.
  - Безопасная граница: `AdminService` оркестрирует use-cases, а `ProjectCostDashboardService` отвечает только за read-model и формат ответа.

### Users / finance read-model

- `backend/src/users/user-balance-ledger.service.ts`
  - Выделен отдельный сервис для вычисления balance maps и reconciliation stored balances.
  - `UsersService` оставлен как внешний фасад для существующих call-sites (`AdminService`, `TournamentsService`, maintenance scripts).
  - Безопасная граница: ledger/read-model логика и balance reconciliation живут отдельно от профильных, referral и stats use-cases.

### Tournament read contracts

- Safe-now граница зафиксирована вокруг:
  - `backend/src/tournaments/dto/tournament-read.dto.ts`
  - `Frontend/src/features/tournaments/contracts.ts`
- В этой волне внешний контракт не менялся.
- Для risky split запрещено:
  - переносить display-решения на frontend;
  - плодить второй read-contract рядом с текущим DTO/contracts слоем.

## Frontend seams

### Shared player stats tooltip

- `Frontend/src/features/users/player-stats-tooltip.tsx`
  - Вынесен общий loader `usePublicPlayerStatsLoader()`.
  - Вынесен общий `PlayerStatsTooltipContent`.
- Этим seam-ом теперь пользуются:
  - `Frontend/src/components/TournamentModals.tsx`
  - `Frontend/src/components/Profile.tsx`
  - `Frontend/src/components/Admin.tsx`

### Что это даёт

- Больше нет трёх независимых реализаций одного tooltip-body.
- Загрузка `public-stats` перестала дублироваться по разным крупным компонентам.
- Дальнейший split `Profile`/`Admin` можно делать по секциям, не таща tooltip/rendering логику с собой.

## Tooling seams

- `backend/package.json`
  - backend lint расширен с controller/dto-only до safe-now покрытия service/domain/script файлов, которые реально держатся зелёными уже сейчас:
    - `admin/project-cost-dashboard.service.ts`
    - `users/user-balance-ledger.service.ts`
    - `tournaments/domain/progress-correct-counts.ts`
    - `scripts/preview-reusable-tournaments.ts`
- backend test runner теперь запускает и `*.test.ts`, и `*.spec.ts`.
- `.github/workflows/ci.yml`
  - добавлены tournament audit/preview steps;
  - добавлена syntax-проверка `scripts/deploy-prod.sh`.

## Safe-now ограничения

- `backend/src/admin/admin.service.ts` ещё не готов к полному lint-coverage: там остаётся legacy `any`/SQL-heavy orchestration, которую нельзя безопасно вычищать в этой волне вместе с остальным проектом.
- `backend/src/users/users.service.ts` остаётся крупным фасадом, но ledger seam уже вынесен и может дальше резаться отдельно.
- `Profile.tsx` и `Admin.tsx` ещё не разрезаны по всем feature sections; в этой волне вынесен общий shared слой, чтобы следующий split был механическим, а не логически рискованным.

## Verification evidence

- `npm run lint:backend`
- `npm run test:backend`
- `npm run audit:tournaments --workspace backend`
- `npm run preview:reusable-tournaments --workspace backend`
- `npm run build:frontend`
- `npm run dev:live` -> `http://localhost:3000` = `200`
