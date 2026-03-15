# QA Checklist

## Backend / API

- `GET /api/health` отвечает `200` и `{ ok: true }`
- логин по email работает
- логин по username работает
- просроченный или битый token не оставляет пользователя в “полузалогиненном” состоянии: фронт сбрасывает сессию и возвращает на экран входа
- после логина пользователь возвращается в исходный защищённый route, если попал туда до авторизации
- `verify-code` не выдаёт токен для уже подтверждённой почты без корректного кода
- reset password работает только с валидным токеном
- `seed-referral-model` недоступен обычному пользователю

## Payments / Money

- создание платежа через YooKassa создаёт `pending` запись и возвращает redirect URL
- return/cancel URL платежа используют формат `/#/profile?section=finance-topup&payment=...` и реально открывают нужный экран кабинета
- webhook YooKassa не зачисляет деньги при несовпадении суммы или external payment id
- Robokassa result не зачисляет деньги при неверной подписи или несовпадении суммы
- после успешного платежа создаётся `topup` transaction и обновляется `balanceRubles`
- создание заявки на вывод атомарно уменьшает `balanceRubles` и создаёт `withdrawal_request`
- approve/reject заявки не допускают повторной обработки

## Tournaments

- конкурентный вход двух игроков в один money tournament не создаёт двойной слот
- при входе в money tournament атомарно создаются `entry`, `playerOrder`, loss transaction и escrow
- завершённый money tournament не оставляет escrow в `held/processing`
- незавершённый money tournament не содержит settled escrow (`paid_to_winner` / `forfeited`)
- статистика полуфинальной пары считается по `playerOrder`, а не по сортировке `userId`
- новый игрок попадает в открытый tournament с минимальным `ID`, а не в более заполненный
- кнопка `Продолжить игру` использует backend `resumeTournamentId`, а не локальную сортировку списка
- `continueTraining` берёт канонический `joinInfo` из `GET /tournaments/:id/state`, а не восстанавливает слот/пару на клиенте
- `POST /tournaments/:id/training-state/prepare` создаёт вопросы/таймеры, а `GET /tournaments/:id/training-state` остаётся read-only
- `npm run verify:tournaments` проходит без ошибок
- `npm run preview:tournaments` показывает candidate `ID` без мутаций для `training` и money-лиг
- `npm run repair:tournaments` после drift возвращает `audit:tournaments` к `0`
- сценарная матрица покрыта минимумом:
  - `2 игрока`
  - `4 игрока`
  - `нет соперника`
  - `ничья`
  - `таймаут одного`
  - `таймаут обоих`
  - `ожидание финала`
  - `finished/history`
  - `active/continue`

## Profile / Admin / Support

- `/profile` без query открывает `news`
- refresh/back/forward сохраняют `section`, `statsMode`, открытую сетку турнира и просмотр вопросов
- в админке сохраняются `tab`, `status`, `userSearch`, `supportStatus`, `supportTicket`, `statsTab`, `txCategory`, `tournamentId`
- `SupportChat` сохраняет открытый тикет в URL и возвращает пользователя в `returnTo`, а не на несуществующий `?section=support`
- unread новости не протекают между разными пользователями на одном браузере
- `Profile` и `Admin` открывают bracket/questions modals через единый URL-state hook без расхождения query param поведения

## Build / Deploy

- `cd backend && npm run build` проходит без ошибок
- `cd Frontend && CI= npm run build` проходит без предупреждений ESLint
- `npm run smoke:stability` проходит и подтверждает runtime/auth/payment contracts
- `cd backend && npm run audit:auth-payments` не находит противоречивых auth/payment записей
- `npm run verify:tournaments` выполняет `backend test -> build -> audit:tournaments -> preview:reusable-tournaments`
- после `npm run repair:tournaments` повторный `audit:tournaments` остаётся с `totalIssueCount = 0`
- `npm run deploy:prod` использует только env-based deploy vars
- после деплоя отвечает `DEPLOY_HEALTHCHECK_URL`
