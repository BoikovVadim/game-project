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

  for (let i = 0; i < 15000; i++) {
    const a = rnd(10, 999), b = rnd(10, 999);
    push('math_addition', `Сколько будет ${a} + ${b}?`, mathOpts(a + b), a + b);
  }
  for (let i = 0; i < 15000; i++) {
    const res = rnd(10, 999), b = rnd(10, res - 1 > 10 ? res - 1 : 10);
    const a = res + b;
    if (a > 9999) continue;
    push('math_subtraction', `Сколько будет ${a} − ${b}?`, mathOpts(res), res);
  }
  for (let i = 0; i < 20000; i++) {
    const a = rnd(2, 999), b = rnd(2, 99), ans = a * b;
    if (ans < 10 || ans > 99999) continue;
    push('math_multiplication', `Сколько будет ${a} × ${b}?`, mathOpts(ans), ans);
  }
  for (let i = 0; i < 15000; i++) {
    const d = rnd(2, 99), q = rnd(10, 999), a = d * q;
    if (a < 20 || a > 99999) continue;
    push('math_division', `Сколько будет ${a} ÷ ${d}?`, mathOpts(q), q);
  }

  return dedup(items);
}
