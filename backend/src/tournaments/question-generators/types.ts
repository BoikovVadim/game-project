export interface RawQuestion {
  topic: string;
  question: string;
  options: string[];
  correctAnswer: number;
}

export function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

export function rnd(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

export function makeQ(topic: string, q: string, opts: string[], correctIdx: number): RawQuestion {
  return { topic, question: q, options: opts, correctAnswer: correctIdx };
}

export function shuffleOptions(topic: string, q: string, correct: string, wrong: string[]): RawQuestion {
  const opts = shuffle([correct, ...wrong]);
  return { topic, question: q, options: opts, correctAnswer: opts.indexOf(correct) };
}

export function mathOpts(ans: number): string[] {
  const opts = new Set<number>([ans]);
  const pool = shuffle([-30, -20, -10, 10, 20, 30].filter((d) => ans + d > 0));
  for (const d of pool) {
    if (opts.size >= 4) break;
    opts.add(ans + d);
  }
  for (let m = 4; opts.size < 4; m++) {
    if (ans + m * 10 > 0) opts.add(ans + m * 10);
    if (opts.size < 4 && ans - m * 10 > 0) opts.add(ans - m * 10);
  }
  return shuffle([...opts].map(String));
}

export function dedup(items: RawQuestion[]): RawQuestion[] {
  const seen = new Set<string>();
  return items.filter((q) => {
    if (seen.has(q.question)) return false;
    seen.add(q.question);
    return true;
  });
}
