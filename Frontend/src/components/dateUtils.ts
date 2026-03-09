/** Часовой пояс Москвы для всего приложения */
export const MOSCOW_TZ = 'Europe/Moscow';

/** Текущая дата в Москве в формате YYYY-MM-DD */
export function toMoscowDateStr(d: Date = new Date()): string {
  return d.toLocaleString('sv-SE', { timeZone: MOSCOW_TZ }).slice(0, 10);
}

/** Дата в Москве из строки YYYY-MM-DD (полночь Москва) */
export function parseMoscowDate(str: string): Date {
  return new Date(str + 'T00:00:00+03:00');
}

/** Форматирование даты и времени по Москве (короткий формат: 7 мар., 14:30) */
export function formatMoscowDateTime(isoString: string): string {
  return new Date(isoString).toLocaleString('ru-RU', {
    timeZone: MOSCOW_TZ,
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Форматирование полной даты и времени по Москве */
export function formatMoscowDateTimeFull(isoString: string): string {
  return new Date(isoString).toLocaleString('ru-RU', {
    timeZone: MOSCOW_TZ,
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

/** Текущий момент в Москве (Date) */
export function nowMoscow(): Date {
  const str = new Date().toLocaleString('en-CA', { timeZone: MOSCOW_TZ });
  return new Date(str);
}
