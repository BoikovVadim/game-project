import { RawQuestion, rnd, shuffle, mathOpts, dedup } from './types';

export function generateMath(): RawQuestion[] {
  const items: RawQuestion[] = [];
  const seen = new Set<string>();

  const push = (topic: string, q: string, opts: string[], ans: number) => {
    if (seen.has(q)) return;
    seen.add(q);
    const s = shuffle([...opts]);
    items.push({ topic, question: q, options: s, correctAnswer: s.indexOf(String(ans)) });
  };

  // Все операнды и результаты — трёхзначные (100–999)
  for (let i = 0; i < 5000; i++) {
    const a = rnd(100, 499), b = rnd(100, 499);
    const ans = a + b;
    if (ans < 100 || ans > 999) continue;
    push('math_addition', `Сколько будет ${a} + ${b}?`, mathOpts(ans), ans);
  }
  for (let i = 0; i < 5000; i++) {
    const a = rnd(200, 999), b = rnd(100, a - 100);
    const ans = a - b;
    if (ans < 100 || ans > 999) continue;
    push('math_subtraction', `Сколько будет ${a} − ${b}?`, mathOpts(ans), ans);
  }
  for (let i = 0; i < 5000; i++) {
    const a = rnd(10, 99), b = rnd(2, 9);
    const ans = a * b;
    if (ans < 100 || ans > 999) continue;
    push('math_multiplication', `Сколько будет ${a} × ${b}?`, mathOpts(ans), ans);
  }
  for (let i = 0; i < 5000; i++) {
    const d = rnd(2, 9), q = rnd(100, 999);
    const a = d * q;
    if (a < 100 || a > 999 * 9) continue;
    if (q < 100 || q > 999) continue;
    push('math_division', `Сколько будет ${a} ÷ ${d}?`, mathOpts(q), q);
  }

  return dedup(items);
}
