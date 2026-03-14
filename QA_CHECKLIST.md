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
- статистика полуфинальной пары считается по `playerOrder`, а не по сортировке `userId`

## Profile / Admin / Support

- `/profile` без query открывает `news`
- refresh/back/forward сохраняют `section`, `statsMode`, открытую сетку турнира и просмотр вопросов
- в админке сохраняются `tab`, `status`, `userSearch`, `supportStatus`, `supportTicket`, `statsTab`, `txCategory`, `tournamentId`
- `SupportChat` сохраняет открытый тикет в URL и возвращает пользователя в `returnTo`, а не на несуществующий `?section=support`
- unread новости не протекают между разными пользователями на одном браузере

## Build / Deploy

- `cd backend && npm run build` проходит без ошибок
- `cd Frontend && CI= npm run build` проходит без предупреждений ESLint
- `npm run smoke:stability` проходит и подтверждает runtime/auth/payment contracts
- `cd backend && npm run audit:auth-payments` не находит противоречивых auth/payment записей
- `npm run deploy:prod` использует только env-based deploy vars
- после деплоя отвечает `DEPLOY_HEALTHCHECK_URL`
