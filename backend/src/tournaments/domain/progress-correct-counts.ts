export type ProgressQuestion = {
  roundIndex: number;
  correctAnswer: number;
};

export function normalizeChosenAnswers(value: unknown): number[] {
  const mapAnswer = (entry: unknown): number => {
    if (typeof entry === 'number' && !Number.isNaN(entry)) {
      return entry < 0 ? -1 : Math.floor(entry);
    }
    return -1;
  };

  if (Array.isArray(value)) return value.map(mapAnswer);
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as unknown;
      return Array.isArray(parsed) ? parsed.map(mapAnswer) : [];
    } catch {
      return [];
    }
  }
  return [];
}

export function hasReliableChosenAnswers(answersChosen: number[]): boolean {
  if (answersChosen.length === 0) return false;
  const uniqueValues = new Set(answersChosen.filter((value) => value >= 0));
  return uniqueValues.size > 1;
}

export function computeCorrectCountsFromQuestions(args: {
  answersChosen: number[];
  questions: ProgressQuestion[];
  semiRoundIndex: number;
}): { total: number; semi: number } {
  const { answersChosen, questions, semiRoundIndex } = args;
  if (answersChosen.length === 0 || questions.length === 0) {
    return { total: 0, semi: 0 };
  }

  const semiQuestions = questions.filter(
    (question) => question.roundIndex === semiRoundIndex,
  );
  const semiTiebreakerQuestions = questions
    .filter((question) => question.roundIndex >= 3 && question.roundIndex < 100)
    .sort((left, right) => left.roundIndex - right.roundIndex);
  const finalQuestions = questions
    .filter((question) => question.roundIndex === 2)
    .sort((left, right) => left.roundIndex - right.roundIndex);
  const finalTiebreakerQuestions = questions
    .filter((question) => question.roundIndex >= 100)
    .sort((left, right) => left.roundIndex - right.roundIndex);

  const orderedQuestions = [
    ...semiQuestions,
    ...semiTiebreakerQuestions,
    ...finalQuestions,
    ...finalTiebreakerQuestions,
  ];

  let total = 0;
  let semi = 0;
  for (
    let index = 0;
    index < answersChosen.length && index < orderedQuestions.length;
    index++
  ) {
    if (answersChosen[index] !== orderedQuestions[index]?.correctAnswer) continue;
    if (answersChosen[index] < 0) continue;
    total += 1;
    if (index < semiQuestions.length) semi += 1;
  }

  return { total, semi };
}
