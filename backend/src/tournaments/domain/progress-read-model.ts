import { QUESTIONS_PER_ROUND, TIEBREAKER_QUESTIONS } from './constants';
import { Tournament } from '../tournament.entity';
import { TournamentProgress } from '../tournament-progress.entity';
import {
  computeCorrectCountsFromQuestions,
  computeVisibleStageTotalsFromQuestions,
  hasReliableChosenAnswers,
  normalizeChosenAnswers,
  type ProgressQuestion,
  type VisibleStageTotals,
} from './progress-correct-counts';

export type ProgressSnapshot = {
  q: number;
  semiCorrect: number | null;
  totalCorrect: number;
  currentIndex: number;
  tiebreakerRounds: number[];
  finalTiebreakerRounds: number[];
  roundStartedAt: Date | null;
  leftAt: Date | null;
  timeLeftSeconds: number | null;
  answersChosen: number[];
  lockedAnswerCount: number;
};

export type StageTotalsByProgress = {
  semi: VisibleStageTotals;
  final: VisibleStageTotals;
};

export function getEffectivePlayerOrder(tournament: Tournament): number[] {
  const playerIds = (tournament.players ?? [])
    .map((player) => player.id)
    .filter((id): id is number => Number.isInteger(id) && id > 0);
  const order = (tournament.playerOrder ?? []).filter(
    (id): id is number => Number.isInteger(id) && id > 0,
  );
  if (playerIds.length === 0) {
    return order;
  }
  const seen = new Set(order);
  const normalizedOrder = [...order];
  for (const id of playerIds) {
    if (!seen.has(id)) {
      normalizedOrder.push(id);
      seen.add(id);
    }
  }
  return normalizedOrder;
}

export function normalizeProgressSnapshot(
  progress: TournamentProgress | null | undefined,
  applyCurrentIndexFixes = false,
): ProgressSnapshot {
  if (!progress) {
    return {
      q: 0,
      semiCorrect: null,
      totalCorrect: 0,
      currentIndex: 0,
      tiebreakerRounds: [],
      finalTiebreakerRounds: [],
      roundStartedAt: null,
      leftAt: null,
      timeLeftSeconds: null,
      answersChosen: [],
      lockedAnswerCount: 0,
    };
  }

  let adjustedQ = progress.questionsAnsweredCount ?? 0;
  let adjustedSemiCorrect = progress.semiFinalCorrectCount ?? null;

  if (applyCurrentIndexFixes) {
    if (
      adjustedQ === QUESTIONS_PER_ROUND - 1 &&
      progress.currentQuestionIndex === QUESTIONS_PER_ROUND - 1
    ) {
      adjustedQ = QUESTIONS_PER_ROUND;
    } else if (
      adjustedQ === 2 * QUESTIONS_PER_ROUND - 1 &&
      progress.currentQuestionIndex === 2 * QUESTIONS_PER_ROUND - 1
    ) {
      adjustedQ = 2 * QUESTIONS_PER_ROUND;
    } else if (
      progress.currentQuestionIndex >= QUESTIONS_PER_ROUND - 1 &&
      adjustedQ < QUESTIONS_PER_ROUND
    ) {
      adjustedQ = QUESTIONS_PER_ROUND;
    } else if (
      progress.currentQuestionIndex >= 2 * QUESTIONS_PER_ROUND - 1 &&
      adjustedQ < 2 * QUESTIONS_PER_ROUND
    ) {
      adjustedQ = 2 * QUESTIONS_PER_ROUND;
    }

    if (progress.currentQuestionIndex > 0) {
      adjustedQ = Math.max(adjustedQ, progress.currentQuestionIndex);
    }

    if (
      progress.semiFinalCorrectCount != null &&
      adjustedQ < QUESTIONS_PER_ROUND &&
      (progress.questionsAnsweredCount ?? 0) >= QUESTIONS_PER_ROUND - 2
    ) {
      adjustedQ = Math.max(adjustedQ, QUESTIONS_PER_ROUND);
    }
  }

  if (
    adjustedSemiCorrect == null &&
    adjustedQ >= QUESTIONS_PER_ROUND &&
    progress.correctAnswersCount != null
  ) {
    adjustedSemiCorrect = Math.min(
      QUESTIONS_PER_ROUND,
      progress.correctAnswersCount,
    );
  }

  if (
    adjustedQ === QUESTIONS_PER_ROUND + 1 &&
    (progress.currentQuestionIndex ?? 0) >= QUESTIONS_PER_ROUND &&
    adjustedSemiCorrect != null &&
    (progress.lockedAnswerCount ?? 0) <= QUESTIONS_PER_ROUND
  ) {
    adjustedQ = QUESTIONS_PER_ROUND;
  }

  return {
    q: adjustedQ,
    semiCorrect: adjustedSemiCorrect,
    totalCorrect: progress.correctAnswersCount ?? 0,
    currentIndex: progress.currentQuestionIndex ?? 0,
    tiebreakerRounds: Array.isArray(progress.tiebreakerRoundsCorrect)
      ? progress.tiebreakerRoundsCorrect
      : [],
    finalTiebreakerRounds: Array.isArray(progress.finalTiebreakerRoundsCorrect)
      ? progress.finalTiebreakerRoundsCorrect
      : [],
    roundStartedAt: progress.roundStartedAt ?? null,
    leftAt: progress.leftAt ?? null,
    timeLeftSeconds: progress.timeLeftSeconds ?? null,
    answersChosen: normalizeChosenAnswers(progress.answersChosen),
    lockedAnswerCount: progress.lockedAnswerCount ?? 0,
  };
}

export function withReliableProgressCorrectCounts(
  progress: TournamentProgress,
  tournament: Tournament | null | undefined,
  questionsByTournamentId: Map<number, ProgressQuestion[]>,
): TournamentProgress {
  if (!tournament) return progress;
  const questions = questionsByTournamentId.get(progress.tournamentId) ?? [];
  if (questions.length === 0) return progress;

  const answersChosen = normalizeChosenAnswers(progress.answersChosen);
  if (!hasReliableChosenAnswers(answersChosen)) return progress;

  const effectivePlayerOrder = getEffectivePlayerOrder(tournament);
  const playerSlot = effectivePlayerOrder.indexOf(progress.userId);
  if (playerSlot < 0) return progress;

  const recomputed = computeCorrectCountsFromQuestions({
    answersChosen,
    semiRoundIndex: playerSlot < 2 ? 0 : 1,
    questionsAnsweredCount:
      progress.questionsAnsweredCount ?? answersChosen.length,
    semiTiebreakerRoundCount: progress.tiebreakerRoundsCorrect?.length ?? 0,
    finalTiebreakerRoundCount:
      progress.finalTiebreakerRoundsCorrect?.length ?? 0,
    questions,
  });

  const shouldUseSemi =
    Math.max(answersChosen.length, progress.questionsAnsweredCount ?? 0) >=
    QUESTIONS_PER_ROUND;
  const nextSemiFinalCorrectCount = shouldUseSemi
    ? recomputed.semi
    : progress.semiFinalCorrectCount;

  if (
    progress.correctAnswersCount === recomputed.total &&
    progress.semiFinalCorrectCount === nextSemiFinalCorrectCount
  ) {
    return progress;
  }

  return {
    ...progress,
    correctAnswersCount: recomputed.total,
    semiFinalCorrectCount: nextSemiFinalCorrectCount,
  };
}

export function getVisibleStageTotalsForProgress(
  progress: TournamentProgress | null | undefined,
  tournament: Tournament | null | undefined,
  questionsByTournamentId: Map<number, ProgressQuestion[]>,
): StageTotalsByProgress {
  if (!progress || !tournament) {
    return {
      semi: { correct: 0, totalQuestions: 0, answeredQuestions: 0 },
      final: { correct: 0, totalQuestions: 0, answeredQuestions: 0 },
    };
  }

  const fallbackTotals = (() => {
    const questionCount = progress.questionsAnsweredCount ?? 0;
    const semiTiebreakerRounds = progress.tiebreakerRoundsCorrect ?? [];
    const semiTiebreakerCorrectSum = semiTiebreakerRounds.reduce(
      (sum, value) => sum + value,
      0,
    );
    const semiMainCorrect =
      progress.semiFinalCorrectCount ??
      Math.min(QUESTIONS_PER_ROUND, progress.correctAnswersCount ?? 0);
    const semiTotalQuestions =
      QUESTIONS_PER_ROUND + semiTiebreakerRounds.length * TIEBREAKER_QUESTIONS;
    const semiAnsweredQuestions = Math.min(questionCount, semiTotalQuestions);
    const finalTiebreakerRounds = progress.finalTiebreakerRoundsCorrect ?? [];
    const finalAnsweredQuestions = Math.max(
      0,
      questionCount - semiTotalQuestions,
    );
    const finalTotalQuestions =
      finalAnsweredQuestions > 0
        ? QUESTIONS_PER_ROUND +
          finalTiebreakerRounds.length * TIEBREAKER_QUESTIONS
        : 0;
    const finalCorrect = finalAnsweredQuestions
      ? Math.max(
          0,
          (progress.correctAnswersCount ?? 0) -
            semiMainCorrect -
            semiTiebreakerCorrectSum,
        )
      : 0;
    return {
      semi: {
        correct: semiMainCorrect + semiTiebreakerCorrectSum,
        totalQuestions: semiTotalQuestions,
        answeredQuestions: semiAnsweredQuestions,
      },
      final: {
        correct: finalCorrect,
        totalQuestions: finalTotalQuestions,
        answeredQuestions: Math.min(
          finalAnsweredQuestions,
          finalTotalQuestions,
        ),
      },
    };
  })();

  const questions = questionsByTournamentId.get(progress.tournamentId) ?? [];
  if (questions.length === 0) return fallbackTotals;

  const answersChosen = normalizeChosenAnswers(progress.answersChosen);
  if (!hasReliableChosenAnswers(answersChosen)) return fallbackTotals;
  const effectivePlayerOrder = getEffectivePlayerOrder(tournament);
  const playerSlot = effectivePlayerOrder.indexOf(progress.userId);
  if (playerSlot < 0) return fallbackTotals;

  return computeVisibleStageTotalsFromQuestions({
    answersChosen,
    semiRoundIndex: playerSlot < 2 ? 0 : 1,
    questionsAnsweredCount:
      progress.questionsAnsweredCount ?? answersChosen.length,
    semiTiebreakerRoundCount: progress.tiebreakerRoundsCorrect?.length ?? 0,
    finalTiebreakerRoundCount:
      progress.finalTiebreakerRoundsCorrect?.length ?? 0,
    questions,
  });
}
