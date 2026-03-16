# Deep Refactor Wave 1: Risky Later

## Когда начинать

Переходить к этому этапу только после зелёных:

- `lint/test/build` по safe-now wave;
- tournament audit/preview;
- production deploy + health-check;
- подтверждения, что новые seams реально используются и не дали regression.

## Track 1: Tournament domain split

### Цель

Разрезать `backend/src/tournaments/tournaments.service.ts` на независимые зоны без нарушения турнирных инвариантов и без read-side mutation.

### Целевые модули

- `query/read-path`
  - list/bracket/review/training prepare
- `command/write-path`
  - join/progress/complete/timeout/finalization
- `repair/audit`
  - explicit maintenance/backfill/compare logic
- `domain calculators`
  - bracket outcome
  - review rounds
  - visible counters
  - reusable tournament selection

### До начала split обязательно

- Inventory внутренних call-sites `tournaments.service.ts`.
- Таблица helper-ов: кто read-only, кто mutating, кто maintenance-only.
- Явная маркировка мест, где сегодня backend ещё совмещает orchestration + DTO shaping + domain decisions.

### Риски

- Сломать общие инварианты для `training` и `money`.
- Случайно вернуть hidden write в `GET`.
- Разъехать machine-readable поля и frontend rendering.
- Снова создать split source of truth по stage counters/result labels.

### Обязательная верификация

- Матрица сценариев:
  - `2 игрока`
  - `4 игрока`
  - `нет соперника`
  - `ничья`
  - `таймаут одного`
  - `таймаут обоих`
  - `ожидание финала`
  - `finished/history`
  - `active/continue`
- `verify:tournaments`
- compare/audit checks по list/bracket/review

## Track 2: Finance domain unification

### Цель

Свести `UsersService`, `AdminService`, maintenance scripts и ledger/read-model логику к явному finance domain layer без hidden duplicate rules.

### Целевые модули

- `ledger read-model`
- `manual admin credit / topup`
- `withdrawals / approval flow`
- `payments provider mapping`
- `repair/audit checks`

### До начала split обязательно

- Inventory всех мест, где считаются:
  - `balanceRubles`
  - `balance`
  - pending withdrawals
  - escrow / held sums
- Таблица source of truth:
  - какие поля derived,
  - какие maintenance-only,
  - где допускается retrofix.

### Риски

- Разъезд stored balance vs computed ledger balance.
- Поломка admin credit / withdrawal history.
- Неполный audit/fix path после изменения source of truth.
- Неочевидный data retrofix для старых транзакций.

### Обязательная верификация

- targeted finance audit;
- build/tests;
- manual smoke по admin withdrawals / credit history;
- при смене source of truth: отдельный retrofix plan и отчёт по затронутым записям.

## Что нельзя делать в risky wave

- Нельзя смешивать tournament и finance split в один commit без промежуточной зелёной верификации.
- Нельзя переводить frontend на новый контракт раньше, чем backend отдаёт machine-readable данные в каноническом виде.
- Нельзя убирать maintenance scripts, пока их domain equivalent не доказан audit-evidence.
