import type {
  QuestionsReviewData,
  TournamentJoinInfo,
  TournamentSessionViewModel,
  TrainingQuestion,
  TrainingStateResponse,
} from "./contracts.ts";

type BuildTournamentSessionOptions = {
  joinInfo: TournamentJoinInfo;
  questionTimerSeconds: number;
};

function padAnswersSlice(
  answers: number[],
  startIndex: number,
  endExclusive: number,
): number[] {
  if (endExclusive <= startIndex) return [];
  const size = endExclusive - startIndex;
  const slice = answers.slice(startIndex, endExclusive);
  if (slice.length >= size) return slice;
  return [...slice, ...Array(size - slice.length).fill(-1)];
}

function countCorrectAnswers(
  questions: TrainingQuestion[],
  answers: number[],
): number {
  return questions.reduce(
    (sum, question, index) => sum + (question.correctAnswer === answers[index] ? 1 : 0),
    0,
  );
}

export function toQuestionsReviewData(
  data: TrainingStateResponse,
): QuestionsReviewData {
  const answersChosenRaw =
    data.answersChosen ?? (data as { answers_chosen?: number[] }).answers_chosen;
  return {
    questionsSemi1: data.questionsSemi1 ?? [],
    questionsSemi2: data.questionsSemi2 ?? [],
    questionsFinal: data.questionsFinal ?? [],
    questionsAnsweredCount: data.questionsAnsweredCount ?? 0,
    correctAnswersCount: data.correctAnswersCount ?? 0,
    semiFinalCorrectCount: data.semiFinalCorrectCount ?? null,
    semiTiebreakerCorrectSum: data.semiTiebreakerCorrectSum ?? 0,
    answersChosen: Array.isArray(answersChosenRaw) ? answersChosenRaw : [],
    userSemiIndex: data.userSemiIndex ?? 0,
    semiTiebreakerAllQuestions: data.semiTiebreakerAllQuestions ?? [],
    semiTiebreakerRoundsCorrect: data.semiTiebreakerRoundsCorrect ?? [],
    finalTiebreakerAllQuestions: data.finalTiebreakerAllQuestions ?? [],
    finalTiebreakerRoundsCorrect: data.finalTiebreakerRoundsCorrect ?? [],
    reviewRounds: data.reviewRounds ?? [],
    opponentAnswersByRound: data.opponentAnswersByRound ?? [],
    opponentInfoByRound: data.opponentInfoByRound ?? [],
  };
}

export function buildTournamentSessionViewModel(
  data: TrainingStateResponse,
  options: BuildTournamentSessionOptions,
): TournamentSessionViewModel {
  const { joinInfo, questionTimerSeconds } = options;
  const answersChosen = Array.isArray(data.answersChosen) ? data.answersChosen : [];
  const rawCurrentIndex =
    data.currentQuestionIndex ?? data.questionsAnsweredCount ?? 0;
  const lockedAnswerCount = data.lockedAnswerCount ?? 0;
  const currentIndex =
    lockedAnswerCount > 0
      ? Math.min(rawCurrentIndex, lockedAnswerCount + 1)
      : rawCurrentIndex;
  const semiResult = data.semiResult;
  const tiebreakerQuestions = data.questionsTiebreaker ?? [];
  const tiebreakerBase = data.tiebreakerBase ?? 0;
  const tiebreakerPhase = data.tiebreakerPhase;
  const semiTiebreakerRounds = data.semiTiebreakerRoundsCorrect ?? [];
  const semiPhaseTotal = 10 + semiTiebreakerRounds.length * 10;
  const trainingData = {
    tournamentId: data.tournamentId,
    deadline: data.deadline,
    questionsSemi1: data.questionsSemi1 ?? [],
    questionsSemi2: data.questionsSemi2 ?? [],
    questionsFinal: data.questionsFinal ?? [],
    questionsTiebreaker: tiebreakerQuestions,
    tiebreakerRound: data.tiebreakerRound ?? 0,
    tiebreakerBase,
    tiebreakerPhase,
  };

  const baseModel: Omit<TournamentSessionViewModel, "trainingRound" | "trainingQuestionIndex" | "trainingAnswers" | "trainingRoundScores" | "trainingRoundComplete"> = {
    trainingData,
    joinInfo: { ...joinInfo, deadline: data.deadline },
    fullAnswersChosen: answersChosen,
    trainingCorrectCount: data.correctAnswersCount ?? 0,
    semiPhaseTotal,
    tiebreakerBase,
    timeLeft: data.timeLeftSeconds ?? questionTimerSeconds,
    notice: null,
  };

  if (semiResult === "tie" && tiebreakerQuestions.length > 0) {
    const indexInTiebreaker = Math.max(0, currentIndex - tiebreakerBase);
    const clampedIndex = Math.min(indexInTiebreaker, tiebreakerQuestions.length);
    const tiebreakerAnswers = padAnswersSlice(
      answersChosen,
      tiebreakerBase,
      tiebreakerBase + clampedIndex,
    );
    const roundComplete = indexInTiebreaker >= tiebreakerQuestions.length;
    return {
      ...baseModel,
      trainingRound: 3,
      trainingQuestionIndex: clampedIndex,
      trainingAnswers: tiebreakerAnswers,
      trainingRoundScores: roundComplete
        ? [countCorrectAnswers(tiebreakerQuestions, padAnswersSlice(answersChosen, tiebreakerBase, tiebreakerBase + tiebreakerQuestions.length))]
        : [],
      trainingRoundComplete: roundComplete,
    };
  }

  if (
    semiResult === "won" &&
    tiebreakerPhase === "final" &&
    tiebreakerQuestions.length > 0
  ) {
    const indexInTiebreaker = Math.max(0, currentIndex - tiebreakerBase);
    const clampedIndex = Math.min(indexInTiebreaker, tiebreakerQuestions.length);
    const tiebreakerAnswers = padAnswersSlice(
      answersChosen,
      tiebreakerBase,
      tiebreakerBase + clampedIndex,
    );
    const roundComplete = indexInTiebreaker >= tiebreakerQuestions.length;
    return {
      ...baseModel,
      trainingRound: 3,
      trainingQuestionIndex: clampedIndex,
      trainingAnswers: tiebreakerAnswers,
      trainingRoundScores: roundComplete
        ? [countCorrectAnswers(tiebreakerQuestions, padAnswersSlice(answersChosen, tiebreakerBase, tiebreakerBase + tiebreakerQuestions.length))]
        : [],
      trainingRoundComplete: roundComplete,
    };
  }

  if (currentIndex < 10) {
    return {
      ...baseModel,
      trainingRound: joinInfo.semiIndex === 0 ? 0 : 1,
      trainingQuestionIndex: currentIndex,
      trainingAnswers: padAnswersSlice(answersChosen, 0, currentIndex),
      trainingRoundScores: [],
      trainingRoundComplete: false,
    };
  }

  if (
    currentIndex >= 10 &&
    semiResult === "won" &&
    (data.questionsFinal?.length ?? 0) > 0
  ) {
    if (currentIndex < semiPhaseTotal + 10) {
      const indexInFinal = Math.max(0, currentIndex - semiPhaseTotal);
      return {
        ...baseModel,
        trainingRound: 2,
        trainingQuestionIndex: indexInFinal,
        trainingAnswers: padAnswersSlice(
          answersChosen,
          semiPhaseTotal,
          semiPhaseTotal + indexInFinal,
        ),
        trainingRoundScores: [
          data.semiFinalCorrectCount ?? data.correctAnswersCount ?? 0,
        ],
        trainingRoundComplete: indexInFinal >= 10,
      };
    }

    const semiScore = data.semiFinalCorrectCount ?? 0;
    const finalScore = (data.correctAnswersCount ?? 0) - semiScore;
    return {
      ...baseModel,
      trainingRound: 2,
      trainingQuestionIndex: 10,
      trainingAnswers: padAnswersSlice(
        answersChosen,
        semiPhaseTotal,
        semiPhaseTotal + 10,
      ),
      trainingRoundScores: [semiScore, finalScore],
      trainingRoundComplete: true,
    };
  }

  if (
    semiResult === "waiting" ||
    semiResult === "lost" ||
    (currentIndex >= 10 &&
      (data.questionsFinal?.length ?? 0) === 0 &&
      semiResult !== "tie")
  ) {
    return {
      ...baseModel,
      trainingRound: joinInfo.semiIndex === 0 ? 0 : 1,
      trainingQuestionIndex: Math.min(currentIndex, 10),
      trainingAnswers: padAnswersSlice(
        answersChosen,
        0,
        Math.min(currentIndex, 10),
      ),
      trainingRoundScores: currentIndex >= 10 ? [data.correctAnswersCount ?? 0] : [],
      trainingRoundComplete: currentIndex >= 10,
      notice: {
        title: semiResult === "lost" ? "Полуфинал завершён" : "Ожидание соперника",
        text:
          semiResult === "lost"
            ? "К сожалению, соперник набрал больше баллов."
            : "Вы завершили полуфинал. Ожидайте, пока соперник ответит на все вопросы.",
      },
    };
  }

  if (semiResult === "tie" && currentIndex >= 10) {
    return {
      ...baseModel,
      trainingRound: joinInfo.semiIndex === 0 ? 0 : 1,
      trainingQuestionIndex: Math.min(currentIndex, 10),
      trainingAnswers: padAnswersSlice(
        answersChosen,
        0,
        Math.min(currentIndex, 10),
      ),
      trainingRoundScores: currentIndex >= 10 ? [data.correctAnswersCount ?? 0] : [],
      trainingRoundComplete: currentIndex >= 10,
      notice: {
        title: "Доп. раунд",
        text: "Ничья в полуфинале. Ожидайте формирование вопросов доп. раунда.",
      },
    };
  }

  return {
    ...baseModel,
    trainingRound: joinInfo.semiIndex === 0 ? 0 : 1,
    trainingQuestionIndex: Math.min(currentIndex, 10),
    trainingAnswers: padAnswersSlice(
      answersChosen,
      0,
      Math.min(currentIndex, 10),
    ),
    trainingRoundScores: currentIndex >= 10 ? [data.correctAnswersCount ?? 0] : [],
    trainingRoundComplete: currentIndex >= 10,
  };
}
