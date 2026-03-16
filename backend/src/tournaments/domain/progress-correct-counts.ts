import { QUESTIONS_PER_ROUND, TIEBREAKER_QUESTIONS } from './constants';

export type ProgressQuestion = {
  roundIndex: number;
  correctAnswer: number;
};

export type VisibleStageTotals = {
  correct: number;
  totalQuestions: number;
  answeredQuestions: number;
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
  questionsAnsweredCount?: number;
  semiTiebreakerRoundCount?: number;
  finalTiebreakerRoundCount?: number;
}): { total: number; semi: number } {
  const {
    answersChosen,
    questions,
    semiRoundIndex,
    questionsAnsweredCount,
    semiTiebreakerRoundCount = 0,
    finalTiebreakerRoundCount = 0,
  } = args;
  if (answersChosen.length === 0 || questions.length === 0) {
    return { total: 0, semi: 0 };
  }
  const answeredCount = Math.max(
    answersChosen.length,
    questionsAnsweredCount ?? 0,
  );

  const semiQuestions = questions.filter(
    (question) => question.roundIndex === semiRoundIndex,
  );
  const semiTiebreakerQuestionsByRound = questions
    .filter((question) => question.roundIndex >= 3 && question.roundIndex < 100)
    .reduce<Map<number, ProgressQuestion[]>>((map, question) => {
      const bucket = map.get(question.roundIndex) ?? [];
      bucket.push(question);
      map.set(question.roundIndex, bucket);
      return map;
    }, new Map());
  const finalQuestions = questions
    .filter((question) => question.roundIndex === 2)
    .sort((left, right) => left.roundIndex - right.roundIndex);
  const finalTiebreakerQuestionsByRound = questions
    .filter((question) => question.roundIndex >= 100)
    .reduce<Map<number, ProgressQuestion[]>>((map, question) => {
      const bucket = map.get(question.roundIndex) ?? [];
      bucket.push(question);
      map.set(question.roundIndex, bucket);
      return map;
    }, new Map());

  const orderedSemiTiebreakerRounds = [
    ...semiTiebreakerQuestionsByRound.entries(),
  ]
    .sort(([left], [right]) => left - right)
    .map(([, roundQuestions]) => roundQuestions);
  const orderedFinalTiebreakerRounds = [
    ...finalTiebreakerQuestionsByRound.entries(),
  ]
    .sort(([left], [right]) => left - right)
    .map(([, roundQuestions]) => roundQuestions);

  const hasFinalStarted =
    finalQuestions.length > 0 &&
    answeredCount >
      QUESTIONS_PER_ROUND + semiTiebreakerRoundCount * TIEBREAKER_QUESTIONS;
  const visibleSemiTiebreakerRoundCount = hasFinalStarted
    ? Math.min(orderedSemiTiebreakerRounds.length, semiTiebreakerRoundCount)
    : Math.min(
        orderedSemiTiebreakerRounds.length,
        Math.max(
          semiTiebreakerRoundCount,
          Math.ceil(
            Math.max(0, answeredCount - QUESTIONS_PER_ROUND) /
              TIEBREAKER_QUESTIONS,
          ),
        ),
      );

  const visibleSemiTiebreakerQuestions = orderedSemiTiebreakerRounds
    .slice(0, visibleSemiTiebreakerRoundCount)
    .flat();
  const answeredAfterSemi =
    answeredCount -
    QUESTIONS_PER_ROUND -
    visibleSemiTiebreakerRoundCount * TIEBREAKER_QUESTIONS;
  const visibleFinalTiebreakerRoundCount =
    answeredAfterSemi > QUESTIONS_PER_ROUND
      ? Math.min(
          orderedFinalTiebreakerRounds.length,
          Math.max(
            finalTiebreakerRoundCount,
            Math.ceil(
              Math.max(0, answeredAfterSemi - QUESTIONS_PER_ROUND) /
                TIEBREAKER_QUESTIONS,
            ),
          ),
        )
      : Math.min(
          orderedFinalTiebreakerRounds.length,
          finalTiebreakerRoundCount,
        );
  const visibleFinalTiebreakerQuestions = orderedFinalTiebreakerRounds
    .slice(0, visibleFinalTiebreakerRoundCount)
    .flat();

  const orderedQuestions = [
    ...semiQuestions,
    ...visibleSemiTiebreakerQuestions,
    ...finalQuestions,
    ...visibleFinalTiebreakerQuestions,
  ];

  let total = 0;
  let semi = 0;
  for (
    let index = 0;
    index < answersChosen.length && index < orderedQuestions.length;
    index++
  ) {
    if (answersChosen[index] !== orderedQuestions[index]?.correctAnswer)
      continue;
    if (answersChosen[index] < 0) continue;
    total += 1;
    if (index < semiQuestions.length) semi += 1;
  }

  return { total, semi };
}

export function computeVisibleStageTotalsFromQuestions(args: {
  answersChosen: number[];
  questions: ProgressQuestion[];
  semiRoundIndex: number;
  questionsAnsweredCount?: number;
  semiTiebreakerRoundCount?: number;
  finalTiebreakerRoundCount?: number;
}): { semi: VisibleStageTotals; final: VisibleStageTotals } {
  const {
    answersChosen,
    questions,
    semiRoundIndex,
    questionsAnsweredCount,
    semiTiebreakerRoundCount = 0,
    finalTiebreakerRoundCount = 0,
  } = args;
  const answeredCount = Math.max(
    answersChosen.length,
    questionsAnsweredCount ?? 0,
  );
  if (questions.length === 0) {
    return {
      semi: { correct: 0, totalQuestions: 0, answeredQuestions: 0 },
      final: { correct: 0, totalQuestions: 0, answeredQuestions: 0 },
    };
  }

  const semiQuestions = questions.filter(
    (question) => question.roundIndex === semiRoundIndex,
  );
  const semiTiebreakerQuestionsByRound = questions
    .filter((question) => question.roundIndex >= 3 && question.roundIndex < 100)
    .reduce<Map<number, ProgressQuestion[]>>((map, question) => {
      const bucket = map.get(question.roundIndex) ?? [];
      bucket.push(question);
      map.set(question.roundIndex, bucket);
      return map;
    }, new Map());
  const finalQuestions = questions
    .filter((question) => question.roundIndex === 2)
    .sort((left, right) => left.roundIndex - right.roundIndex);
  const finalTiebreakerQuestionsByRound = questions
    .filter((question) => question.roundIndex >= 100)
    .reduce<Map<number, ProgressQuestion[]>>((map, question) => {
      const bucket = map.get(question.roundIndex) ?? [];
      bucket.push(question);
      map.set(question.roundIndex, bucket);
      return map;
    }, new Map());

  const orderedSemiTiebreakerRounds = [
    ...semiTiebreakerQuestionsByRound.entries(),
  ]
    .sort(([left], [right]) => left - right)
    .map(([, roundQuestions]) => roundQuestions);
  const orderedFinalTiebreakerRounds = [
    ...finalTiebreakerQuestionsByRound.entries(),
  ]
    .sort(([left], [right]) => left - right)
    .map(([, roundQuestions]) => roundQuestions);

  const hasFinalStarted =
    finalQuestions.length > 0 &&
    answeredCount >
      QUESTIONS_PER_ROUND + semiTiebreakerRoundCount * TIEBREAKER_QUESTIONS;
  const visibleSemiTiebreakerRoundCount = hasFinalStarted
    ? Math.min(orderedSemiTiebreakerRounds.length, semiTiebreakerRoundCount)
    : Math.min(
        orderedSemiTiebreakerRounds.length,
        Math.max(
          semiTiebreakerRoundCount,
          Math.ceil(
            Math.max(0, answeredCount - QUESTIONS_PER_ROUND) /
              TIEBREAKER_QUESTIONS,
          ),
        ),
      );
  const visibleSemiTiebreakerQuestions = orderedSemiTiebreakerRounds
    .slice(0, visibleSemiTiebreakerRoundCount)
    .flat();
  const semiStageQuestions = [
    ...semiQuestions,
    ...visibleSemiTiebreakerQuestions,
  ];
  const semiAnsweredQuestions = Math.min(
    answeredCount,
    semiStageQuestions.length,
  );
  const semiCorrect = semiStageQuestions.reduce((sum, question, index) => {
    return (
      sum +
      (answersChosen[index] >= 0 &&
      answersChosen[index] === question.correctAnswer
        ? 1
        : 0)
    );
  }, 0);

  const answeredAfterSemi = Math.max(
    0,
    answeredCount - semiStageQuestions.length,
  );
  const hasVisibleFinal =
    finalQuestions.length > 0 && answeredCount > semiStageQuestions.length;
  const visibleFinalTiebreakerRoundCount = hasVisibleFinal
    ? answeredAfterSemi > QUESTIONS_PER_ROUND
      ? Math.min(
          orderedFinalTiebreakerRounds.length,
          Math.max(
            finalTiebreakerRoundCount,
            Math.ceil(
              Math.max(0, answeredAfterSemi - QUESTIONS_PER_ROUND) /
                TIEBREAKER_QUESTIONS,
            ),
          ),
        )
      : Math.min(orderedFinalTiebreakerRounds.length, finalTiebreakerRoundCount)
    : 0;
  const visibleFinalTiebreakerQuestions = orderedFinalTiebreakerRounds
    .slice(0, visibleFinalTiebreakerRoundCount)
    .flat();
  const finalStageQuestions = hasVisibleFinal
    ? [...finalQuestions, ...visibleFinalTiebreakerQuestions]
    : [];
  const finalAnsweredQuestions = Math.min(
    answeredAfterSemi,
    finalStageQuestions.length,
  );
  const finalCorrect = finalStageQuestions.reduce((sum, question, index) => {
    const answerIndex = semiStageQuestions.length + index;
    return (
      sum +
      (answersChosen[answerIndex] >= 0 &&
      answersChosen[answerIndex] === question.correctAnswer
        ? 1
        : 0)
    );
  }, 0);

  return {
    semi: {
      correct: semiCorrect,
      totalQuestions: semiStageQuestions.length,
      answeredQuestions: semiAnsweredQuestions,
    },
    final: {
      correct: finalCorrect,
      totalQuestions: finalStageQuestions.length,
      answeredQuestions: finalAnsweredQuestions,
    },
  };
}
