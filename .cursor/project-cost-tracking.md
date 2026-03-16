921559.13
За сегодня (2026-03-16): 14 533,32 ₽

# Последние изменения. Формат записи: YYYY-MM-DD HH:MM | Z ₽ | оплачиваемое время | описание. Если у задачи есть клиентская разбивка, она идёт отдельным списком ниже. Внутренние расчёты и ретроспектива на сайт не выводятся.

2026-03-16 05:41 | 1 000,00 ₽ | 30 мин | Admin/project-cost+metadata-sync-guard+deploy: причина текущего рассинхрона была не в backend parser, а в ручной metadata-строке `За сегодня (...)` внутри `.cursor/project-cost-tracking.md`: parser уже правильно считал сумму по датам записей (`13 533,32 ₽`), но верхняя шапка была вручную завышена до `146 701,88 ₽`, из-за чего в чате и при ручном чтении файла казалось, что сегодняшняя сумма тянет вчерашние значения. Шапка синхронизирована с каноническим расчётом, а в backend tests добавлена проверка, что metadata date/amount и общий итог совпадают с фактической историей последней даты.

Разбивка:

- Погружение: 7 мин.
- Проектирование: 4 мин.
- Реализация: 5 мин.
- Cleanup: 2 мин.
- Проверка: 8 мин.
- Delivery: 4 мин.

Ретроспектива:

- Базовое время: 30 мин.
- Коэффициент: 1.00
- Оплачиваемое время: 30 мин.
- Ставка: 2000 ₽ / час.
- Формула: 30 мин × 2000 ₽ / 60 мин = 1 000,00 ₽.

2026-03-16 05:27 | 1 533,33 ₽ | 46 мин | Finance/risky-wave-first-cut+ledger-read-path-unification+deploy: начата отдельная risky-подволна для finance domain без вмешательства в write-path. Per-user balance projection в `UsersService` больше не пересчитывает рубли/L/pending разрозненными SQL-ветками, а делегирует в канонический `UserBalanceLedgerService`, где уже живёт общий ledger source of truth. Локально подтверждены `lint:backend`, `test:backend`, `build:backend`, `localhost:3001/api/health = 200`; дополнительно `audit:finance-ledger` поднял старые data issues (`convert_without_sufficient_ledger_balance`, `stored_vs_ledger_mismatch`, legacy/manual cases), которые не были созданы этой правкой и требуют отдельной data-repair волны.

Разбивка:

- Погружение: 7 мин.
- Проектирование: 5 мин.
- Реализация: 8 мин.
- Cleanup: 3 мин.
- Проверка: 7 мин.
- Delivery: 6 мин.

Ретроспектива:

- Базовое время: 36 мин.
- Коэффициент: 1.30
- Оплачиваемое время: 46 мин.
- Ставка: 2000 ₽ / час.
- Формула: 46 мин × 2000 ₽ / 60 мин = 1 533,33 ₽.

2026-03-16 05:20 | 1 733,33 ₽ | 52 мин | Tournaments/risky-wave-first-cut+read-model-helper-extraction+deploy: начат risky-later split турнирного домена, но в самой безопасной под-волне без изменения поведения. Из `tournaments.service.ts` вынесены чистые progress/read-model helper-ы (`normalizeProgressSnapshot`, reliable correct-count recompute, visible stage totals, effective player order) в отдельный domain-модуль `progress-read-model`, а сам сервис перестал держать у себя эту projection-логику. Дополнительно добавлен unit-test на новый helper-слой и расширено backend lint-покрытие на новый domain файл. Локально подтверждены `lint:backend`, unit tests, `verify:tournaments`, `localhost:3001/api/health = 200`; затем выполнены commit/push/deploy и production health-check `https://legendgames.space/api/health = 200`.

Разбивка:

- Погружение: 8 мин.
- Проектирование: 6 мин.
- Реализация: 8 мин.
- Cleanup: 3 мин.
- Проверка: 7 мин.
- Delivery: 8 мин.

Ретроспектива:

- Базовое время: 40 мин.
- Коэффициент: 1.30
- Оплачиваемое время: 52 мин.
- Ставка: 2000 ₽ / час.
- Формула: 52 мин × 2000 ₽ / 60 мин = 1 733,33 ₽.

2026-03-16 05:09 | 833,33 ₽ | 25 мин | Admin/project-cost+today-rollover-fix+deploy: причина была в split source of truth внутри dashboard parser — `todayTotal` брался не из дат реальных записей, а из ручной metadata-строки `За сегодня (...)`, поэтому после смены дня сумма не сбрасывалась автоматически, пока кто-то не перепишет строку вручную. Backend parser переведён на канонический расчёт `todayTotal` по entry-блокам за текущую московскую дату, а регрессионный unit-test фиксирует сценарий со stale metadata и новой датой.

Разбивка:

- Погружение: 4 мин.
- Проектирование: 2 мин.
- Реализация: 5 мин.
- Cleanup: 1 мин.
- Проверка: 5 мин.
- Delivery: 8 мин.

Ретроспектива:

- Базовое время: 25 мин.
- Коэффициент: 1.00
- Оплачиваемое время: 25 мин.
- Ставка: 2000 ₽ / час.
- Формула: 25 мин × 2000 ₽ / 60 мин = 833,33 ₽.

2026-03-16 05:05 | 1 933,33 ₽ | 58 мин | Refactor wave 1/safe-now seams+tooling+docs+deploy: выполнена первая безопасная волна глубокого refactor-pass без смены внешних контрактов. Из `AdminService` вынесен отдельный read-model `project-cost-dashboard service`, из `UsersService` выделен ledger/balance seam, на фронтенде вынесен общий `player-stats tooltip` loader/content для `Profile` / `Admin` / `TournamentModals`, а backend tooling усилен: lint теперь покрывает safe-now service/domain/script файлы, test runner запускает и `*.spec.ts`, CI дополнен tournament audit/preview и syntax-check для deploy path. Дополнительно отдельно оформлены safe-now inventory и risky-later plan для `tournaments` и `finance`.

Разбивка:

- Погружение: 8 мин.
- Проектирование: 6 мин.
- Реализация: 16 мин.
- Cleanup: 4 мин.
- Проверка: 8 мин.
- Delivery: 8 мин.

Ретроспектива:

- Базовое время: 50 мин.
- Коэффициент: 1.15
- Оплачиваемое время: 58 мин.
- Ставка: 2000 ₽ / час.
- Формула: 58 мин × 2000 ₽ / 60 мин = 1 933,33 ₽.

2026-03-16 04:39 | 1 000,00 ₽ | 30 мин | Cursor rules/refactoring-rule-hardening+deploy: правило `refactoring-operating-modes` усилено без дублей с соседними always-apply rules. В локальный refactor-pass добавлены deletion evidence, обязательная проверка call-sites при `extract/rename/move`, анти-раздувание scope и требование измеримого evidence для optimization; в полный refactor-pass добавлен явный переход в plan при большом scope и классификация результата на `safe now` / `risky later` с отдельным упоминанием data-fix необходимости.

Разбивка:

- Погружение: 5 мин.
- Проектирование: 4 мин.
- Реализация: 5 мин.
- Cleanup: 2 мин.
- Проверка: 6 мин.
- Delivery: 8 мин.

Ретроспектива:

- Базовое время: 30 мин.
- Коэффициент: 1.00
- Оплачиваемое время: 30 мин.
- Ставка: 2000 ₽ / час.
- Формула: 30 мин × 2000 ₽ / 60 мин = 1 000,00 ₽.

2026-03-16 03:46 | 2 600,00 ₽ | 1 ч 18 мин | Турниры/backend+prod-verify+read-path-alignment+deploy: по кейсу `турнир 13 / игрок 2` найден ещё один split source of truth между внешними stage counters и review-модалкой. Read-path турниров усилен в три слоя: `getMyTournaments()` и `getTournamentBracket()` больше не полагаются на stale stage aggregates, сначала безопасно пересчитывают `correctAnswersCount/semiFinalCorrectCount` по `answersChosen`, затем считают видимые stage totals тем же canonical helper-ом, что и review, и больше не перетирают player-specific счёт pair-level override-ами. На production подтверждён `T13/u2`: список `10/10/7`, bracket `semi=9/10`, review `semi-main=9`, а итоговый compare-скрипт по всем `203` парам `tournament/user` после выката вернул `mismatchCount = 0`.

Разбивка:

- Погружение: 10 мин.
- Проектирование: 8 мин.
- Реализация: 16 мин.
- Cleanup: 4 мин.
- Проверка: 12 мин.
- Delivery: 10 мин.

Ретроспектива:

- Базовое время: 60 мин.
- Коэффициент: 1.30
- Оплачиваемое время: 1 ч 18 мин.
- Ставка: 2000 ₽ / час.
- Формула: 78 мин × 2000 ₽ / 60 мин = 2 600,00 ₽.

2026-03-16 03:23 | 3 900,00 ₽ | 1 ч 57 мин | Турниры/backend+prod-retrofix+global-correct-count-audit+deploy: по кейсу `турнир 10 / игрок 5` закрыт split source of truth между внешним счётчиком этапа и review-модалкой. Канонический пересчёт `correctAnswersCount/semiFinalCorrectCount` вынесен в общий helper по реальному пути игрока с учётом только фактически сыгранных tie-breaker раундов, `repairTournamentConsistency` теперь массово пересчитывает stale progress aggregates, а `audit-tournaments` детерминированно ловит такие рассинхроны по всем турнирам. На production initial audit нашёл `4` count-mismatch кейса (`T32/u2`, `T32/u4`, `T10/u5`, `T45/u4`); после normalizing dirty `playerOrder` выяснилось, что `T32/u2` был false positive, а production repair пересчитал `3` реальные stale записи. Финальный production audit вернул `totalIssueCount = 0`, public health-check `https://legendgames.space/api/health = 200`, а у `T10/u5` внешний `correctAnswersInRound` теперь совпадает с review-модалкой: `5`.

Разбивка:

- Погружение: 14 мин.
- Проектирование: 8 мин.
- Реализация: 20 мин.
- Cleanup: 6 мин.
- Проверка: 20 мин.
- Delivery: 22 мин.

Ретроспектива:

- Базовое время: 90 мин.
- Коэффициент: 1.30
- Оплачиваемое время: 1 ч 57 мин.
- Ставка: 2000 ₽ / час.
- Формула: 117 мин × 2000 ₽ / 60 мин = 3 900,00 ₽.

2026-03-15 19:25 | 2 166,67 ₽ | 1 ч 5 мин | Турниры/backend+prod-audit-repair-hardening+deploy: после массовой проверки выяснилось, что глобально логика финального продолжения уже лучше, но production всё ещё содержал хвосты `unfinished_with_results`, включая `T16`. `repairTournamentConsistency` усилен двумя каноническими шагами: теперь он добирает resolved brackets не только среди `finished`, но и среди `active/waiting`, а оставшиеся `tournament_result` у незавершённых турниров удаляет как stale-артефакты. Локально подтверждены `verify:tournaments` и `repair:tournaments -> audit = 0`; на production после двух последовательных repair-проходов удалены `4` stale result rows, итоговый `audit-tournaments` вернул `totalIssueCount = 0`, а public health-check `https://legendgames.space/api/health = 200`.

Разбивка:

- Погружение: 10 мин.
- Проектирование: 8 мин.
- Реализация: 10 мин.
- Cleanup: 3 мин.
- Проверка: 12 мин.
- Delivery: 7 мин.

Ретроспектива:

- Базовое время: 50 мин.
- Коэффициент: 1.30
- Оплачиваемое время: 1 ч 5 мин.
- Ставка: 2000 ₽ / час.
- Формула: 65 мин × 2000 ₽ / 60 мин = 2 166,67 ₽.

2026-03-15 19:06 | 2 333,33 ₽ | 1 ч 10 мин | Турниры/backend+final-tiebreaker-continue-fix+deploy: расследован кейс `турнир 16`, где финалисты после `10/10` и ничьей не видели кнопку продолжения. Причина была в backend source of truth: `playerRoundFinished` для победителя полуфинала всегда закрывал финал после первых `10` вопросов и не учитывал `final tiebreaker`, из-за чего `canContinue` становился `false` несмотря на ещё несыгранный следующий раунд. Логика вынесена в отдельный helper с регрессионным unit-test, поэтому при ничьей в финале текущий playable round больше не считается завершённым раньше нужного тайбрейка. Локально подтверждены `npm run test:backend`, `npm run build:backend`, `http://localhost:3000 = 200`, `http://localhost:3001/api/health = 200`; затем выполнены commit/push/deploy и production health-check `https://legendgames.space/api/health = 200`.

Разбивка:

- Погружение: 12 мин.
- Проектирование: 6 мин.
- Реализация: 8 мин.
- Cleanup: 4 мин.
- Проверка: 12 мин.
- Delivery: 12 мин.

Ретроспектива:

- Базовое время: 54 мин.
- Коэффициент: 1.30
- Оплачиваемое время: 1 ч 10 мин.
- Ставка: 2000 ₽ / час.
- Формула: 70 мин × 2000 ₽ / 60 мин = 2 333,33 ₽.

2026-03-15 18:41 | 833,33 ₽ | 25 мин | Турниры/frontend+race-regression-test+deploy: для фикса гонки `click vs timeout` добавлен отдельный helper резолва ответа и регрессионный `vitest`, который фиксирует правило `first write wins` для обоих порядков (`click -> timeout` и `timeout -> click`), чтобы последний вопрос снова не откатывался в `нет ответа` после будущих правок. Локально подтверждены `npm test` (`14/14`), `Frontend build`, `http://localhost:3000 = 200`, `http://localhost:3001/api/health = 200`; затем выполнены commit/push/deploy и production health-check `https://legendgames.space/api/health = 200`.

Разбивка:

- Погружение: 4 мин.
- Проектирование: 2 мин.
- Реализация: 5 мин.
- Cleanup: 2 мин.
- Проверка: 5 мин.
- Delivery: 4 мин.

Ретроспектива:

- Базовое время: 22 мин.
- Коэффициент: 1.15
- Оплачиваемое время: 25 мин.
- Ставка: 2000 ₽ / час.
- Формула: 25 мин × 2000 ₽ / 60 мин = 833,33 ₽.

2026-03-15 18:36 | 1 533,33 ₽ | 46 мин | Турниры/frontend+timeout-click-race-fix+deploy: устранена гонка между кликом по ответу и таймерным timeout на текущем вопросе — `Profile` теперь синхронно резолвит активный вопрос через ref до `setState` и `POST /progress`, поэтому timeout больше не может в тот же тик перетереть уже выбранный игроком ответ на `-1`, а если первым успел timeout, античит-фиксация `answerFinal` сохраняется как и раньше. Локально подтверждены `Frontend build`, `dev:live`, `http://localhost:3000 = 200`, `http://localhost:3001/api/health = 200`; затем выполнены commit/push/deploy и production health-check `https://legendgames.space/api/health = 200`.

Разбивка:

- Погружение: 10 мин.
- Проектирование: 5 мин.
- Реализация: 7 мин.
- Cleanup: 2 мин.
- Проверка: 8 мин.
- Delivery: 8 мин.

Ретроспектива:

- Базовое время: 40 мин.
- Коэффициент: 1.15
- Оплачиваемое время: 46 мин.
- Ставка: 2000 ₽ / час.
- Формула: 46 мин × 2000 ₽ / 60 мин = 1 533,33 ₽.

2026-03-15 18:20 | 2 833,33 ₽ | 1 ч 25 мин | Турниры/backend+global-participant-drift-audit+repair+deploy: выполнен полный повторный аудит турниров на тот же класс багов, который всплыл на `T11`. Найден системный legacy drift: reusable-selector всё ещё зависел от relation `players` для `hasCurrentUser`, а production-хвост содержал отсутствующие строки в `tournament_players_user` и `tournament_entry`, из-за чего open-slot join/resume мог расходиться с фактическими `playerOrder/progress`. Selector переведён на объединённый состав из `playerOrder + players + entry + progress`, `audit:tournaments` дополнен детекторами `missing_players_join_rows` и `missing_entry_rows_for_player_order`, а `repair:tournaments` теперь автоматически запускает participant backfill. Локально подтверждены `build backend`, `repair -> audit = 0`, `verify:tournaments`; на production после выката выполнены `repair:tournaments`, новый `audit:tournaments = 0`, прямой SQL-check `missingPlayersJoin=0`, `missingEntryRows=0`, а public health-check вернул `200`.

Разбивка:

- Погружение: 12 мин.
- Проектирование: 8 мин.
- Реализация: 11 мин.
- Cleanup: 4 мин.
- Проверка: 18 мин.
- Delivery: 12 мин.

Ретроспектива:

- Базовое время: 65 мин.
- Коэффициент: 1.30
- Оплачиваемое время: 1 ч 25 мин.
- Ставка: 2000 ₽ / час.
- Формула: 85 мин × 2000 ₽ / 60 мин = 2 833,33 ₽.

2026-03-15 17:59 | 2 166,67 ₽ | 1 ч 5 мин | Турниры/backend+prod-retrofix+t11-final-access+deploy: по кейсу `турнир 11` закрыт split source of truth между списком турниров и live prepare-path. В `didUserWinSemiFinal()` убран legacy-запрет, из-за которого semifinal winner в недобранном money-турнире видел `final_ready/canContinue`, но `prepareTrainingState` не открывал ему финальные вопросы. Дополнительно на production восстановлена relation-связь участников `tournament_players_user` для `T11`, чтобы она снова совпадала с `entry/progress`. После правки подтверждены `build backend`, `verify:tournaments`, commit/push/deploy, production `prepare(user 6, T11) -> questionsFinal=10`, reusable preview `user 2 / 5L -> candidateTournamentId=11` и public health-check `200`.

Разбивка:

- Погружение: 10 мин.
- Проектирование: 5 мин.
- Реализация: 6 мин.
- Cleanup: 2 мин.
- Проверка: 14 мин.
- Delivery: 13 мин.

Ретроспектива:

- Базовое время: 50 мин.
- Коэффициент: 1.30
- Оплачиваемое время: 1 ч 5 мин.
- Ставка: 2000 ₽ / час.
- Формула: 65 мин × 2000 ₽ / 60 мин = 2 166,67 ₽.

2026-03-15 17:58 | 1 933,33 ₽ | 58 мин | Турниры/backend+global-review-audit+correct-count-fix+deploy: после полного production-аудита review-модалок нашлись ещё два остаточных кейса. Первый: `турнир 10 / игрок 5`, где `reviewRounds.final-main.correctCount` расходился с фактическими `answersChosen`, потому что review-слой опирался на старый aggregate `correctAnswersCount`; теперь `getTrainingState` пересчитывает `correctCount` прямо из сохранённых ответов и текущего набора вопросов. Второй: `турнир 68 / игрок 3`, где active money-турнир остался без semifinal questions; во время проверки данные были восстановлены каноническим `prepareTrainingState`, а read-path перестал отдавать пустые review-раунды без вопросов. Дополнительно подтверждён отдельный production-аудит `resultLabel/resultKind/resultTone/timeout` без инцидентов. После правки выполнены `build backend`, `verify:tournaments`, commit/push/deploy и повторный глобальный production-аудит всех участников.

Разбивка:

- Погружение: 12 мин.
- Проектирование: 6 мин.
- Реализация: 8 мин.
- Cleanup: 3 мин.
- Проверка: 15 мин.
- Delivery: 6 мин.

Ретроспектива:

- Базовое время: 50 мин.
- Коэффициент: 1.15
- Оплачиваемое время: 58 мин.
- Ставка: 2000 ₽ / час.
- Формула: 58 мин × 2000 ₽ / 60 мин = 1 933,33 ₽.

2026-03-15 17:41 | 1 333,33 ₽ | 40 мин | Турниры/backend+global-audit+final-placeholder-fix+deploy: после массового production-аудита всех `174` пар `tournament/user` нашёлся второй класс рассинхрона review-модалки — у части игроков `reviewRounds` уже содержал `final-main`, но opposite finalist ещё не определялся как полноценный opponent-object, поэтому `getTrainingState` не добавлял даже placeholder-слот в `opponentAnswersByRound/opponentInfoByRound`, и длины массивов расходились. Backend read-path дополнен обязательным placeholder для всех видимых финальных review-раундов без соперника, после чего локально подтверждены `build backend` и `verify:tournaments`, затем выполнены commit/push/deploy и повторный production-audit всех участников.

Разбивка:

- Погружение: 8 мин.
- Проектирование: 4 мин.
- Реализация: 5 мин.
- Cleanup: 2 мин.
- Проверка: 9 мин.
- Delivery: 7 мин.

Ретроспектива:

- Базовое время: 35 мин.
- Коэффициент: 1.15
- Оплачиваемое время: 40 мин.
- Ставка: 2000 ₽ / час.
- Формула: 40 мин × 2000 ₽ / 60 мин = 1 333,33 ₽.

2026-03-15 17:31 | 1 733,33 ₽ | 52 мин | Турниры/backend+prod-investigation+review-index-fix+deploy: расследован кейс `турнир 7 / игрок 6`, где в модалке вопросов у финальной вкладки не отображались ответы соперника. По production данным подтверждено, что ответы соперника в БД были, но `getTrainingState` строил `opponentAnswersByRound` длиннее, чем `reviewRounds`: для невидимого полуфинального тайбрейка вставлялся пустой слот, из-за чего финальная вкладка смотрела не в тот индекс и получала `[]`. Backend read-path выровнен по фактически видимым `reviewRounds`, так что индексы вкладок и массивы ответов соперника снова совпадают. Локально подтверждены `build backend` и `verify:tournaments`, затем выполнены commit/push/deploy и production health-check.

Разбивка:

- Погружение: 12 мин.
- Проектирование: 5 мин.
- Реализация: 7 мин.
- Cleanup: 3 мин.
- Проверка: 12 мин.
- Delivery: 6 мин.

Ретроспектива:

- Базовое время: 45 мин.
- Коэффициент: 1.15
- Оплачиваемое время: 52 мин.
- Ставка: 2000 ₽ / час.
- Формула: 52 мин × 2000 ₽ / 60 мин = 1 733,33 ₽.

2026-03-15 17:20 | 1 933,33 ₽ | 58 мин | Турниры/frontend+prod-investigation+answer-persist-fix+deploy: расследован кейс `турнир 4 / игрок 5`, где локально последний выбор загорался зелёным, а в модалке потом отображался как `нет ответа`. По production данным подтверждено, что backend честно читал сохранённый `-1`; реальная причина была во фронтовом write-path — после выбора ответа клиент мог тут же отправить следующий `progress` со stale `fullAnswersChosen/trainingAnswers` и затереть последний клик. Исправлена синхронная запись snapshot в `Profile`, финальный `goToNextQuestion/saveTrainingProgress` теперь отправляют актуальный массив ответов и дублируют `answerFinal` для уже выбранного ответа. Существующий сломанный ответ в старом турнире не менялся автоматически, потому что без серверного source of truth его нельзя восстановить без догадки. Локально подтверждены `frontend lint`, `frontend test`, `frontend build`, затем выполнены commit/push/deploy и production health-check.

Разбивка:

- Погружение: 14 мин.
- Проектирование: 6 мин.
- Реализация: 8 мин.
- Cleanup: 4 мин.
- Проверка: 8 мин.
- Delivery: 10 мин.

Ретроспектива:

- Базовое время: 50 мин.
- Коэффициент: 1.15
- Оплачиваемое время: 58 мин.
- Ставка: 2000 ₽ / час.
- Формула: 58 мин × 2000 ₽ / 60 мин = 1 933,33 ₽.

2026-03-15 17:12 | 2 333,33 ₽ | 1 ч 10 мин | Турниры/backend+data-fix+prod-audit+deploy: проведён полный аудит временных записей турниров и найден production drift в `roundStartedAt` — у 21 progress-строки время старта раунда было записано на 1-7 мс раньше `tournament.createdAt`, что физически невозможно. Исправлен writer-path для новых входов в пару (таймер больше не может стартовать раньше создания турнира) и выполнен retrofix существующих записей с точечным выравниванием `roundStartedAt` к `createdAt`; после правки подтверждены локальные `verify:tournaments`, `build backend`, production time-audit и канонический `audit-tournaments` без новых инцидентов.

Разбивка:

- Погружение: 10 мин.
- Проектирование: 6 мин.
- Реализация: 10 мин.
- Cleanup: 4 мин.
- Проверка: 12 мин.
- Delivery: 12 мин.

Ретроспектива:

- Базовое время: 54 мин.
- Коэффициент: 1.30
- Оплачиваемое время: 1 ч 10 мин.
- Ставка: 2000 ₽ / час.
- Формула: 70 мин × 2000 ₽ / 60 мин = 2 333,33 ₽.

2026-03-15 16:51 | 3 266,67 ₽ | 1 ч 38 мин | Турниры/frontend+browser-smoke+url-history+deploy: после живой browser-проверки timeout-сценариев нашёлся второй UI-риск — `F5` на просроченном live-экране уже корректно уводил турнир в history, но user-driven переключение разделов кабинета шло через history `replace`, поэтому `back/forward` не возвращал пользователя в предыдущую секцию игр. Исправлена history-навигация для пользовательских переходов по `section/gameMode/league`, после чего повторно подтверждены локально training и money сценарии: искусственный timeout на live-экране, `F5`, а также `back/forward` между секциями с восстановлением `games-training` и `games-money` из URL.

Разбивка:

- Погружение: 16 мин.
- Проектирование: 8 мин.
- Реализация: 12 мин.
- Cleanup: 4 мин.
- Проверка: 28 мин.
- Delivery: 17 мин.

Ретроспектива:

- Базовое время: 85 мин.
- Коэффициент: 1.15
- Оплачиваемое время: 1 ч 38 мин.
- Ставка: 2000 ₽ / час.
- Формула: 98 мин × 2000 ₽ / 60 мин = 3 266,67 ₽.

2026-03-15 16:20 | 2 500,00 ₽ | 1 ч 15 мин | Турниры/backend+frontend+runtime-hardening+deploy: закрыт split source of truth по времени в live-турнирах — backend теперь синхронизирует timeout-resolution перед writer-path, не принимает `progress` после дедлайна, timeout-resolution и `finished`, а `prepareTrainingState` больше не может по клиентскому заходу запускать просроченный следующий этап. Дополнительно фронт перестал сам отправлять `POST /complete` по локальным часам браузера, а финальный timeout scoring сведён к одному каноническому helper-у; локально подтверждены `verify:tournaments`, `lint:frontend`, `build:frontend`, `smoke:stability` и health-check `localhost:3000/3001`, затем выполнены commit/push/deploy и production-check.

Разбивка:

- Погружение: 8 мин.
- Проектирование: 6 мин.
- Реализация: 16 мин.
- Cleanup: 4 мин.
- Проверка: 12 мин.
- Delivery: 12 мин.

Ретроспектива:

- Базовое время: 58 мин.
- Коэффициент: 1.30
- Оплачиваемое время: 1 ч 15 мин.
- Ставка: 2000 ₽ / час.
- Формула: 75 мин × 2000 ₽ / 60 мин = 2 500,00 ₽.

2026-03-15 15:53 | 1 000,00 ₽ | 30 мин | Турниры/backend+legacy-read-fix+deploy: найден второй слой legacy drift для `турнира 3` — даже после снятия запрета модалка могла не показывать нового игрока, потому что bracket/read-path рендерили состав из неполного relation `players` и пустого/битого `playerOrder`. Сервис теперь нормализует порядок участников из фактически загруженных игроков, догружает отсутствующих по `playerOrder` и использует этот состав и в join-path, и в модалке, поэтому игрок, уже вошедший в турнир, должен отображаться в сетке.

Разбивка:

- Погружение: 6 мин.
- Проектирование: 3 мин.
- Реализация: 5 мин.
- Cleanup: 2 мин.
- Проверка: 5 мин.
- Delivery: 2 мин.

Ретроспектива:

- Базовое время: 23 мин.
- Коэффициент: 1.30
- Оплачиваемое время: 30 мин.
- Ставка: 2000 ₽ / час.
- Формула: 30 мин × 2000 ₽ / 60 мин = 1 000,00 ₽.

2026-03-15 15:46 | 1 300,00 ₽ | 39 мин | Турниры/backend+ui+deploy: у модалки сетки и training-state снят ложный отказ доступа для legacy турниров вроде `#3` — проверка участия теперь читает общий состав из `playerOrder` и `players`, а не только из relation, поэтому сетка и связанные read-path больше не падают на старом drift. Дополнительно `Этап не пройден` унифицирован в один серый tone, чтобы этот статус больше не раскрашивался по-разному у разных игроков.

Разбивка:

- Погружение: 8 мин.
- Проектирование: 4 мин.
- Реализация: 6 мин.
- Cleanup: 2 мин.
- Проверка: 6 мин.
- Delivery: 4 мин.

Ретроспектива:

- Базовое время: 30 мин.
- Коэффициент: 1.30
- Оплачиваемое время: 39 мин.
- Ставка: 2000 ₽ / час.
- Формула: 39 мин × 2000 ₽ / 60 мин = 1 300,00 ₽.

2026-03-15 15:32 | 1 400,00 ₽ | 42 мин | Турниры/backend+runtime-smoke+deploy: устранено production-падение общего start-flow при нажатии `Начать игру` — reusable-selector в транзакции больше лочит только строки турниров, а не nullable-сторону `LEFT JOIN players`, поэтому ошибка Postgres `FOR UPDATE cannot be applied to the nullable side of an outer join` снята для shared path, который используется `training` и `money` режимами.

Разбивка:

- Погружение: 8 мин.
- Проектирование: 4 мин.
- Реализация: 4 мин.
- Cleanup: 2 мин.
- Проверка: 8 мин.
- Delivery: 6 мин.

Ретроспектива:

- Базовое время: 32 мин.
- Коэффициент: 1.30
- Оплачиваемое время: 42 мин.
- Ставка: 2000 ₽ / час.
- Формула: 42 мин × 2000 ₽ / 60 мин = 1 400,00 ₽.

2026-03-15 15:23 | 500,00 ₽ | 15 мин | Учёт стоимости/history+format+deploy: формат `Время выполнения` приведён к одному человекочитаемому виду по всей истории — вместо десятичных значений `1,28 ч` и `51,75 мин` теперь везде используются только записи вида `N ч M мин`, `N ч` или `N мин`.

Разбивка:

- Погружение: 3 мин.
- Проектирование: 2 мин.
- Реализация: 3 мин.
- Cleanup: 2 мин.
- Проверка: 3 мин.
- Delivery: 2 мин.

2026-03-15 15:00 | 1 500,00 ₽ | 45 мин | Учёт стоимости/backend+frontend+retrofix+deploy: восстановлены согласованные исторические суммы после неудачной миграции формата, в общий итог проекта добавлена скрытая базовая стоимость `635 000`, а сайт переведён на клиентский вид без внутренних формул — теперь в таблице показываются только описание задачи и структурированная `Разбивка` списком с отступом.

Разбивка:

- Погружение: 8 мин.
- Проектирование: 6 мин.
- Реализация: 10 мин.
- Cleanup: 5 мин.
- Проверка: 8 мин.
- Delivery: 8 мин.

2026-03-15 14:51 | 1 725,00 ₽ | 52 мин | Учёт стоимости/rules+admin+retrofix+deploy: логика стоимости проекта переведена на новый канон `2000 ₽ / час`, где коэффициент применяется только к времени, а не к уже посчитанной сумме; backend parser и админский UI были доработаны под многострочный формат истории с пустой строкой перед `Разбивка` и вертикальным перечнем, после чего весь журнал стоимости был пересчитан и отформатирован по единому правилу.

Разбивка:

- Погружение: 7 мин.
- Проектирование: 5 мин.
- Реализация: 10 мин.
- Cleanup: 5 мин.
- Проверка: 10 мин.
- Delivery: 8 мин.

2026-03-15 14:36 | 2 559,38 ₽ | 1 ч 17 мин | Турниры/backend+data-fix+deploy: найден и закрыт legacy drift `money + leagueAmount=null` без финансовых артефактов — audit теперь детерминированно ловит такие записи, а repair безопасно переводит их в `training`, не подменяя ставку и не создавая фальшивые escrow/tx. Локально подтверждены backend test/build, audit с детектором `money_missing_league_amount`, цикл `repair:tournaments` и localhost health `3000/3001` + `smoke:stability`; затем выполнены commit/push/deploy, production repair, production re-audit `totalIssueCount = 0`, точечная post-check по `турниру 8 -> training` и повторный money preview `5L -> 10`.

Разбивка:

- Погружение: 8 мин.
- Проектирование: 5 мин.
- Реализация: 10 мин.
- Cleanup: 4 мин.
- Проверка: 8 мин.
- Delivery: 10 мин.

2026-03-15 14:21 | 5 118,75 ₽ | 2 ч 34 мин | Турниры/full-stack+smoke+deploy: reusable/start-flow и resume-flow доведены до одного backend source of truth — `training` переведён на транзакционный selector как у `money`, `getMyTournaments()` теперь отдаёт канонический `resumeTournamentId`, `Profile` перестал локально сортировать `continueTarget` и восстанавливать `joinInfo`, а для browserless verification добавлен read-only preview script `preview:reusable-tournaments`. Локально подтверждены backend test/build, frontend lint/test/build, `verify:tournaments`, localhost health `3000/3001` и `smoke:stability`; затем выполнены commit/push/deploy, production health-check `200`, production audit `totalIssueCount = 0` и production preview, где после выката канонические кандидаты равны `training -> 3`, `money 5L -> 10`.

Разбивка:

- Погружение: 12 мин.
- Проектирование: 8 мин.
- Реализация: 26 мин.
- Cleanup: 8 мин.
- Проверка: 22 мин.
- Delivery: 14 мин.

2026-03-15 13:59 | 2 843,75 ₽ | 1 ч 25 мин | Турниры/backend+rules+deploy: канон выбора reusable-турнира переведён на строгий `минимальный ID` вместо приоритета более заполненной сетки, поэтому новые игроки в `training` и `money` теперь попадают в самый ранний подходящий незавершённый турнир. Регресс закреплён unit-тестом и документацией (`TOURNAMENT_LOGIC`, `QA_CHECKLIST`), локально подтверждены backend test/build/audit, localhost health `3000/3001` и `smoke:stability`; затем выполнены commit/push/deploy, production health-check `200`, production audit `totalIssueCount = 0` и post-check открытого пула, где кандидатами стали `training -> 3`, `money -> 8`.

Разбивка:

- Погружение: 8 мин.
- Проектирование: 5 мин.
- Реализация: 6 мин.
- Cleanup: 3 мин.
- Проверка: 15 мин.
- Delivery: 13 мин.

2026-03-15 13:22 | 5 403,13 ₽ | 2 ч 42 мин | Турниры/full-stack+repair-pipeline+deploy: турнирный lifecycle доведён до одного канонического потока — `prepareTrainingState` окончательно отделён как writer-path от read-only `getTrainingState`, собран единый repair entry-point `fix:tournaments`, audit расширен проверками money escrow drift, а `Profile`/`Admin` переведены на общий session mapper и shared modal query-state hook, чтобы live-session, review modals и URL-state больше не расходились между training и money режимами. Дополнительно синхронизированы docs/checklist и root verification scripts (`verify:tournaments`, `repair:tournaments`). Локально подтверждены backend test/build/audit, frontend lint/test/build, локальный repair pipeline, `dev:live` smoke `3000/3001` и `smoke:stability`; затем выполнены commit/push/deploy, production health-check `200` и production `node dist/scripts/audit-tournaments.js` с `totalIssueCount = 0`.

Разбивка:

- Погружение: 18 мин.
- Проектирование: 12 мин.
- Реализация: 34 мин.
- Cleanup: 10 мин.
- Проверка: 22 мин.
- Delivery: 18 мин.

2026-03-15 12:58 | 1 968,75 ₽ | 59 мин | Турниры/backend+data-fix+deploy: найден и устранён legacy drift, из-за которого underfilled training-турниры (`2`- и `3`-игроковые, включая кейс `турнир 3`) ошибочно переводились в `finished` и получали `tournament_result`, хотя по канону должны оставаться доигрываемыми в `active`. Опасный head-to-head backfill переведён в безопасный repair-path, `completeTournament` перестал писать result для структурно незавершаемых сеток, audit усилен проверкой `finished_underfilled_tournaments`, а maintenance-скрипт теперь возвращает такие турниры в `active` и удаляет stale result-строки. Локально подтверждены backend test/build, `audit:tournaments` до и после repair, localhost health `3000/3001`; затем выполнены commit/push/deploy, production retrofix для всех аналогичных записей и production re-audit/точечная post-check по `турниру 3`.

Разбивка:

- Погружение: 7 мин.
- Проектирование: 5 мин.
- Реализация: 10 мин.
- Cleanup: 3 мин.
- Проверка: 10 мин.
- Delivery: 10 мин.

2026-03-15 12:42 | 1 093,75 ₽ | 33 мин | Турниры/backend+data-fix+deploy: правило ужесточено по уточнению заказчика — теперь в `active` переводятся вообще все незавершённые турниры, включая одиночные лобби без `progress`, а новые training/money турниры создаются сразу как `active`, чтобы остальные игроки всегда могли добрать их и продолжить игру. Audit усилен до детектора любого `waiting`-турнира, локально подтверждены backend test/build, `audit:tournaments`, localhost health `3000/3001`, затем выполнены commit/push/deploy, production retrofix и production re-audit без оставшихся `waiting`-турниров.

Разбивка:

- Погружение: 3 мин.
- Проектирование: 3 мин.
- Реализация: 6 мин.
- Cleanup: 2 мин.
- Проверка: 4 мин.
- Delivery: 6 мин.

2026-03-15 12:38 | 2 464,58 ₽ | 1 ч 14 мин | Турниры/backend+data-fix+deploy: незавершённые турниры переведены на новое правило жизненного цикла — `waiting` с реальной активностью (`progress` или минимум 2 игрока) автоматически поднимается в `active`, join-пул в training/money теперь в приоритете добирает уже идущие незавершённые турниры, добавлен production-safe backfill `fix:activate-unfinished-tournaments`, а audit расширен детектором `waiting_started_not_active`. Локально подтверждены backend test/build, `audit:tournaments` до и после retrofix, localhost health `3000/3001`; затем выполнены commit/push/deploy, production backfill и production re-audit без оставшихся `waiting_started_not_active`.

Разбивка:

- Погружение: 8 мин.
- Проектирование: 6 мин.
- Реализация: 12 мин.
- Cleanup: 4 мин.
- Проверка: 10 мин.
- Delivery: 12 мин.

2026-03-15 12:10 | 2 725,26 ₽ | 1 ч 22 мин | Турниры/backend+frontend+audit+deploy: read-contract турнирных экранов выровнен с backend source of truth — `questions review` больше собирается на сервере готовыми `reviewRounds`, админская таблица перестала терять machine-readable `resultKind/resultTone/listBucket/canContinue`, профиль перестал подставлять фальшивые fallback-статусы и счётчики, а определение финального соперника в shared start-path теперь идёт через общий pair-resolution вместо локальной догадки. Дополнительно добавлен повторяемый `backend audit:tournaments` и unit-тесты для round-review helper; локально подтверждены `backend build/test/audit:tournaments`, `Frontend lint/test/build`, `dev:live` smoke `3000/3001`, затем выполнены commit/push/deploy, production health-check `200` и production `node dist/scripts/audit-tournaments.js` с `totalIssueCount = 0`.

Разбивка:

- Погружение: 13 мин.
- Проектирование: 7 мин.
- Реализация: 14 мин.
- Cleanup: 4 мин.
- Проверка: 15 мин.
- Delivery: 12 мин.

2026-03-15 11:49 | 546,88 ₽ | 16 мин | Frontend/tests+hygiene+deploy: вычищен оставшийся шум test output — `MemoryRouter` в route-state тестах переведён на явные future flags, а `@testing-library/react` и `@testing-library/user-event` обновлены до актуальных версий, чтобы `vitest` больше не печатал deprecated `act` и React Router future warnings. Локально подтверждены `npm test`, `npm run lint` и `npm run build` без новых проблем; затем выполнены commit/push/deploy и production-check.

Разбивка:

- Погружение: 4 мин.
- Проектирование: 2 мин.
- Реализация: 4 мин.
- Cleanup: 1 мин.
- Проверка: 2 мин.
- Delivery: 2 мин.

2026-03-15 11:46 | 656,25 ₽ | 20 мин | Frontend/hygiene+deploy: дочищен линтерный хвост после миграции с CRA — из `App`, `Profile`, `SupportChat` и `index` убраны неиспользуемые `catch`-переменные, мёртвый `goNextRound`, лишний `eslint-disable` и unused props/vars без изменения пользовательской логики. Локально подтверждены `npm run lint`, `npm test`, `npm run build` и localhost smoke `http://localhost:3000 = 200`; затем выполнены commit/push/deploy и production-check.

Разбивка:

- Погружение: 4 мин.
- Проектирование: 2 мин.
- Реализация: 5 мин.
- Cleanup: 2 мин.
- Проверка: 3 мин.
- Delivery: 2 мин.

2026-03-15 11:39 | 1 760,94 ₽ | 53 мин | Frontend/dependencies+tooling+deploy: фронт полностью снят с `react-scripts`-цепочки — сборка и dev-server переведены на `Vite`, тесты на `Vitest`, lint теперь живёт на явном локальном `ESLint`-конфиге, старые CRA `index.html` и `setupProxy` удалены, а все backend-префиксы (`/api`, `/auth`, `/users`, `/tournaments`, `/payments`, `/admin`, `/support`, `/news`) перенесены в Vite proxy без смены `HashRouter`, порта `3000` и выходной папки `Frontend/build`. Локально подтверждены `Frontend npm audit = 0`, frontend build/test/lint, localhost health `3000/3001`, отдача публичных ассетов и proxy-smoke через `Vite`; затем выполнены commit/push/deploy и production-check.

Разбивка:

- Погружение: 8 мин.
- Проектирование: 6 мин.
- Реализация: 12 мин.
- Cleanup: 4 мин.
- Проверка: 6 мин.
- Delivery: 6 мин.

2026-03-15 11:28 | 875,00 ₽ | 26 мин | Админка/data-fix+deploy: вычищены ошибочные future-timestamps во вкладке `Стоимость проекта` — 4 legacy-строки за 2026-03-15 с невозможными временами `12:44`, `12:23`, `12:06` и `11:34` приведены к фактической утренней chronology по сегодняшним delivery-коммитам (`10:41`, `10:23`, `10:13`, `10:03`), чтобы в истории больше не появлялись записи «из будущего» относительно текущего московского времени. После правки подтверждены локальный smoke `getProjectCostDashboard()`, commit/push/deploy и production-check по `/admin/project-cost` service-path и public health-check.

Разбивка:

- Погружение: 5 мин.
- Проектирование: 4 мин.
- Реализация: 4 мин.
- Cleanup: 2 мин.
- Проверка: 4 мин.
- Delivery: 5 мин.

2026-03-15 11:24 | 2 126,95 ₽ | 1 ч 4 мин | Backend/dependencies+deploy: добит residual runtime npm audit до нуля — для `@nestjs/common` зафиксирован безопасный `file-type@21.3.2` через `overrides`, а `@nestjs/platform-express` и `@nestjs/testing` доведены до `11.1.16` для выравнивания Nest-стека. Локально подтверждены `npm audit --omit=dev --omit=optional = 0`, backend build/test/test:e2e и фактические версии `file-type 21.3.2` + `@nestjs/platform-express 11.1.16`; затем выполнены commit/push/deploy и production runtime-audit-check.

Разбивка:

- Погружение: 8 мин.
- Проектирование: 5 мин.
- Реализация: 8 мин.
- Cleanup: 3 мин.
- Проверка: 11 мин.
- Delivery: 10 мин.

2026-03-15 11:20 | 2 126,95 ₽ | 1 ч 4 мин | Админка/backend+frontend+deploy: устранён рассинхрон во вкладке `Стоимость проекта` — backend больше не берёт верхнее время из filesystem `mtime`, а сортирует историю по реальному `YYYY-MM-DD HH:MM` и возвращает timestamp последней записи; во frontend подпись переименована в `Последняя запись в истории`, чтобы она совпадала с таблицей. Локально подтверждены backend build/test, frontend build и smoke-вызов `getProjectCostDashboard()` с `updatedAt=12:44` и первой строкой истории `12:44`.

Разбивка:

- Погружение: 8 мин.
- Проектирование: 6 мин.
- Реализация: 8 мин.
- Cleanup: 4 мин.
- Проверка: 9 мин.
- Delivery: 10 мин.

2026-03-15 11:14 | 3 763,26 ₽ | 1 ч 53 мин | Infra/deploy+dependencies: продовый deploy-поток ужесточён против npm-risk — root install на сервере убран, `backend` ставится без optional-драйверов и после сборки prunes dev/optional deps, а `Frontend/node_modules` удаляется сразу после build, чтобы уязвимый build-toolchain не оставался на проде. Дополнительно backend переведён на актуальный Nest/Express-стек, убран лишний `sqlite3` runtime-tail и поправлена strict-типизация CORS; локально подтверждены backend build/test/test:e2e, frontend build и deploy-script syntax-check.

Разбивка:

- Погружение: 18 мин.
- Проектирование: 12 мин.
- Реализация: 20 мин.
- Cleanup: 8 мин.
- Проверка: 18 мин.
- Delivery: 14 мин.

2026-03-15 10:50 | 2 527,78 ₽ | 1 ч 16 мин | Турниры/финансы/backend+data-fix+deploy: денежный tournament settlement переведён на безвозвратный канон — при отсутствии чемпиона escrow теперь закрывается как `forfeited`, а не `refund`; repair/audit-пайплайн синхронизирован под новый исход и локально вычистил legacy `refunded`/result-артефакты в money-турнирах. После backend test/build/test:e2e и цикла `audit -> repair -> audit` турнирный drift снят, а в локальном audit остались только старые несвязанные finance-case issues.

Разбивка:

- Погружение: 14 мин.
- Проектирование: 8 мин.
- Реализация: 18 мин.
- Cleanup: 8 мин.
- Проверка: 18 мин.
- Delivery: 14 мин.

2026-03-15 10:41 | 3 307,08 ₽ | 1 ч 39 мин | Финансы/backend+data-fix+deploy: у `user 1` разобран legacy drift вокруг `tx302` и L-конвертаций — синтетическая recovery-запись удалена, а пары `tx25/26` и `tx35/36` нормализованы под реальный ledger-остаток после восстановления money-турниров; дополнительно finance audit теперь детерминированно ловит `convert`-операции, превышающие доступный L-баланс. После backend build/test, commit/push/deploy выполнены production manual-fix script, re-audit без drift и точечная post-check по `tx25/26/35/36`, отсутствию `tx302` и `balance=50` у `user 1`.

Разбивка:

- Погружение: 14 мин.
- Проектирование: 8 мин.
- Реализация: 12 мин.
- Cleanup: 4 мин.
- Проверка: 14 мин.
- Delivery: 8 мин.

2026-03-15 10:23 | 2 126,95 ₽ | 1 ч 4 мин | Турниры/backend+data-fix+deploy: production-wide audit по всем турнирам выявил ещё один legacy-класс drift — `tournament_result` в `waiting/active` турнирах; audit/repair расширены правилом, что до `finished` result-строк быть не должно, после чего выполнены backend build/test, commit/push/deploy, production repair/re-audit и точечная post-check по `T10/T11/T29/T55/T56/T57/T59/T64` без оставшихся result/settlement artifacts.

Разбивка:

- Погружение: 10 мин.
- Проектирование: 6 мин.
- Реализация: 8 мин.
- Cleanup: 4 мин.
- Проверка: 9 мин.
- Delivery: 8 мин.

2026-03-15 10:13 | 3 071,88 ₽ | 1 ч 32 мин | Турниры/финансы/backend+data-fix+deploy: восстановлен legacy-класс `waiting + single-player + refund/result artifacts` — из repair и audit удаляются преждевременные `refund/win` и `tournament_result`, а escrow возвращается в `held`, чтобы в такие money-турниры снова могли заходить соперники и играть по канонической логике; после backend test/build, commit/push/deploy выполнены production repair, повторный full finance audit без drift и точечные проверки по `T12/T13/T23-T27` и `/users/transactions`.

Разбивка:

- Погружение: 8 мин.
- Проектирование: 6 мин.
- Реализация: 10 мин.
- Cleanup: 4 мин.
- Проверка: 10 мин.
- Delivery: 12 мин.

2026-03-15 10:03 | 3 412,50 ₽ | 1 ч 43 мин | Турниры/финансы/backend+data-fix+deploy: settlement money-турниров переведён на канонический bracket resolver, поэтому `refund/win` больше не создаются до реального финального исхода; repair/audit-пайплайн больше не считает одиночный `passed=1` в недозаполненном турнире достаточным для выплаты и в production автоматически откатил 7 преждевременно закрытых money-турниров из `finished/refunded|win` обратно в `active/held`, после чего выполнены backend test/build, commit/push/deploy, production repair, повторный full finance audit без drift и точечная post-check в БД по `T11`.

Разбивка:

- Погружение: 12 мин.
- Проектирование: 10 мин.
- Реализация: 16 мин.
- Cleanup: 6 мин.
- Проверка: 12 мин.
- Delivery: 16 мин.

2026-03-15 10:40 | 1 509,38 ₽ | 45 мин | Профиль/backend+timeline-fix: расследована причина неверного столбца `Стало` у `player 1` — running balance в `/users/transactions` считался по порядку вставки `id`, а не по реальному `createdAt`, из-за чего backdated recovery-транзакции `301/302` искажали исторический баланс; timeline-логика вынесена в отдельный helper, read-path переведён на хронологический расчёт, добавлен регрессионный тест на legacy backfill-порядок, после чего выполнены backend build/test, commit/push/deploy, public health-check и auth-зависимый production endpoint-check `/users/transactions`.

Разбивка:

- Погружение: 6 мин.
- Проектирование: 5 мин.
- Реализация: 7 мин.
- Cleanup: 4 мин.
- Проверка: 6 мин.
- Delivery: 8 мин.

2026-03-15 10:02 | 1 886,72 ₽ | 57 мин | Профиль/backend+frontend+deploy: в историю транзакций добавлен столбец `Стало`, при этом `/users/transactions` теперь возвращает machine-readable `balanceAfterRubles` и `balanceAfterL`, рассчитанные тем же ledger-алгоритмом, что и текущий профильный баланс; после backend build/test, frontend build, commit/push/deploy выполнены public health-check и auth-зависимый production endpoint-check `/users/transactions` с новыми running-balance полями.

Разбивка:

- Погружение: 6 мин.
- Проектирование: 5 мин.
- Реализация: 10 мин.
- Cleanup: 4 мин.
- Проверка: 8 мин.
- Delivery: 12 мин.

2026-03-15 09:37 | 766,63 ₽ | 23 мин | Профиль/frontend: в истории транзакций отображение description упрощено без изменения backend-ledger contract — все topup-пополнения в кабинете показываются как `Пополнение баланса`, а `Вывод средств одобрен (requestId N)` локально переводится в `Вывод средств одобрен (заявка N)`; после frontend build, commit/push/deploy выполнен production health-check

2026-03-15 09:24 | 1 531,25 ₽ | 46 мин | Профиль/frontend+URL-state: история транзакций в кабинете разделена на две вкладки `Рубли` и `L`, при этом transaction-таб, фильтр категории, диапазон дат и сортировка переведены в `search params`, а соседние переходы внутри кабинета перестали затирать query string; после frontend build, commit/push/deploy выполнен production health-check, но auth-зависимый F5/back-forward smoke кабинета без тестовых учётных данных автоматом не был воспроизведён

2026-03-15 09:06 | 1 968,75 ₽ | 59 мин | Full finance recovery/manual-review+data-fix+deploy: по явному согласию закрыты 2 оставшихся ambiguous legacy-кейса — для `user 1` восстановлены missing opening `100 L`, missing `5 L` перед `tx #25` и ранняя `createdAt` из swap-aftermath evidence, а `tx #232` у `user 2` нормализован как подтверждённый legacy ruble topup без ложного `tournamentId`; затем выполнены backend build/test, commit/push/deploy, production manual-fix script и повторный full audit с нулём deterministic/manual drift

2026-03-15 08:55 | 4 550,00 ₽ | 2 ч 17 мин | Full finance recovery/backend+data-fix+deploy: добавлен production-wide audit `transaction/payment/withdrawal/escrow/result/user`, введён единый deterministic repair pipeline для missing withdrawal descriptions, missing refund/win ledger rows и batch reconcile stored balances, а runtime read/write-paths переведены на канонический ledger с row-lock защитой; после backend test/build, commit/push/deploy выполнены production audit -> repair -> re-audit, где deterministic drift обнулён, а 2 legacy-кейса оставлены в manual-review по согласованной политике

2026-03-15 08:21 | 1 727,12 ₽ | 52 мин | Баланс игрока 1/backend+data-fix: полная ревизия прод-истории показала, что `tx #1` — это legacy admin topup в категории `other`, из-за чего текущий код уводил `+100 ₽` в L-баланс; расчёт рублёвого/L-баланса усилен обработкой таких legacy admin-topup описаний, backfill-скрипт переведён на рублёвую нормализацию и пересчёт stored balance-полей для затронутых пользователей, после чего выполнены build/test, commit/push/deploy и production-check

2026-03-15 08:09 | 2 165,63 ₽ | 1 ч 5 мин | Профиль+баланс/backend+frontend+data-fix: лимит ника снижен до `15` на фронте и в backend write-path, а причина сдвига рублёвого баланса найдена в ретрофиксе legacy-транзакции `id=1`, которую нельзя было переводить из `other` в `topup`; backfill-скрипт исправлен на сохранение целевой категории по каждой записи, после чего выполнены локальные build/test, commit/push/deploy и production-перепроверка расчёта

2026-03-15 07:57 | 656,25 ₽ | 20 мин | Профиль/frontend: устранён runtime-crash кабинета `BRACKET_NAME_MAX_LEN is not defined` — в `Profile.tsx` восстановлен фронтовый лимит ника по реальному backend contract (`100`), после чего пройдены frontend build, commit/push, production deploy и проверка загрузки кабинета

2026-03-15 07:50 | 1 531,25 ₽ | 46 мин | Прод-БД/админка: найдено, что спорные legacy-начисления действительно шли через `POST /admin/credit-balance`, но старый write-path не сохранял автора; добавлен отдельный backfill-скрипт с выборкой `до/после` для ретровосстановления подтверждённых adminId по legacy manual topup, после чего подготовлены commit/push/deploy и production endpoint-check

2026-03-15 07:37 | 1 509,38 ₽ | 45 мин | Админка/backend+frontend: для legacy-начислений возвращён подтверждённый self-admin fallback только там, где старый `topup` реально принадлежит админ-аккаунту, старый `users/add-balance` переведён на структурированную запись автора начисления, а пустая ячейка `Админ` в истории удерживает нормальную высоту; локально пройдены backend test/build, frontend build и runtime-check через `dev:live`, затем подготовлены commit/push/deploy и production-check

2026-03-15 07:27 | 656,25 ₽ | 20 мин | Админка/backend: найден финальный баг attribution-слоя — даже после обнуления `adminId` legacy-строки продолжали брать `adminUsername/adminEmail` прямо из SQL-джойна по `tournamentId=userId`, поэтому игрок всё ещё отображался как админ; read-path исправлен так, что joined admin поля используются только при подтверждённом `adminId`, после чего выполнены backend build/test/e2e, commit/push/deploy и target endpoint-check

2026-03-15 07:24 | 765,63 ₽ | 23 мин | Админка/backend+frontend: проверка прод-БД показала, что у legacy-начислений `Пополнение баланса` поле `tournamentId` часто равно самому `userId`, поэтому колонка `Админ` ложно дублировала игрока; fallback исправлен так, что generic legacy topup теперь не выдают псевдо-админа, а пустые ячейки в таблице удерживают ту же высоту через placeholder-email стиль; выполнены локальные build/smoke, commit/push/deploy и production-check

2026-03-15 07:18 | 437,50 ₽ | 13 мин | Админка/frontend: вкладка `Начисление` больше не держит залипший пустой список — история начислений теперь перезапрашивается при входе в раздел и автообновляется каждые 5 секунд, чтобы после backend-фиксов и новых начислений UI не оставался на первом неудачном ответе; выполнены frontend build/smoke, commit/push/deploy и production-check

2026-03-15 07:12 | 656,25 ₽ | 20 мин | Админка/backend: финально расширен SQL-охват `getCreditHistory()` — теперь в выборку реально попадают legacy `topup/other`, а не только новый admin-format; это исправляет пустую историю на проде, где ручные начисления хранились как обычные `Пополнение баланса`; локально пройдены backend build/test/e2e/smoke, затем выполнены commit/push/deploy и production-check

2026-03-15 07:09 | 656,25 ₽ | 20 мин | Админка/backend: история начислений расширена под реальные legacy-записи прод-БД — помимо нового admin-format теперь читаются старые `topup/other` с описанием `Пополнение баланса` и `Пополнение баланса (скрипт)`, при этом provider-topup остаются исключёнными; локально пройдены backend build/test/e2e, подготовлен production deploy

2026-03-15 06:59 | 765,63 ₽ | 23 мин | Админка/backend: восстановлено чтение `История начислений` — `AdminService.getCreditHistory()` переведён на корректные Postgres-имена колонок (`\"userId\"`, `\"createdAt\"`, `\"tournamentId\"`), из-за которых raw SQL раньше падал в `catch` и фронт видел пустой список; локально пройдены backend build/test/e2e/smoke, затем выполнены commit/push/deploy и production-check

2026-03-15 06:51 | 437,50 ₽ | 13 мин | Delivery: получен рабочий root SSH-доступ, frontend fix для withdrawals-деплоя выкачен на `95.163.226.154`, сервер обновлён до коммита `60df35a`, `pm2` перезапущен, remote health-check внутри deploy дал `200`, а публичный `https://legendgames.space/api/health` после выката подтвердил `200 OK`

2026-03-15 06:16 | 656,25 ₽ | 20 мин | Админка: смена фильтра статуса в `Заявки на вывод` больше не сбрасывает раздел в статистику — URL для withdrawals теперь синхронизируется через единый effect с обязательным `tab=withdrawals`, а регресс закрыт отдельным route-state тестом; локально пройдены frontend test/build, dev health и smoke, production deploy по-прежнему заблокирован отсутствием SSH-доступа

2026-03-15 06:13 | 670,83 ₽ | 20 мин | Deploy tooling: `scripts/deploy-prod.sh` теперь автоматически подхватывает локальный `.env.deploy.local`, добавлен `.env.deploy.example` и обновлены инструкции переноса/деплоя; shell-proof показал загрузку env-файла, но production deploy по-прежнему блокируется отсутствием авторизованного SSH-доступа к серверу

2026-03-15 06:08 | 838,54 ₽ | 25 мин | Админка: вкладка `Заявки на вывод` больше не сбрасывается в статистику — теперь раздел всегда пишет `tab=withdrawals` в URL, старые ссылки вида `?status=...` остаются совместимыми, добавлены route-state тесты и выполнены frontend build, local health/smoke, commit/push; production deploy остановился из-за отсутствующих `DEPLOY_REMOTE_*` env

2026-03-15 07:05 | 437,50 ₽ | 13 мин | Админка: во вкладке пользователей удалена лишняя кнопка `Войти как пользователь`, потому что вход уже доступен по клику на ник; затем выполнены verify:ci, commit/push, frontend-only deploy и production-check

2026-03-15 06:55 | 1 093,75 ₽ | 33 мин | Админка: график overview-статистики больше не обрывается на последнем дне с событиями — backend `/admin/stats` теперь достраивает непрерывный период до текущего дня/недели/месяца и возвращает нулевые точки для пустых дат, затем выполнены verify:ci, перезапуск dev:live, commit/push/deploy и production-check

2026-03-15 06:40 | 18 375,00 ₽ | 9 ч 11 мин | Полный refactor-pass проекта по 5 фазам: усилены lint/test/CI и runtime e2e-check, read DTO и auth/session contracts, убраны hidden writes и stringly-typed зоны, вынесены общие tournament/user/payment contracts, декомпозированы части Profile/Admin через hooks и shared contracts, выровнены deploy/docs/legacy-слой, затем выполнены verify:ci, commit/push/deploy и production-check

2026-03-15 04:58 | 1 458,33 ₽ | 44 мин | Cursor rules: добавлено отдельное always-apply правило детального учёта стоимости по этапам реальной работы — погружение, проектирование, реализация, cleanup, проверка и delivery с мягкими коэффициентами риска вместо грубой оценки по размеру diff

2026-03-15 04:47 | 656,25 ₽ | 20 мин | Cursor rules: добавлено отдельное always-apply правило режимов рефакторинга с двумя состояниями — обязательный локальный refactor-pass после каждой правки и плановый полный refactor-pass по проекту с weekly cadence и коротким daily hygiene-проходом

2026-03-14 23:12 | 7 000,00 ₽ | 3 ч 30 мин | Архитектурный проход по зрелости проекта: рублёвый ledger переведён на структурированные payment/withdraw descriptions с repair-скриптом и локальным data-audit, backend write-path дочищен от inline DTO, cabinet route-state расширен `league`/`statsMode` как URL source of truth, slot logic по `playerOrder` вынесена в общий domain helper, а CI усилен frontend route-state test, backend helper tests и `npm ci` workflow

2026-03-14 22:37 | 3 500,00 ₽ | 1 ч 45 мин | Cleanup проекта: rules сведены к компактному каноническому набору с hygiene/evidence guards, безопасно удалены временные и неиспользуемые frontend-файлы, общий `PlayerStats` и список cabinet sections вынесены в единые точки, legacy scripts/docs помечены для следующего прохода, затем выполнены build/test/smoke, commit, push и production deploy-check

2026-03-14 22:10 | 8 312,50 ₽ | 4 ч 10 мин | Большой проход по стабилизации: платежный webhook переведён на явный ack/retry contract, рублёвый ledger и админские начисления сведены к одному topup-flow с подготовкой ретрофикса legacy `admin_credit`, турнирный progress/read flow частично нормализован через общий helper и `playerOrder` в write-path, support GET очищен от side effects с DTO-валидацией, кабинет и админка дочищены от лишнего route-state drift, а CI усилен runtime smoke-подъёмом backend с health-check

2026-03-14 21:39 | 656,25 ₽ | 20 мин | Cursor rules: добавлен always-apply playbook с обязательной последовательностью работы по каждому запросу — классификация задачи, поиск единого источника истины, порядок правок через domain→API→frontend, URL-state, ретрофикс данных, сценарная проверка, а затем tests/build, commit/push/deploy и production-check

2026-03-14 21:29 | 11 375,00 ₽ | 5 ч 41 мин | Глубокая стабилизация архитектуры: удалены секреты и небезопасные диагностические скрипты из корня, турнирный backend вынесен на общие constants/view-model с read-only `GET training-state` через explicit prepare-route, добавлены DTO и frontend API/contracts/hooks для турниров и auth-session, объединён question generator catalog, включены unit-тесты backend и CI smoke/test-проверки, упрощён основной startup flow

2026-03-14 20:52 | 546,88 ₽ | 16 мин | Cursor rules: добавлен отдельный always-apply hard-stop предохранитель для обязательного commit/push/deploy, явной production-проверки и запрета завершать ответ до успешного выката после любых правок, включая rules/docs/server-side изменения

2026-03-14 20:48 | 546,88 ₽ | 16 мин | Cursor rules: добавлен отдельный always-apply hard-stop предохранитель для обязательного пересчета стоимости, ретроучета пропусков и учета deploy/DB/server-side шагов перед каждым финальным ответом

2026-03-14 20:55 | 1 312,50 ₽ | 39 мин | Админка/учёт стоимости: исправлен raw SQL чтения заявок на вывод в `AdminService` для Postgres camelCase/snake_case колонок, заново проверен backend build, а журнал стоимости сверен с перепиской и дополнен пропущенными шагами

2026-03-14 20:40 | 1 093,75 ₽ | 33 мин | Прод-стабилизация: после деплоя диагностирован `502`, найден missing runtime dependency `express` в backend, обновлён dependency graph, локальная сборка перепроверена и подготовлен повторный production deploy с сохранением серверного env

2026-03-14 20:20 | 8 312,50 ₽ | 4 ч 10 мин | Стабилизация проекта: восстановлены auth/cabinet bootstrap и единая обработка 401/refresh, выровнены verify-code/payment/support маршруты под HashRouter, сведён production contract env/nginx/pm2/deploy, добавлены smoke-проверки и аудит auth/payment данных, документация синхронизирована с фактическим runtime

2026-03-14 19:40 | 4 156,25 ₽ | 2 ч 5 мин | Ретроучёт пропущенного шага: восстановлен production после `502` до этапа плана стабилизации — найдены и исправлены расхождения `pm2 env`/`backend/.env.production`, backend переведён в стабильный `fork`, nginx upstream и публичный `/api/health` выровнены под `127.0.0.1:3000`, активный конфиг очищен от дубликатов и приведён к одному symlink-источнику

2026-03-14 18:59 | 6 125,00 ₽ | 3 ч 4 мин | Стабилизация проекта: закрыты auth/payment/security дыры, денежные write-path и money tournament join переведены на транзакции, backend read-path и playerOrder-статистика дочищены, Profile/Admin/SupportChat переведены на URL-state без ручного hash-drifts, добавлены health endpoint, CI и smoke checklist, документация и deploy-конфиг выровнены

2026-03-14 18:27 | 1 312,50 ₽ | 39 мин | Турниры: финальный hard-pass по read-path — `getTournamentState` перестал удалять/создавать вопросы на GET, `getTrainingState` переведён на общие question/helper/resolver-правила для финала и тайбрейков, выполнен сценарный аудит оставшихся зон риска, backend пересобран и `dev:live` перезапущен

2026-03-14 18:20 | 1 968,75 ₽ | 59 мин | Турниры: три writer-пути (`completeTournament`, `tryAutoComplete`, `closeTimedOutRounds`) переведены на общий resolver/apply слой завершения турнира — убраны разъехавшиеся ветки записи победителя, устранено преждевременное завершение 1v1 как всего турнира, документация обновлена, backend пересобран, `dev:live` перезапущен

2026-03-14 18:11 | 1 640,63 ₽ | 49 мин | Турниры: `getMyTournaments` и `getTournamentBracket` переведены на read-only derived-state без скрытых `update/save/backfill` во время чтения — режим турнира и legacy-progress теперь нормализуются только в памяти, документация синхронизирована, `dev:live` перезапущен

2026-03-14 17:56 | 3 500,00 ₽ | 1 ч 45 мин | Турниры: локальный Postgres восстановлен через существующий cluster на 5433, внедрён explicit Variant B слой `tournament_round_resolution` с idempotent cron/backfill и resolution-first чтением для списков, state, training-state и bracket; документация обновлена, `dev:live` перезапущен

2026-03-14 17:30 | 1 093,75 ₽ | 33 мин | Турниры: timeout-резолв пары доведён до канонического варианта A — сценарий «оба проиграли по таймауту» теперь везде считается только после подтверждённого общего дедлайна пары и по целевому объёму текущего раунда, включая тайбрейки; cron, список турниров и solo-final ветки переведены на единый helper

2026-03-14 16:54 | 1 640,63 ₽ | 49 мин | Турниры: пустой слот и отсутствующий progress в полуфинальной паре окончательно переведены в строгий `waiting/incomplete` без скрытого автопрохода — сервер больше не создаёт ложного финалиста по одному живому участнику, а timeout-сценарии учитываются только после реального общего дедлайна пары; правило зафиксировано и в документации

2026-03-14 13:47 | 875,00 ₽ | 26 мин | Frontend: устранены предупреждения ESLint в `Profile.tsx` и `SupportChat.tsx`, которые мешали production-сборке в режиме `CI=true` — убран мёртвый код, очищены неиспользуемые state-переменные и приведены в порядок зависимости эффектов без изменения поведения кабинета и чата

2026-03-14 13:42 | 546,88 ₽ | 16 мин | Турниры: откатан неверный fallback полуфинального счёта в финальном слоте — если игрок ещё не начал финал, модалка теперь показывает честное `0/0`, а не прошлый результат полуфинала

2026-03-14 13:39 | 875,00 ₽ | 26 мин | Инфраструктура деплоя: хрупкая интерактивная expect-цепочка заменена на единый скрипт `scripts/deploy-prod.sh` с одной SSH-командой, перезапуском pm2 и встроенной проверкой `200`; правило проекта переведено на новый сценарий, чтобы деплой больше не обрывался после завершения сборки

2026-03-14 13:31 | 656,25 ₽ | 20 мин | Турниры: в финальном блоке сетки для единственного финалиста возвращён показ цифр под ником — если финал ещё не начат, модалка теперь показывает последний доступный счёт игрока по прохождению в финал вместо пустой строки

2026-03-14 13:27 | 765,63 ₽ | 23 мин | Турниры: после унификации этапов исправлено преждевременное `Ожидание соперника` — теперь победитель полуфинала без сформированного финального соперника видит этот статус только после того, как сам уже отыграл свой следующий раунд; до этого остаётся `Этап не пройден` и возможность пройти этап

2026-03-14 13:23 | 1 640,63 ₽ | 49 мин | Турниры: список и серверный backfill `getMyTournaments` переведены на одну общую логику этапов без отдельной ветки для 2-игроковых кейсов — старые `1v1` теперь считаются частным случаем той же сетки, где фиксируется победа в полуфинале и ожидание финального соперника вместо отдельного режима расчёта

2026-03-14 13:11 | 656,25 ₽ | 20 мин | Турниры: старые 2-игроковые кейсы в `getMyTournaments` снова трактуются как выигранный полуфинал, а не как окончательная победа всего турнира — активная запись остаётся с ожиданием соперника, а этапная победа уходит в историю отдельной строкой

2026-03-14 12:56 | 1 312,50 ₽ | 39 мин | Турниры: логика единственного финалиста после двойного таймаута в другом полуфинале переведена с автопобеды на обязательный финальный раунд — победа только при хотя бы одном правильном ответе, иначе поражение по 0 правильных или по истечению 24 часов; правило доведено до дедлайна, cron, списков, сетки и серверного backfill завершённых турниров

2026-03-14 12:35 | 546,88 ₽ | 16 мин | Админка/кабинет: при входе как пользователь теперь сохраняется исходный URL админки и возврат восстанавливает тот же раздел с теми же search params, включая фильтры и поиск в турнирах

2026-03-14 12:31 | 656,25 ₽ | 20 мин | Админка: для перехода в кабинет пользователя добавлено подтверждение через модалку — в турнирах теперь можно нажать прямо на ник игрока, а в списке пользователей подтверждение срабатывает и по нику, и по кнопке входа

2026-03-14 12:25 | 328,13 ₽ | 10 мин | Турниры: в общей модалке вопросов убраны номера `1/2` у полуфинала — таб, строка статистики и заголовок блока теперь везде показывают просто `Полуфинал`

2026-03-14 12:21 | 328,13 ₽ | 10 мин | Турниры: в общем компоненте сетки окончательно убраны номера `1/2` из заголовков полуфиналов и возвращён показ очков под никами в полуфинальных карточках, чтобы модалка снова отображала счёт прямо под именем игрока

2026-03-14 12:28 | 437,50 ₽ | 13 мин | Турниры: после выноса в общий компонент восстановлены подписи и статистика в пользовательских модалках — у полуфинала убраны лишние номера, а строка с очками по вопросам снова отображается вместо ошибочного скрытия

2026-03-14 12:18 | 1 093,75 ₽ | 33 мин | Турниры: модалки сетки и просмотра вопросов вынесены в общий `TournamentModals`-слой и подключены и в `Admin`, и в `Profile`, чтобы будущие правки структуры, табов, скрытия полуфинальных цифр и стилей больше не расходились между двумя отдельными JSX-копиями

2026-03-14 11:50 | 546,88 ₽ | 16 мин | Турниры: те же скрытие полуфинальных цифр и тёмные золотые табы дотянуты до админских модалок — раньше эти правки были только в пользовательском рендере, из-за чего в админке визуально ничего не менялось

2026-03-14 11:43 | 437,50 ₽ | 13 мин | Турниры: в пользовательской модалке вопросов скрыта полуфинальная цифровая статистика, а стиль табов переведён с синей заливки на чёрный вариант с золотым контуром только для игрока, без изменения админского визуала

2026-03-14 11:35 | 656,25 ₽ | 20 мин | Турниры: в пользовательской сетке скрыты полуфинальные цифры, а в админскую таблицу добавлен столбец режима игры с мягким расширением сохранённого набора колонок без сброса пользовательского порядка

2026-03-14 11:27 | 546,88 ₽ | 16 мин | Турниры: модалка просмотра вопросов переведена на реальный маршрут конкретного игрока — больше не подмешивает чужой полуфинальный допраунд вместо финала, а при открытии из строки `Финал` сразу показывает финальную вкладку и корректную статистику

2026-03-14 11:18 | 437,50 ₽ | 13 мин | Турниры: колонка `Вопросы` в строках этапов переведена на этапный показ — для `Полуфинал` остаются только полуфинальные вопросы с допраундами, для `Финал` только финальные, при этом модалка по клику по-прежнему открывает полный разбор всех ответов игрока по турниру

2026-03-14 11:13 | 875,00 ₽ | 26 мин | Турниры: resultLabel переведён на расширенный формат с очками и причиной поражения — сервер теперь отдаёт `Победа X-Y`, `Поражение X-Y` и `Поражение, время истекло`, а фронт обновлён на префиксную обработку таких статусов без жёсткой завязки на старые короткие строки

2026-03-14 11:02 | 328,13 ₽ | 10 мин | Турниры: исправлена финальная display-подмена для finished-турниров — история больше не затирает серверный `resultLabel` старым expired-fallback и не показывает ложную `Победа`, когда в `tournament_result` уже записано обоюдное поражение

2026-03-14 10:55 | 546,88 ₽ | 16 мин | Турниры: для старых finished-кейсов с ничейным финалом без чемпиона закреплено единое правило «оба проиграли по истечению времени» — серверный backfill теперь сохраняет всем `passed=0`, а списки/история показывают таким финалистам `Время истекло` вместо подвешенного результата

2026-03-14 10:48 | 328,13 ₽ | 10 мин | Турниры: дочищен фронтовый хвост после общего пакета фиксов — из админской модалки убрана оставшаяся неиспользуемая клиентская переменная источника, чтобы сборка не тащила лишнее предупреждение поверх уже исправленной единой серверной логики

2026-03-14 10:28 | 1 640,63 ₽ | 49 мин | Турниры: выполнен системный пакет фиксов логики — пересчёт ответов переведён на реальный порядок раундов, для финальных допраундов добавлен корректный таймерный переход, автозакрытие 1v1 по таймауту доведено до winner/status/result, модалка и список выровнены по общему timeline, а фронт очищен от оставшихся локальных догадок там, где они влияли на турнирное состояние

2026-03-14 10:15 | 765,63 ₽ | 23 мин | Турниры: исправлено разнесение finished-турниров по active/history — проигравший финалист больше не остаётся в активных только из-за того, что сам не начал финал; если финал уже определён общей логикой, запись уходит в историю с согласованным результатом

2026-03-14 10:08 | 656,25 ₽ | 20 мин | Турниры: модалки сетки в админке и профиле переведены на единый серверный источник правды — фронт больше не пересчитывает победителя финала по своим числам и использует только `finalWinnerId`, полученный из backend DTO

2026-03-14 10:00 | 875,00 ₽ | 26 мин | Турниры: список `getMyTournaments` переведён на ту же finished-логику финала, что и сетка/backfill — устранено затирание `tournament_result` при кейсе, когда один финалист закончил финал, а второй нет; для finished-турниров статус и результат финалистов теперь согласованы между модалкой и таблицей

2026-03-14 09:50 | 1 093,75 ₽ | 33 мин | Турниры: убрана ошибочная автопобеда при единственном финалисте — чемпион теперь определяется только по нормальному финалу или если противоположный полуфинал завершился сценарием «оба проиграли по таймауту»; дополнительно выполнен прямой ретропересчёт `tournament_progress` по finished-турнирам для выравнивания старых stage-агрегатов

2026-03-14 09:38 | 984,38 ₽ | 30 мин | Прод-БД: выполнен прямой аудит и ретрофикс завершённых 4-игроковых турниров по фактическому progress; обновлены неверные строки `tournament_result`, в том числе по турниру 52 чемпион восстановлен как игрок 2

2026-03-14 09:36 | 875,00 ₽ | 26 мин | Турниры: finished-backfill результатов расширен на кейс, когда один финалист закончил финал, а второй до финала не дошёл; такие завершённые турниры теперь получают корректного победителя по данным progress, что закрывает случай турнира 52

2026-03-14 09:32 | 1 312,50 ₽ | 39 мин | Турниры: добавлен серверный backfill результатов для завершённых 4-игроковых турниров — победители полуфиналов и финала теперь пересчитываются по фактическому progress и корректно записываются в `tournament_result`, чтобы случаи вроде турнира 52 автоматически восстанавливались после рестарта

2026-03-13 21:28 | 1 421,88 ₽ | 43 мин | Турнирные этапы: допраунды снова учитываются только после реальной ничьей на предыдущем шаге; убрано ложное суммирование лишних раундов в сетке и серверной логике, из-за которого обычные матчи начали показываться как `/20` и меняли победителя этапа

2026-03-13 21:16 | 984,38 ₽ | 30 мин | Турнирные модалки и серверная логика этапов: исправлен регресс после перевода на суммарный итог этапа — для завершённых турниров победитель этапа снова определяется по общей сумме очков, а в сетке оба игрока этапа теперь показываются от общего объёма вопросов этапа, включая допраунды

2026-03-13 21:02 | 1 640,63 ₽ | 49 мин | Турнирная логика этапов переведена на единый суммарный итог по этапу с учётом всех допраундов в полуфиналах и финалах; серверные расчёты победителя, перехода дальше, автозавершения и сетки синхронизированы, а на проде выполнена ретропроверка завершённых 4-игроковых турниров без найденных расхождений

2026-03-13 20:40 | 546,88 ₽ | 16 мин | Модалки сетки турниров: в финале победитель теперь помечается по той сумме очков, которая показана в самой модалке, без изменения остальной логики турниров и других мест интерфейса

2026-03-13 20:32 | 1 093,75 ₽ | 33 мин | Модалки сетки турниров: отображение счёта в полуфинале и финале переведено на итог по этапу с учётом допраундов, а пользовательская модалка профиля синхронизирована с серверным `finalWinnerId`, чтобы админка и профиль показывали одинаковые результаты

2026-03-13 20:12 | 656,25 ₽ | 20 мин | Админка стоимости проекта: добавлена 4-я метрика с общим временем по проекту, а главный блок переведён в лендинговый стиль с чёрным фоном, белой суммой и золотыми акцентами

2026-03-13 20:04 | 1 312,50 ₽ | 39 мин | Админка стоимости проекта: верхний блок упрощён до названия и суммы, убрана кнопка обновления, включено автообновление, описания в истории очищены от служебных пометок, а новые записи поддерживают время

2026-03-13 | 1 968,75 ₽ | 59 мин | Админка: добавлена новая подвкладка «Стоимость проекта» в статистике с отдельным дашбордом; бэкенд теперь читает `.cursor/project-cost-tracking.md`, отдаёт текущее `Стало`, «За сегодня», время обновления и историю изменений с расчётом «стало после прироста», а на фронте показаны крупный KPI-блок и таблица истории с датой, временем, длительностью и описанием задачи

2026-03-13 | 656,25 ₽ | 20 мин | Админка турниров: порядок столбцов теперь дублируется в localStorage и автоматически восстанавливается обратно в URL, если параметр `tournamentCols` пропал; это убирает самопроизвольный сброс пользовательской расстановки после навигации/обновления (база 12 мин × 1,5)

2026-03-13 | 875,00 ₽ | 26 мин | Админка турниров: модалка сетки переведена на единый расчёт победителя финала из бэкенда (`finalWinnerId`) по той же формуле, что и таблица/результаты, чтобы убрать расхождение между модалкой и списком по турниру 30 и всем аналогичным случаям (база 16 мин × 1,5)

2026-03-13 | 1 312,50 ₽ | 39 мин | Турниры: если в одном полуфинале оба игрока проиграли по таймауту, а во втором полуфинале есть победитель, он автоматически становится чемпионом; логика доведена до расчёта победителя, `userStatus`, результата финала без соперника и выплаты в money-режиме, затем выполнена подготовка к ретропроверке данных (база 18 мин × 2,0)

2026-03-13 | 656,25 ₽ | 20 мин | Турниры: 1v1 полностью исключены из логики `Пройден` — для них `userStatus` всегда `Не пройден`, потому что победа в таком матче считается только выигранным полуфиналом и не означает прохождение всего турнира; затем сборка, деплой и проверка прода (база 12 мин × 1,5)

2026-03-13 | 875,00 ₽ | 26 мин | Турниры: `userStatus` переведён на вычисление из фактического состояния турнира вместо опоры на сохранённый `tournament_result.passed` — в 4-игроковом турнире `Пройден` теперь только при реальной победе в финале, в 1v1 только при итоговой победе; это устраняет stale-данные в админке и профиле (база 16 мин × 1,5)

2026-03-13 | 765,63 ₽ | 23 мин | Турниры: колонка «Турнир» (`userStatus`) больше не получает `Пройден` за победу в полуфинале или ожидание финала — для дублируемой записи о пройденном этапе ПФ статус турнира теперь `Не пройден`; `Пройден` остаётся только у победителя всего турнира (база 14 мин × 1,5)

2026-03-13 | 984,38 ₽ | 30 мин | Турниры/админка: исправлено противоречие между active/history и статусом турнира — для активной записи теперь отдаётся вычисляемый display status (`waiting` или `active`), а `finished` остаётся только для истории; ошибочная правка про «Победа» в waiting-сценарии откатана (база 18 мин × 1,5)

2026-03-13 | 765,63 ₽ | 23 мин | Турниры 1v1: в getResultLabel исправлена ветка finished — победитель больше не получает «Ожидание соперника», а корректно видит «Победа»; это убирает противоречие между статусом турнира и результатом в списках/админке (база 14 мин × 1,5)

2026-03-13 | 656,25 ₽ | 20 мин | Админка турниров: обёртка таблицы сделана scroll-контейнером (overflow:auto + max-height:75vh), thead прилипает к top:0 внутри контейнера; убран весь JS-код для плавающей шапки и ResizeObserver; коммит/деплой/проверка прода (база 9 мин × 2,0)

2026-03-13 | 984,38 ₽ | 30 мин | Админка турниров: убрана отдельная JS-копия шапки и включён нативный sticky прямо на реальных th таблицы с offset от верхнего хедера; сохранено закрепление колонки ID и выполнены сборка/деплой на прод (база 13,5 мин × 2,0)

2026-03-13 | 1 093,75 ₽ | 33 мин | Админка турниров: плавающая шапка вынесена из горизонтального scroll-контейнера в отдельный sticky-слой с синхронизацией ширин и scrollLeft, чтобы строка заголовков реально закреплялась при вертикальной прокрутке; выполнены сборка и деплой на прод (база 15 мин × 2,0)

2026-03-13 | 984,38 ₽ | 30 мин | Админка турниров: вместо нестабильного CSS sticky добавлена отдельная плавающая строка заголовков, которая измеряет ширины колонок и прилипает под верхний хедер; подписи «Турнир/Статус/Результат» переставлены по запросу (база 18 мин × 1,5)

2026-03-13 | 765,63 ₽ | 23 мин | Админка турниров: строка заголовков привязана к реальной высоте верхнего sticky-хедера через ResizeObserver и CSS-переменную, чтобы прилипать строго под него при прокрутке (база 14 мин × 1,5)

2026-03-13 | 656,25 ₽ | 20 мин | Админка турниров: усилено закрепление шапки таблицы через отдельную обёртку и border-collapse separate, заголовок столбца «Статус турнира» переименован в «Турнир» (база 12 мин × 1,5)

2026-03-13 | 765,63 ₽ | 23 мин | Админка турниров: закреплены шапка и колонка ID при прокрутке, в столбце вопросов порядок значений изменён на всего/отвечено/правильно (база 14 мин × 1,5)

2026-03-13 | 1 093,75 ₽ | 33 мин | Турниры 1v1: найден и исправлен корневой перезаписывающий баг в getMyTournaments — finished head-to-head турниры больше не затирают победителя в passed=0 при каждом открытии списка игр (база 15 мин × 2,0)

2026-03-13 | 1 312,50 ₽ | 39 мин | Турниры 1v1: исправлена запись победителя в completeTournament и добавлен серверный backfill resolved head-to-head результатов/статусов по фактическому progress, чтобы массово восстановить старые finished/waiting турниры (база 18 мин × 2,0)

2026-03-13 | 984,38 ₽ | 30 мин | Админка турниров: модалки сетки и вопросов переведены на admin-просмотр от лица участника строки через отдельные роуты с userId, чтобы открывались турниры, где админ не является игроком (база 18 мин × 1,5)

2026-03-13 | 1 640,63 ₽ | 49 мин | Турниры: генерация уникальных вопросов по всему турниру — разнесены полуфиналы, финал и тайбрейки без повторов; обновлена документация и проверены открытые турниры в прод-БД на безопасный ретрофикс (база 22,5 мин × 2,0)

2026-03-13 | 1 093,75 ₽ | 33 мин | Документация: создан отдельный файл с полной картой логики турниров по коду проекта — сущность, режимы, этапы, active/history, прогресс, таймеры, escrow, модалки и админка (база 20 мин × 1,5)

2026-03-13 | 328,13 ₽ | 10 мин | Админка турниров: убрана кнопка сброса порядка столбцов, столбец «Результат» выровнен по центру (база 6 мин × 1,5)

2026-03-13 | 1 312,50 ₽ | 39 мин | Админка: ID турнира и вопросы в таблице сделали кликабельными с открытием модалок сетки и вопросов как у игрока; drag-and-drop столбцов перенесён с иконки на само название заголовка (база 24 мин × 1,5)

2026-03-13 | 765,63 ₽ | 23 мин | Админка: перестановка столбцов турниров через drag-and-drop за хэндл из точек вместо кнопок сдвига, с сохранением порядка в URL и визуальной подсветкой цели (база 14 мин × 1,5)

2026-03-13 | 437,50 ₽ | 13 мин | Cursor: закреплено отдельное always-apply правило о поведении по умолчанию после правок — коммит, push, деплой, проверка продакшена и расчёт стоимости (база 8 мин × 1,5)

2026-03-13 | 656,25 ₽ | 20 мин | Прод: безопасная очистка серверного репозитория через stash, git pull актуального main, сборка backend/frontend, pm2 restart и проверка ответа сайта (база 9 мин × 2,0)

2026-03-13 | 765,63 ₽ | 23 мин | Админка: перестановка столбцов в таблице турниров, кнопки сдвига в заголовках, сохранение порядка в URL и кнопка сброса (база 14 мин × 1,5)

2026-03-13 | 1 458,33 ₽ | 44 мин | Турниры у пользователей: исправлен runtime ReferenceError в getMyTournaments, восстановлены 28 tournament_entry из playerOrder на проде, убран риск затирания связи players (база 20 мин × 2,0)

2026-03-13 | 1 093,75 ₽ | 33 мин | Активные игры: backfill для training+money; TypeORM первым, raw fallback; mode по умолчанию training; «Загрузка…» для тренировки (база 20 мин × 1,5)

2026-03-13 | 270,00 ₽ | 8 мин | Противостояние: fallback raw SQL для ID (progress+entry), camelCase+snake_case; backfill snake_case при ошибке (база 10 мин × 1,5)

2026-03-13 | 393,75 ₽ | 12 мин | Противостояние: backfill из progress+entry; добавление игрока через INSERT в join + update(playerOrder), без save(tournament); откат через DELETE+update (база 15 мин × 1,5)

2026-03-13 | 270,00 ₽ | 8 мин | Противостояние: сбор ID только через TypeORM (progress, entry, players join), без raw SQL (база 8 мин × 1,5)

2026-03-13 | 145,00 ₽ | 4 мин | getMyTournaments: try/catch в контроллере — при ошибке 200 + empty; escrows/sync не ломают поток (база 5 мин × 1,5)

2026-03-13 | 245,00 ₽ | 7 мин | исправление 500: результат connection.query() — объект с .rows, брать result.rows (база 7 мин × 1,5)

2026-03-13 | 328,13 ₽ | 10 мин | противостояние: один SQL для ID (progress/entry/players), fallback snake_case; отдельный state gameHistoryMoney и «Загрузка…» на фронте (база 12 мин × 1,5)

2026-03-13 | 787,50 ₽ | 24 мин | противостояние: 4 источника ID (progress, entry ORM, entry raw, players raw), оба варианта колонок, нормализация mode в контроллере (база 18 мин × 1,5)

2026-03-13 | 1 092,71 ₽ | 33 мин | противостояние: список турниров по tournament_progress, не по join players (надёжный источник участия) (база 25 мин × 1,5)

2026-03-13 | 820,31 ₽ | 25 мин | getMyTournaments: не затирать денежные турниры (gameType NULL+leagueAmount → money; восстановление training+leagueAmount → money) (база 15 мин × 1,5)

2026-03-13 | 1 093,75 ₽ | 33 мин | админка «Турниры»: только поле поиска по ID (без кнопки), турниры всех игроков (training+money), колонки этап/старт раунда/осталось до конца/статус/вопросы (база 20 мин × 1,5)

2026-03-13 | 873,93 ₽ | 26 мин | админка «Турниры»: убрана кнопка, фильтр по ID турнира (URL), все колонки как у игрока + ник и фаза, бэкенд try/catch по пользователям (база 16 мин × 1,5)

2026-03-13 | 729,17 ₽ | 22 мин | админка «Турниры»: колонки статус турнира и дата создания, отображение ошибки загрузки, кнопка «Обновить», подписи статусов по-русски (база 12 мин × 1,5)

2026-03-13 | 1 367,19 ₽ | 41 мин | админка: вкладка «Турниры» в статистике — все турниры по всем игрокам, столбцы ID турнира, ник, ID игрока, фаза (активный/история), сортировка по ID (база 25 мин × 1,5)

2026-03-13 | 1 458,33 ₽ | 44 мин | победа/поражение только при «оба ответили» или «24 ч истекли»; первый финалист без таймера до прихода второго, таймеры при входе второго с учётом «ответил на все — таймер не запускается» (база 20 мин × 2,0)

2026-03-13 | 911,46 ₽ | 27 мин | турнир 52: переход в финал в модалке, таймер у финалистов, статус «Этап не пройден»/«Ожидание соперника» вместо «Поражение»/«Время истекло» (getResultLabel, getTournamentState, didUserWinSemiFinal, getTrainingState таймер)

2026-03-13 | 656,25 ₽ | 20 мин | выиграл ПФ, но не начал финал: турнир не в истории, в активных с доступом к финалу, в истории запись «Полуфинал» + «Победа» (анализ поведения + проектирование + правка)

2026-03-13 | 656,25 ₽ | 20 мин | этап в истории: только Полуфинал/Финал; победа в доп.раунде при завершении одним игроком → переход в финал

2026-03-13 | 437,50 ₽ | 13 мин | вопросы без ?????: двойная перекодировка в санитизаторе и в скрипте fix-question-encoding

2026-03-13 | 145,83 ₽ | 4 мин | в модалке турниров: «Ожидание игрока» → «Ожидание соперника»

2026-03-13 | 182,29 ₽ | 5 мин | бейдж в модалке турнира только по источнику (активные/история)

2026-03-13 | 393,75 ₽ | 12 мин | старт раунда в истории не позже даты завершения (cap)

2026-03-13 | 546,88 ₽ | 16 мин | дата завершения из реальных данных пары, иначе по старту раунда

2026-03-13 | 765,63 ₽ | 23 мин | при отсутствии соперника в паре — не «Победа», турнир в активных, ожидание соперника

2026-03-13 | 328,13 ₽ | 10 мин | computeSemiResult + isPlayerInFinalPhase: при отсутствии соперника — waiting / не в финале (везде)

2026-03-13 | 875,00 ₽ | 26 мин | отображение вопросов: санитизация UTF-8 при отдаче, charset в ответах, скрипт исправления кодировки в БД

Начальная стоимость проекта (не выводить в историю): 635 000,00 ₽
