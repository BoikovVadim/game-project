export type ResolvedQuestion = {
  globalIdx: number;
  value: number;
};

export function resolveQuestionAttempt(
  current: ResolvedQuestion | null,
  next: ResolvedQuestion,
): ResolvedQuestion {
  if (current && current.globalIdx === next.globalIdx) {
    return current;
  }
  return next;
}
