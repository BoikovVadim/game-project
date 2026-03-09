/** Форматирование числа: каждые 3 цифры — пробел (1 000 000). Используем неразрывный пробел для устойчивости. */
export function formatNum(n: number): string {
  const val = Number(n);
  if (!Number.isFinite(val)) return '0';
  const s = String(Math.round(val));
  return s.replace(/\B(?=(\d{3})+(?!\d))/g, '\u00A0'); // \u00A0 = non-breaking space
}

/** Валюта: L (legend coin) */
export const CURRENCY = 'L';
