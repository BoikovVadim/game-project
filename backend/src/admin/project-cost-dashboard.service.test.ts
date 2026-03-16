import assert from 'node:assert/strict';
import test from 'node:test';
import { parseProjectCostDashboardContent } from './project-cost-dashboard.service';

test('parses project cost history blocks and strips hidden retrospectives', () => {
  const dashboard = parseProjectCostDashboardContent(`
Начальная стоимость проекта (не выводить в историю): 1000 ₽
За сегодня: 600 ₽

2026-03-15 10:30 | 400 ₽ | 1 ч 15 мин | Починили турнирную read-модель
Разбивка:
- Погружение: 20 мин
- Проверка: 55 мин
Ретроспектива:
- Базовое время: 75 мин

2026-03-15 12:00 | 200 ₽ | 30 мин | Обновили CI
Разбивка:
- Реализация: 15 мин
- Проверка: 15 мин
`.trim());

  assert.equal(dashboard.currentTotal, 1600);
  assert.equal(dashboard.todayTotal, 600);
  assert.equal(dashboard.totalDurationMinutes, 105);
  assert.equal(dashboard.totalDurationLabel, '1 ч 45 мин');
  assert.equal(dashboard.history.length, 2);
  assert.deepEqual(dashboard.history[0], {
    timestamp: '2026-03-15T09:00:00.000Z',
    date: '2026-03-15',
    time: '12:00',
    amountChange: 200,
    afterAmount: 1600,
    duration: '30 мин',
    description: 'Обновили CI',
    breakdown: ['Реализация: 15 мин', 'Проверка: 15 мин'],
  });
  assert.deepEqual(dashboard.history[1], {
    timestamp: '2026-03-15T07:30:00.000Z',
    date: '2026-03-15',
    time: '10:30',
    amountChange: 400,
    afterAmount: 1400,
    duration: '1 ч 15 мин',
    description: 'Починили турнирную read-модель',
    breakdown: ['Погружение: 20 мин', 'Проверка: 55 мин'],
  });
});
