import { describe, expect, it } from "vitest";
import type { TournamentJoinInfo, TrainingStateResponse } from "./contracts.ts";
import {
  buildTournamentSessionViewModel,
  toQuestionsReviewData,
} from "./session.ts";

function createJoinInfo(overrides: Partial<TournamentJoinInfo> = {}): TournamentJoinInfo {
  return {
    tournamentId: 12,
    playerSlot: 0,
    totalPlayers: 4,
    semiIndex: 0,
    positionInSemi: 0,
    isCreator: false,
    deadline: null,
    ...overrides,
  };
}

function createTrainingState(
  overrides: Partial<TrainingStateResponse> = {},
): TrainingStateResponse {
  const questions = Array.from({ length: 10 }, (_, index) => ({
    id: index + 1,
    question: `Question ${index + 1}`,
    options: ["A", "B", "C", "D"],
    correctAnswer: index % 4,
  }));
  return {
    tournamentId: 12,
    deadline: null,
    questionsSemi1: questions,
    questionsSemi2: questions,
    questionsFinal: questions,
    questionsTiebreaker: [],
    tiebreakerRound: 0,
    tiebreakerBase: 0,
    tiebreakerPhase: null,
    questionsAnsweredCount: 0,
    currentQuestionIndex: 0,
    lockedAnswerCount: 0,
    timeLeftSeconds: 4,
    leftAt: null,
    correctAnswersCount: 0,
    semiFinalCorrectCount: null,
    semiTiebreakerCorrectSum: 0,
    answersChosen: [],
    userSemiIndex: 0,
    semiResult: "playing",
    semiTiebreakerAllQuestions: [],
    semiTiebreakerRoundsCorrect: [],
    finalTiebreakerAllQuestions: [],
    finalTiebreakerRoundsCorrect: [],
    reviewRounds: [],
    opponentAnswersByRound: [],
    opponentInfoByRound: [],
    ...overrides,
  };
}

describe("buildTournamentSessionViewModel", () => {
  it("restores semifinal progress from server state", () => {
    const result = buildTournamentSessionViewModel(
      createTrainingState({
        currentQuestionIndex: 3,
        answersChosen: [1, 2, 3],
      }),
      {
        joinInfo: createJoinInfo(),
        questionTimerSeconds: 5,
      },
    );

    expect(result.trainingRound).toBe(0);
    expect(result.trainingQuestionIndex).toBe(3);
    expect(result.trainingAnswers).toEqual([1, 2, 3]);
    expect(result.trainingRoundComplete).toBe(false);
    expect(result.notice).toBeNull();
  });

  it("returns waiting notice instead of fake playable final state", () => {
    const result = buildTournamentSessionViewModel(
      createTrainingState({
        currentQuestionIndex: 10,
        questionsAnsweredCount: 10,
        correctAnswersCount: 7,
        semiResult: "waiting",
        questionsFinal: [],
      }),
      {
        joinInfo: createJoinInfo(),
        questionTimerSeconds: 5,
      },
    );

    expect(result.notice).toEqual({
      title: "Ожидание соперника",
      text: "Вы завершили полуфинал. Ожидайте, пока соперник ответит на все вопросы.",
    });
    expect(result.trainingRoundComplete).toBe(true);
  });

  it("restores final tiebreaker round with accumulated base", () => {
    const tiebreakerQuestions = Array.from({ length: 10 }, (_, index) => ({
      id: 100 + index,
      question: `TB ${index + 1}`,
      options: ["A", "B", "C", "D"],
      correctAnswer: 1,
    }));
    const result = buildTournamentSessionViewModel(
      createTrainingState({
        semiResult: "won",
        tiebreakerPhase: "final",
        questionsTiebreaker: tiebreakerQuestions,
        tiebreakerBase: 20,
        semiFinalCorrectCount: 8,
        correctAnswersCount: 12,
        currentQuestionIndex: 23,
        answersChosen: [...Array(20).fill(-1), 1, 1, 0],
      }),
      {
        joinInfo: createJoinInfo(),
        questionTimerSeconds: 5,
      },
    );

    expect(result.trainingRound).toBe(3);
    expect(result.tiebreakerBase).toBe(20);
    expect(result.trainingQuestionIndex).toBe(3);
    expect(result.trainingAnswers).toEqual([1, 1, 0]);
    expect(result.notice).toBeNull();
  });
});

describe("toQuestionsReviewData", () => {
  it("keeps review-only machine-readable fields", () => {
    const result = toQuestionsReviewData(
      createTrainingState({
        answersChosen: [2, 3],
        reviewRounds: [
          {
            key: "semi-main",
            label: "Полуфинал",
            stageKind: "semi",
            isTiebreaker: false,
            sequence: 0,
            startIdx: 0,
            correctCount: 2,
            opponentRoundIndex: 0,
            questions: [],
          },
        ],
      }),
    );

    expect(result.answersChosen).toEqual([2, 3]);
    expect(result.reviewRounds).toHaveLength(1);
    expect(result.reviewRounds[0]?.key).toBe("semi-main");
  });
});
