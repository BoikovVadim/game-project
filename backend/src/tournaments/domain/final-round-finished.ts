import {
  QUESTIONS_PER_ROUND,
  TIEBREAKER_QUESTIONS,
} from './constants';

export type FinalRoundResultState = 'won' | 'lost' | 'tie' | 'incomplete';

export function isFinalRoundFinished(args: {
  myQuestionCount: number;
  mySemiPhaseQuestionCount: number;
  finalResult: FinalRoundResultState;
  tiebreakerRound?: number;
}): boolean {
  const {
    myQuestionCount,
    mySemiPhaseQuestionCount,
    finalResult,
    tiebreakerRound,
  } = args;

  if (myQuestionCount < mySemiPhaseQuestionCount) return true;

  if (finalResult === 'tie') {
    const nextRoundTarget =
      mySemiPhaseQuestionCount +
      QUESTIONS_PER_ROUND +
      (tiebreakerRound ?? 1) * TIEBREAKER_QUESTIONS;
    return myQuestionCount >= nextRoundTarget;
  }

  return myQuestionCount >= mySemiPhaseQuestionCount + QUESTIONS_PER_ROUND;
}
