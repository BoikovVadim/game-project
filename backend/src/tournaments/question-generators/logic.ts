import { RawQuestion, rnd, shuffle, dedup, shuffleOptions } from './types';

function seqStr(nums: number[]): string {
  return nums.join(', ');
}

function nearOpts(correct: number, spread = 0): string[] {
  const s = spread || Math.max(2, Math.abs(Math.round(correct * 0.15)));
  const wrong = new Set<number>();
  while (wrong.size < 3) {
    const d = rnd(1, s) * (Math.random() < 0.5 ? -1 : 1);
    const v = correct + d;
    if (v !== correct && v > 0) wrong.add(v);
  }
  return shuffle([correct, ...wrong]).map(String);
}

function pushSeq(
  out: RawQuestion[],
  seen: Set<string>,
  shown: number[],
  answer: number,
  spread?: number,
) {
  const q = `Какое число следующее: ${seqStr(shown)}, ?`;
  if (seen.has(q)) return;
  seen.add(q);
  const opts = nearOpts(answer, spread);
  out.push({
    topic: 'logic_sequences',
    question: q,
    options: opts,
    correctAnswer: opts.indexOf(String(answer)),
  });
}

export function generateLogic(): RawQuestion[] {
  const items: RawQuestion[] = [];
  const seen = new Set<string>();

  // --- Arithmetic progressions: a, a+d, a+2d, ... ---
  for (let i = 0; i < 800; i++) {
    const a = rnd(1, 100);
    const d = rnd(1, 30);
    const len = rnd(4, 6);
    const seq: number[] = [];
    for (let k = 0; k < len; k++) seq.push(a + k * d);
    const ans = a + len * d;
    pushSeq(items, seen, seq, ans, d + 2);
  }

  // --- Arithmetic progressions with negative step ---
  for (let i = 0; i < 300; i++) {
    const d = rnd(2, 15);
    const a = rnd(d * 7, d * 7 + 100);
    const len = rnd(4, 6);
    const seq: number[] = [];
    for (let k = 0; k < len; k++) seq.push(a - k * d);
    const ans = a - len * d;
    if (ans < 1) continue;
    pushSeq(items, seen, seq, ans, d + 2);
  }

  // --- Geometric progressions ×2, ×3, ×4, ×5 ---
  for (const r of [2, 3, 4, 5]) {
    for (let i = 0; i < 200; i++) {
      const a = rnd(1, 20);
      const len = rnd(4, 6);
      const seq: number[] = [];
      let v = a;
      let ok = true;
      for (let k = 0; k < len; k++) {
        seq.push(v);
        v *= r;
        if (v > 100000) { ok = false; break; }
      }
      if (!ok) continue;
      pushSeq(items, seen, seq, v, Math.max(3, Math.round(v * 0.2)));
    }
  }

  // --- Powers of 2 starting from different points ---
  for (let i = 0; i < 200; i++) {
    const start = rnd(0, 5);
    const len = rnd(4, 6);
    const seq: number[] = [];
    for (let k = start; k < start + len; k++) seq.push(2 ** k);
    const ans = 2 ** (start + len);
    pushSeq(items, seen, seq, ans, Math.max(3, Math.round(ans * 0.15)));
  }

  // --- Square numbers ---
  for (let i = 0; i < 300; i++) {
    const start = rnd(1, 20);
    const len = rnd(4, 6);
    const seq: number[] = [];
    for (let k = start; k < start + len; k++) seq.push(k * k);
    const ans = (start + len) ** 2;
    pushSeq(items, seen, seq, ans);
  }

  // --- Cube numbers ---
  for (let i = 0; i < 200; i++) {
    const start = rnd(1, 10);
    const len = rnd(4, 5);
    const seq: number[] = [];
    for (let k = start; k < start + len; k++) seq.push(k ** 3);
    const ans = (start + len) ** 3;
    if (ans > 100000) continue;
    pushSeq(items, seen, seq, ans, Math.max(5, Math.round(ans * 0.1)));
  }

  // --- Triangular numbers: T(n) = n*(n+1)/2 ---
  for (let i = 0; i < 200; i++) {
    const start = rnd(1, 20);
    const len = rnd(4, 6);
    const seq: number[] = [];
    for (let k = start; k < start + len; k++) seq.push((k * (k + 1)) / 2);
    const n = start + len;
    const ans = (n * (n + 1)) / 2;
    pushSeq(items, seen, seq, ans);
  }

  // --- Fibonacci-like: each = prev + prev-prev ---
  for (let i = 0; i < 400; i++) {
    const a = rnd(1, 20);
    const b = rnd(1, 20);
    const seq = [a, b];
    let ok = true;
    for (let k = 2; k < 7; k++) {
      seq.push(seq[k - 1]! + seq[k - 2]!);
      if (seq[seq.length - 1]! > 100000) { ok = false; break; }
    }
    if (!ok || seq.length < 5) continue;
    const shown = seq.slice(0, seq.length - 1);
    const ans = seq[seq.length - 1]!;
    pushSeq(items, seen, shown, ans);
  }

  // --- Add-then-multiply: +a, ×b, +a, ×b ... ---
  for (let i = 0; i < 300; i++) {
    const addVal = rnd(1, 10);
    const mulVal = rnd(2, 3);
    let v = rnd(1, 10);
    const seq: number[] = [v];
    let ok = true;
    for (let k = 1; k < 7; k++) {
      v = k % 2 === 1 ? v + addVal : v * mulVal;
      if (v > 100000) { ok = false; break; }
      seq.push(v);
    }
    if (!ok || seq.length < 5) continue;
    const shown = seq.slice(0, seq.length - 1);
    const ans = seq[seq.length - 1]!;
    pushSeq(items, seen, shown, ans);
  }

  // --- Multiply-then-add: ×a, +b, ×a, +b ... ---
  for (let i = 0; i < 300; i++) {
    const mulVal = rnd(2, 3);
    const addVal = rnd(1, 10);
    let v = rnd(1, 8);
    const seq: number[] = [v];
    let ok = true;
    for (let k = 1; k < 7; k++) {
      v = k % 2 === 1 ? v * mulVal : v + addVal;
      if (v > 100000) { ok = false; break; }
      seq.push(v);
    }
    if (!ok || seq.length < 5) continue;
    const shown = seq.slice(0, seq.length - 1);
    const ans = seq[seq.length - 1]!;
    pushSeq(items, seen, shown, ans);
  }

  // --- Alternating +a, +b pattern ---
  for (let i = 0; i < 300; i++) {
    const a = rnd(1, 15);
    const b = rnd(1, 15);
    if (a === b) continue;
    let v = rnd(1, 50);
    const seq: number[] = [v];
    for (let k = 1; k < 7; k++) {
      v += k % 2 === 1 ? a : b;
      seq.push(v);
    }
    const shown = seq.slice(0, seq.length - 1);
    const ans = seq[seq.length - 1]!;
    pushSeq(items, seen, shown, ans, Math.max(a, b) + 3);
  }

  // --- Increasing step: +1, +2, +3, +4, ... ---
  for (let i = 0; i < 300; i++) {
    const start = rnd(1, 50);
    const stepStart = rnd(1, 5);
    let v = start;
    const seq: number[] = [v];
    for (let k = 0; k < 6; k++) {
      v += stepStart + k;
      seq.push(v);
    }
    const shown = seq.slice(0, seq.length - 1);
    const ans = seq[seq.length - 1]!;
    pushSeq(items, seen, shown, ans);
  }

  // --- Doubling step: +d, +2d, +4d, +8d ... ---
  for (let i = 0; i < 200; i++) {
    const d = rnd(1, 5);
    let v = rnd(1, 30);
    const seq: number[] = [v];
    let step = d;
    let ok = true;
    for (let k = 0; k < 5; k++) {
      v += step;
      step *= 2;
      if (v > 100000) { ok = false; break; }
      seq.push(v);
    }
    if (!ok || seq.length < 5) continue;
    const shown = seq.slice(0, seq.length - 1);
    const ans = seq[seq.length - 1]!;
    pushSeq(items, seen, shown, ans, Math.max(5, Math.round(ans * 0.1)));
  }

  // --- n^2 + c (shifted squares) ---
  for (let i = 0; i < 200; i++) {
    const c = rnd(-10, 30);
    const start = rnd(1, 15);
    const len = rnd(4, 6);
    const seq: number[] = [];
    for (let k = start; k < start + len; k++) {
      const v = k * k + c;
      if (v < 1) continue;
      seq.push(v);
    }
    if (seq.length < 4) continue;
    const n = start + seq.length;
    const ans = n * n + c;
    if (ans < 1) continue;
    pushSeq(items, seen, seq, ans);
  }

  // --- Primes-based sequences ---
  const primes = [2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37, 41, 43, 47, 53, 59, 61, 67, 71, 73, 79, 83, 89, 97];
  for (let i = 0; i < 100; i++) {
    const start = rnd(0, primes.length - 7);
    const len = rnd(4, 6);
    const seq = primes.slice(start, start + len);
    const ans = primes[start + len]!;
    if (!ans) continue;
    pushSeq(items, seen, seq, ans, 4);
  }

  // --- Multiply by constant then add constant ---
  for (let i = 0; i < 200; i++) {
    const m = rnd(2, 4);
    const a = rnd(-5, 5);
    if (a === 0) continue;
    let v = rnd(1, 10);
    const seq: number[] = [v];
    let ok = true;
    for (let k = 0; k < 5; k++) {
      v = v * m + a;
      if (v > 100000 || v < 1) { ok = false; break; }
      seq.push(v);
    }
    if (!ok || seq.length < 5) continue;
    const shown = seq.slice(0, seq.length - 1);
    const ans = seq[seq.length - 1]!;
    pushSeq(items, seen, shown, ans, Math.max(3, Math.round(ans * 0.1)));
  }

  // --- Factorial-like: 1, 2, 6, 24, 120 ---
  for (let i = 0; i < 50; i++) {
    const start = rnd(1, 3);
    const len = rnd(4, 5);
    const seq: number[] = [];
    let f = 1;
    for (let k = 1; k <= start + len; k++) {
      f *= k;
      if (k >= start) seq.push(f);
    }
    if (seq.length < 5 || seq[seq.length - 1]! > 100000) continue;
    const shown = seq.slice(0, seq.length - 1);
    const ans = seq[seq.length - 1]!;
    pushSeq(items, seen, shown, ans, Math.max(5, Math.round(ans * 0.15)));
  }

  // --- Pentagonal numbers: n*(3n-1)/2 ---
  for (let i = 0; i < 100; i++) {
    const start = rnd(1, 15);
    const len = rnd(4, 6);
    const seq: number[] = [];
    for (let n = start; n < start + len; n++) seq.push((n * (3 * n - 1)) / 2);
    const n = start + len;
    const ans = (n * (3 * n - 1)) / 2;
    pushSeq(items, seen, seq, ans);
  }

  // --- Powers of 3 ---
  for (let i = 0; i < 100; i++) {
    const start = rnd(0, 4);
    const len = rnd(4, 5);
    const seq: number[] = [];
    for (let k = start; k < start + len; k++) seq.push(3 ** k);
    const ans = 3 ** (start + len);
    if (ans > 100000) continue;
    pushSeq(items, seen, seq, ans, Math.max(3, Math.round(ans * 0.15)));
  }

  // --- Sum of digits pattern: each term = prev + sum_of_digits(prev) ---
  for (let i = 0; i < 200; i++) {
    let v = rnd(10, 200);
    const seq: number[] = [v];
    for (let k = 0; k < 5; k++) {
      const dsum = String(v).split('').reduce((s, c) => s + Number(c), 0);
      v = v + dsum;
      seq.push(v);
    }
    const shown = seq.slice(0, seq.length - 1);
    const ans = seq[seq.length - 1]!;
    pushSeq(items, seen, shown, ans);
  }

  return dedup(items);
}
