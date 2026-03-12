import { RawQuestion, rnd, shuffle, dedup } from './types';

function seqStr(nums: number[]): string {
  return nums.join(', ');
}

function nearOpts(correct: number, spread = 0): string[] {
  let s = spread || Math.max(2, Math.abs(Math.round(correct * 0.15)));
  if (s < 3) s = 3;
  const wrong = new Set<number>();
  let attempts = 0;
  while (wrong.size < 3 && attempts < 200) {
    attempts++;
    const d = rnd(1, s) * (Math.random() < 0.5 ? -1 : 1);
    const v = correct + d;
    if (v !== correct && v > 0) wrong.add(v);
    if (attempts % 50 === 0) s += 2;
  }
  while (wrong.size < 3) {
    wrong.add(correct + wrong.size + 1);
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

  // --- Arithmetic progressions: a, a+d, a+2d, ... (positive step) ---
  for (let i = 0; i < 2000; i++) {
    const a = rnd(1, 200);
    const d = rnd(1, 50);
    const len = rnd(4, 6);
    const seq: number[] = [];
    for (let k = 0; k < len; k++) seq.push(a + k * d);
    const ans = a + len * d;
    pushSeq(items, seen, seq, ans, d + 2);
  }

  // --- Arithmetic progressions (negative step) ---
  for (let i = 0; i < 800; i++) {
    const d = rnd(2, 30);
    const a = rnd(d * 7, d * 7 + 200);
    const len = rnd(4, 6);
    const seq: number[] = [];
    for (let k = 0; k < len; k++) seq.push(a - k * d);
    const ans = a - len * d;
    if (ans < 1) continue;
    pushSeq(items, seen, seq, ans, d + 2);
  }

  // --- Geometric progressions ×2..×10 ---
  for (const r of [2, 3, 4, 5, 6, 7, 8, 9, 10]) {
    for (let i = 0; i < 300; i++) {
      const a = rnd(1, 30);
      const len = rnd(4, 6);
      const seq: number[] = [];
      let v = a;
      let ok = true;
      for (let k = 0; k < len; k++) {
        seq.push(v);
        v *= r;
        if (v > 500000) { ok = false; break; }
      }
      if (!ok) continue;
      pushSeq(items, seen, seq, v, Math.max(3, Math.round(v * 0.2)));
    }
  }

  // --- Powers of 2 ---
  for (let i = 0; i < 300; i++) {
    const start = rnd(0, 8);
    const len = rnd(4, 6);
    const seq: number[] = [];
    for (let k = start; k < start + len; k++) seq.push(2 ** k);
    const ans = 2 ** (start + len);
    if (ans > 500000) continue;
    pushSeq(items, seen, seq, ans, Math.max(3, Math.round(ans * 0.15)));
  }

  // --- Powers of 3 ---
  for (let i = 0; i < 200; i++) {
    const start = rnd(0, 5);
    const len = rnd(4, 5);
    const seq: number[] = [];
    for (let k = start; k < start + len; k++) seq.push(3 ** k);
    const ans = 3 ** (start + len);
    if (ans > 500000) continue;
    pushSeq(items, seen, seq, ans, Math.max(3, Math.round(ans * 0.15)));
  }

  // --- Square numbers ---
  for (let i = 0; i < 600; i++) {
    const start = rnd(1, 40);
    const len = rnd(4, 6);
    const seq: number[] = [];
    for (let k = start; k < start + len; k++) seq.push(k * k);
    const ans = (start + len) ** 2;
    pushSeq(items, seen, seq, ans);
  }

  // --- Cube numbers ---
  for (let i = 0; i < 400; i++) {
    const start = rnd(1, 15);
    const len = rnd(4, 5);
    const seq: number[] = [];
    for (let k = start; k < start + len; k++) seq.push(k ** 3);
    const ans = (start + len) ** 3;
    if (ans > 500000) continue;
    pushSeq(items, seen, seq, ans, Math.max(5, Math.round(ans * 0.1)));
  }

  // --- Triangular numbers: T(n) = n*(n+1)/2 ---
  for (let i = 0; i < 400; i++) {
    const start = rnd(1, 40);
    const len = rnd(4, 6);
    const seq: number[] = [];
    for (let k = start; k < start + len; k++) seq.push((k * (k + 1)) / 2);
    const n = start + len;
    const ans = (n * (n + 1)) / 2;
    pushSeq(items, seen, seq, ans);
  }

  // --- Fibonacci-like: each = prev + prev-prev ---
  for (let i = 0; i < 800; i++) {
    const a = rnd(1, 50);
    const b = rnd(1, 50);
    const seq = [a, b];
    let ok = true;
    for (let k = 2; k < 7; k++) {
      seq.push(seq[k - 1]! + seq[k - 2]!);
      if (seq[seq.length - 1]! > 500000) { ok = false; break; }
    }
    if (!ok || seq.length < 5) continue;
    const shown = seq.slice(0, seq.length - 1);
    const ans = seq[seq.length - 1]!;
    pushSeq(items, seen, shown, ans);
  }

  // --- Add-then-multiply ---
  for (let i = 0; i < 600; i++) {
    const addVal = rnd(1, 20);
    const mulVal = rnd(2, 4);
    let v = rnd(1, 15);
    const seq: number[] = [v];
    let ok = true;
    for (let k = 1; k < 7; k++) {
      v = k % 2 === 1 ? v + addVal : v * mulVal;
      if (v > 500000) { ok = false; break; }
      seq.push(v);
    }
    if (!ok || seq.length < 5) continue;
    const shown = seq.slice(0, seq.length - 1);
    const ans = seq[seq.length - 1]!;
    pushSeq(items, seen, shown, ans);
  }

  // --- Multiply-then-add ---
  for (let i = 0; i < 600; i++) {
    const mulVal = rnd(2, 4);
    const addVal = rnd(1, 20);
    let v = rnd(1, 12);
    const seq: number[] = [v];
    let ok = true;
    for (let k = 1; k < 7; k++) {
      v = k % 2 === 1 ? v * mulVal : v + addVal;
      if (v > 500000) { ok = false; break; }
      seq.push(v);
    }
    if (!ok || seq.length < 5) continue;
    const shown = seq.slice(0, seq.length - 1);
    const ans = seq[seq.length - 1]!;
    pushSeq(items, seen, shown, ans);
  }

  // --- Alternating +a, +b pattern ---
  for (let i = 0; i < 600; i++) {
    const a = rnd(1, 30);
    const b = rnd(1, 30);
    if (a === b) continue;
    let v = rnd(1, 100);
    const seq: number[] = [v];
    for (let k = 1; k < 7; k++) {
      v += k % 2 === 1 ? a : b;
      seq.push(v);
    }
    const shown = seq.slice(0, seq.length - 1);
    const ans = seq[seq.length - 1]!;
    pushSeq(items, seen, shown, ans, Math.max(a, b) + 3);
  }

  // --- Increasing step: +s, +(s+1), +(s+2), ... ---
  for (let i = 0; i < 600; i++) {
    const start = rnd(1, 100);
    const stepStart = rnd(1, 10);
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
  for (let i = 0; i < 400; i++) {
    const d = rnd(1, 8);
    let v = rnd(1, 50);
    const seq: number[] = [v];
    let step = d;
    let ok = true;
    for (let k = 0; k < 5; k++) {
      v += step;
      step *= 2;
      if (v > 500000) { ok = false; break; }
      seq.push(v);
    }
    if (!ok || seq.length < 5) continue;
    const shown = seq.slice(0, seq.length - 1);
    const ans = seq[seq.length - 1]!;
    pushSeq(items, seen, shown, ans, Math.max(5, Math.round(ans * 0.1)));
  }

  // --- n^2 + c (shifted squares) ---
  for (let i = 0; i < 400; i++) {
    const c = rnd(-20, 50);
    const start = rnd(1, 25);
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

  // --- Pentagonal numbers: n*(3n-1)/2 ---
  for (let i = 0; i < 200; i++) {
    const start = rnd(1, 25);
    const len = rnd(4, 6);
    const seq: number[] = [];
    for (let n = start; n < start + len; n++) seq.push((n * (3 * n - 1)) / 2);
    const n = start + len;
    const ans = (n * (3 * n - 1)) / 2;
    pushSeq(items, seen, seq, ans);
  }

  // --- Primes-based sequences ---
  const primes = [2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37, 41, 43, 47, 53, 59, 61, 67, 71, 73, 79, 83, 89, 97, 101, 103, 107, 109, 113];
  for (let i = 0; i < 200; i++) {
    const start = rnd(0, primes.length - 7);
    const len = rnd(4, 6);
    const seq = primes.slice(start, start + len);
    const ans = primes[start + len]!;
    if (!ans) continue;
    pushSeq(items, seen, seq, ans, 4);
  }

  // --- v*m + a recursive ---
  for (let i = 0; i < 400; i++) {
    const m = rnd(2, 5);
    const a = rnd(-8, 8);
    if (a === 0) continue;
    let v = rnd(1, 15);
    const seq: number[] = [v];
    let ok = true;
    for (let k = 0; k < 5; k++) {
      v = v * m + a;
      if (v > 500000 || v < 1) { ok = false; break; }
      seq.push(v);
    }
    if (!ok || seq.length < 5) continue;
    const shown = seq.slice(0, seq.length - 1);
    const ans = seq[seq.length - 1]!;
    pushSeq(items, seen, shown, ans, Math.max(3, Math.round(ans * 0.1)));
  }

  // --- Sum of digits: each = prev + digitSum(prev) ---
  for (let i = 0; i < 500; i++) {
    let v = rnd(10, 500);
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

  // --- Factorial-like ---
  for (let i = 0; i < 100; i++) {
    const start = rnd(1, 4);
    const len = rnd(4, 5);
    const seq: number[] = [];
    let f = 1;
    for (let k = 1; k <= start + len; k++) {
      f *= k;
      if (k >= start) seq.push(f);
    }
    if (seq.length < 5 || seq[seq.length - 1]! > 500000) continue;
    const shown = seq.slice(0, seq.length - 1);
    const ans = seq[seq.length - 1]!;
    pushSeq(items, seen, shown, ans, Math.max(5, Math.round(ans * 0.15)));
  }

  // --- Interleaved two arithmetic sequences ---
  for (let i = 0; i < 600; i++) {
    const a1 = rnd(1, 50), d1 = rnd(2, 20);
    const a2 = rnd(1, 50), d2 = rnd(2, 20);
    if (d1 === d2 && a1 === a2) continue;
    const seq: number[] = [];
    for (let k = 0; k < 4; k++) {
      seq.push(a1 + k * d1);
      seq.push(a2 + k * d2);
    }
    const shown = seq.slice(0, 7);
    const ans = seq[7]!;
    pushSeq(items, seen, shown, ans, Math.max(d1, d2) + 2);
  }

  // --- n * (n + c) ---
  for (let i = 0; i < 400; i++) {
    const c = rnd(1, 10);
    const start = rnd(1, 20);
    const len = rnd(4, 6);
    const seq: number[] = [];
    for (let k = start; k < start + len; k++) seq.push(k * (k + c));
    const n = start + len;
    const ans = n * (n + c);
    pushSeq(items, seen, seq, ans);
  }

  // --- Alternating ×a, +b ---
  for (let i = 0; i < 500; i++) {
    const a = rnd(2, 5);
    const b = rnd(-10, 10);
    if (b === 0) continue;
    let v = rnd(1, 20);
    const seq: number[] = [v];
    let ok = true;
    for (let k = 1; k < 7; k++) {
      v = k % 2 === 1 ? v * a : v + b;
      if (v > 500000 || v < 1) { ok = false; break; }
      seq.push(v);
    }
    if (!ok || seq.length < 5) continue;
    const shown = seq.slice(0, seq.length - 1);
    const ans = seq[seq.length - 1]!;
    pushSeq(items, seen, shown, ans);
  }

  // --- Step increases by multiplication: +d, +d*2, +d*3, +d*4 ---
  for (let i = 0; i < 500; i++) {
    const d = rnd(1, 15);
    let v = rnd(1, 50);
    const seq: number[] = [v];
    for (let k = 1; k <= 6; k++) {
      v += d * k;
      seq.push(v);
    }
    const shown = seq.slice(0, seq.length - 1);
    const ans = seq[seq.length - 1]!;
    pushSeq(items, seen, shown, ans);
  }

  // --- a(n) = a(n-1) + a(n-2) + c (extended Fibonacci) ---
  for (let i = 0; i < 500; i++) {
    const a = rnd(1, 30);
    const b = rnd(1, 30);
    const c = rnd(1, 10);
    const seq = [a, b];
    let ok = true;
    for (let k = 2; k < 7; k++) {
      const next = seq[k - 1]! + seq[k - 2]! + c;
      if (next > 500000) { ok = false; break; }
      seq.push(next);
    }
    if (!ok || seq.length < 5) continue;
    const shown = seq.slice(0, seq.length - 1);
    const ans = seq[seq.length - 1]!;
    pushSeq(items, seen, shown, ans);
  }

  // --- Difference of squares: (n+c)^2 - n^2 = 2nc + c^2 ---
  for (let i = 0; i < 300; i++) {
    const c = rnd(1, 5);
    const start = rnd(1, 30);
    const len = rnd(4, 6);
    const seq: number[] = [];
    for (let n = start; n < start + len; n++) seq.push((n + c) * (n + c) - n * n);
    const n = start + len;
    const ans = (n + c) * (n + c) - n * n;
    pushSeq(items, seen, seq, ans);
  }

  // --- Oblong numbers: n*(n+1) ---
  for (let i = 0; i < 300; i++) {
    const start = rnd(1, 30);
    const len = rnd(4, 6);
    const seq: number[] = [];
    for (let k = start; k < start + len; k++) seq.push(k * (k + 1));
    const n = start + len;
    const ans = n * (n + 1);
    pushSeq(items, seen, seq, ans);
  }

  // --- Centered square numbers: 2n(n+1)+1 ---
  for (let i = 0; i < 200; i++) {
    const start = rnd(0, 20);
    const len = rnd(4, 6);
    const seq: number[] = [];
    for (let n = start; n < start + len; n++) seq.push(2 * n * (n + 1) + 1);
    const n = start + len;
    const ans = 2 * n * (n + 1) + 1;
    pushSeq(items, seen, seq, ans);
  }

  // --- Star numbers: 6n(n-1)+1 ---
  for (let i = 0; i < 200; i++) {
    const start = rnd(1, 20);
    const len = rnd(4, 6);
    const seq: number[] = [];
    for (let n = start; n < start + len; n++) seq.push(6 * n * (n - 1) + 1);
    const n = start + len;
    const ans = 6 * n * (n - 1) + 1;
    pushSeq(items, seen, seq, ans);
  }

  // --- Hexagonal numbers: n*(2n-1) ---
  for (let i = 0; i < 200; i++) {
    const start = rnd(1, 25);
    const len = rnd(4, 6);
    const seq: number[] = [];
    for (let n = start; n < start + len; n++) seq.push(n * (2 * n - 1));
    const n = start + len;
    const ans = n * (2 * n - 1);
    pushSeq(items, seen, seq, ans);
  }

  // --- Arithmetic with larger step range ---
  for (let i = 0; i < 500; i++) {
    const a = rnd(1, 500);
    const d = rnd(50, 200);
    const len = rnd(4, 6);
    const seq: number[] = [];
    for (let k = 0; k < len; k++) seq.push(a + k * d);
    const ans = a + len * d;
    pushSeq(items, seen, seq, ans, d + 5);
  }

  return dedup(items);
}
