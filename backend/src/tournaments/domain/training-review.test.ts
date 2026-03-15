import assert from 'node:assert/strict';
import test from 'node:test';
import { buildTrainingReviewRounds } from './training-review';

function makeQuestions(prefix: string, count = 10) {
  return Array.from({ length: count }, (_, index) => ({
    id: index + 1,
    question: `${prefix}-${index + 1}`,
    options: ['A', 'B', 'C', 'D'],
    correctAnswer: 0,
  }));
}

test('returns only semifinal review when final has not started', () => {
  const rounds = buildTrainingReviewRounds({
    questionsPerRound: 10,
    tiebreakerQuestions: 10,
    userSemiIndex: 0,
    questionsSemi1: makeQuestions('semi-1'),
    questionsSemi2: makeQuestions('semi-2'),
    questionsFinal: makeQuestions('final'),
    questionsAnsweredCount: 10,
    correctAnswersCount: 7,
    semiFinalCorrectCount: 7,
    semiTiebreakerAllQuestions: [],
    semiTiebreakerRoundsCorrect: [],
    finalTiebreakerAllQuestions: [],
    finalTiebreakerRoundsCorrect: [],
  });

  assert.equal(rounds.length, 1);
  assert.deepEqual(rounds.map((round) => round.key), ['semi-main']);
  assert.equal(rounds[0]?.correctCount, 7);
});

test('keeps only completed semi tiebreakers once final started', () => {
  const rounds = buildTrainingReviewRounds({
    questionsPerRound: 10,
    tiebreakerQuestions: 10,
    userSemiIndex: 0,
    questionsSemi1: makeQuestions('semi-1'),
    questionsSemi2: makeQuestions('semi-2'),
    questionsFinal: makeQuestions('final'),
    questionsAnsweredCount: 21,
    correctAnswersCount: 12,
    semiFinalCorrectCount: 6,
    semiTiebreakerAllQuestions: [makeQuestions('semi-tb-1'), makeQuestions('semi-tb-2')],
    semiTiebreakerRoundsCorrect: [4],
    finalTiebreakerAllQuestions: [],
    finalTiebreakerRoundsCorrect: [],
  });

  assert.deepEqual(rounds.map((round) => round.key), [
    'semi-main',
    'semi-tb-1',
    'final-main',
  ]);
  assert.equal(rounds[2]?.startIdx, 20);
  assert.equal(rounds[2]?.correctCount, 2);
});

test('includes final tiebreakers after финал tie rounds', () => {
  const rounds = buildTrainingReviewRounds({
    questionsPerRound: 10,
    tiebreakerQuestions: 10,
    userSemiIndex: 1,
    questionsSemi1: makeQuestions('semi-1'),
    questionsSemi2: makeQuestions('semi-2'),
    questionsFinal: makeQuestions('final'),
    questionsAnsweredCount: 30,
    correctAnswersCount: 15,
    semiFinalCorrectCount: 5,
    semiTiebreakerAllQuestions: [],
    semiTiebreakerRoundsCorrect: [],
    finalTiebreakerAllQuestions: [makeQuestions('final-tb-1')],
    finalTiebreakerRoundsCorrect: [3],
  });

  assert.deepEqual(rounds.map((round) => round.key), [
    'semi-main',
    'final-main',
    'final-tb-1',
  ]);
  assert.equal(rounds[0]?.questions[0]?.question, 'semi-2-1');
  assert.equal(rounds[2]?.stageKind, 'final');
  assert.equal(rounds[2]?.isTiebreaker, true);
});
