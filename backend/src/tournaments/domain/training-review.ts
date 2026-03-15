import type {
  TournamentQuestionDto,
  TournamentTrainingReviewRoundDto,
} from '../dto/tournament-read.dto';

export function buildTrainingReviewRounds(args: {
  questionsPerRound: number;
  tiebreakerQuestions: number;
  userSemiIndex: number;
  questionsSemi1: TournamentQuestionDto[];
  questionsSemi2: TournamentQuestionDto[];
  questionsFinal: TournamentQuestionDto[];
  questionsAnsweredCount: number;
  correctAnswersCount: number;
  semiFinalCorrectCount: number | null;
  semiTiebreakerAllQuestions: TournamentQuestionDto[][];
  semiTiebreakerRoundsCorrect: number[];
  finalTiebreakerAllQuestions: TournamentQuestionDto[][];
  finalTiebreakerRoundsCorrect: number[];
}): TournamentTrainingReviewRoundDto[] {
  const {
    questionsPerRound,
    tiebreakerQuestions,
    userSemiIndex,
    questionsSemi1,
    questionsSemi2,
    questionsFinal,
    questionsAnsweredCount,
    correctAnswersCount,
    semiFinalCorrectCount,
    semiTiebreakerAllQuestions,
    semiTiebreakerRoundsCorrect,
    finalTiebreakerAllQuestions,
    finalTiebreakerRoundsCorrect,
  } = args;

  const semiQuestions = userSemiIndex === 0 ? questionsSemi1 : questionsSemi2;
  const semiCorrect =
    semiFinalCorrectCount ??
    (questionsAnsweredCount <= questionsPerRound ? correctAnswersCount : 0);
  const semiTBSum = semiTiebreakerRoundsCorrect.reduce(
    (sum, value) => sum + value,
    0,
  );
  const finalTBSum = finalTiebreakerRoundsCorrect.reduce(
    (sum, value) => sum + value,
    0,
  );
  const completedSemiTBCount = semiTiebreakerRoundsCorrect.length;
  const hasFinalStarted =
    questionsFinal.length > 0 &&
    questionsAnsweredCount >
      questionsPerRound + completedSemiTBCount * tiebreakerQuestions;
  const visibleSemiTBCount = hasFinalStarted
    ? Math.min(semiTiebreakerAllQuestions.length, completedSemiTBCount)
    : Math.min(
        semiTiebreakerAllQuestions.length,
        Math.max(
          completedSemiTBCount,
          Math.ceil(
            Math.max(0, questionsAnsweredCount - questionsPerRound) /
              tiebreakerQuestions,
          ),
        ),
      );

  const rounds: TournamentTrainingReviewRoundDto[] = [];
  let opponentRoundIndex = 0;
  rounds.push({
    key: 'semi-main',
    label: 'Полуфинал',
    stageKind: 'semi',
    isTiebreaker: false,
    sequence: 0,
    startIdx: 0,
    correctCount: semiCorrect,
    opponentRoundIndex: opponentRoundIndex++,
    questions: semiQuestions,
  });

  let cursor = questionsPerRound;
  for (let roundIndex = 0; roundIndex < visibleSemiTBCount; roundIndex++) {
    if (questionsAnsweredCount <= cursor) break;
    rounds.push({
      key: `semi-tb-${roundIndex + 1}`,
      label:
        semiTiebreakerAllQuestions.length === 1
          ? 'Доп. раунд (ПФ)'
          : `Доп. раунд ${roundIndex + 1} (ПФ)`,
      stageKind: 'semi',
      isTiebreaker: true,
      sequence: roundIndex + 1,
      startIdx: cursor,
      correctCount: semiTiebreakerRoundsCorrect[roundIndex] ?? 0,
      opponentRoundIndex: opponentRoundIndex++,
      questions: semiTiebreakerAllQuestions[roundIndex] ?? [],
    });
    cursor += tiebreakerQuestions;
  }

  if (questionsFinal.length > 0 && questionsAnsweredCount > cursor) {
    rounds.push({
      key: 'final-main',
      label: 'Финал',
      stageKind: 'final',
      isTiebreaker: false,
      sequence: 0,
      startIdx: cursor,
      correctCount: Math.max(
        0,
        correctAnswersCount - semiCorrect - semiTBSum - finalTBSum,
      ),
      opponentRoundIndex: opponentRoundIndex++,
      questions: questionsFinal,
    });
    cursor += questionsPerRound;

    const visibleFinalTBCount = Math.min(
      finalTiebreakerAllQuestions.length,
      Math.max(
        finalTiebreakerRoundsCorrect.length,
        Math.ceil(
          Math.max(0, questionsAnsweredCount - cursor) / tiebreakerQuestions,
        ),
      ),
    );
    for (let roundIndex = 0; roundIndex < visibleFinalTBCount; roundIndex++) {
      if (questionsAnsweredCount <= cursor) break;
      rounds.push({
        key: `final-tb-${roundIndex + 1}`,
        label:
          finalTiebreakerAllQuestions.length === 1
            ? 'Доп. раунд (Ф)'
            : `Доп. раунд ${roundIndex + 1} (Ф)`,
        stageKind: 'final',
        isTiebreaker: true,
        sequence: roundIndex + 1,
        startIdx: cursor,
        correctCount: finalTiebreakerRoundsCorrect[roundIndex] ?? 0,
        opponentRoundIndex: opponentRoundIndex++,
        questions: finalTiebreakerAllQuestions[roundIndex] ?? [],
      });
      cursor += tiebreakerQuestions;
    }
  }

  return rounds;
}
