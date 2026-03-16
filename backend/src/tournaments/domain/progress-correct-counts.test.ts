import assert from 'node:assert/strict';
import test from 'node:test';
import {
  computeCorrectCountsFromQuestions,
  computeVisibleStageTotalsFromQuestions,
  hasReliableChosenAnswers,
  normalizeChosenAnswers,
} from './progress-correct-counts';

test('normalizes answers from json strings', () => {
  assert.deepEqual(normalizeChosenAnswers('[1,2,-1,"x"]'), [1, 2, -1, -1]);
});

test('flags flat answer arrays as unreliable', () => {
  assert.equal(hasReliableChosenAnswers([0, 0, 0, 0]), false);
  assert.equal(hasReliableChosenAnswers([0, 1, 0, 1]), true);
});

test('computes semi and final correct counts in player order', () => {
  const result = computeCorrectCountsFromQuestions({
    answersChosen: [1, 0, 0, 2],
    semiRoundIndex: 1,
    questionsAnsweredCount: 4,
    questions: [
      { roundIndex: 0, correctAnswer: 9 },
      { roundIndex: 1, correctAnswer: 1 },
      { roundIndex: 1, correctAnswer: 0 },
      { roundIndex: 2, correctAnswer: 0 },
      { roundIndex: 2, correctAnswer: 1 },
      { roundIndex: 100, correctAnswer: 2 },
    ],
  });

  assert.deepEqual(result, { total: 3, semi: 2 });
});

test('skips hidden semifinal tiebreakers once final already started', () => {
  const result = computeCorrectCountsFromQuestions({
    answersChosen: [
      2, 1, 0, 1, 0, 1, 0, 1, 1, 1,
      1, 3, 0, 2, 2, 2, 2, 0, 1, -1,
    ],
    semiRoundIndex: 1,
    questionsAnsweredCount: 20,
    semiTiebreakerRoundCount: 0,
    finalTiebreakerRoundCount: 0,
    questions: [
      { roundIndex: 1, correctAnswer: 2 },
      { roundIndex: 1, correctAnswer: 1 },
      { roundIndex: 1, correctAnswer: 0 },
      { roundIndex: 1, correctAnswer: 1 },
      { roundIndex: 1, correctAnswer: 0 },
      { roundIndex: 1, correctAnswer: 1 },
      { roundIndex: 1, correctAnswer: 1 },
      { roundIndex: 1, correctAnswer: 1 },
      { roundIndex: 1, correctAnswer: 2 },
      { roundIndex: 1, correctAnswer: 1 },
      { roundIndex: 2, correctAnswer: 1 },
      { roundIndex: 2, correctAnswer: 3 },
      { roundIndex: 2, correctAnswer: 0 },
      { roundIndex: 2, correctAnswer: 2 },
      { roundIndex: 2, correctAnswer: 3 },
      { roundIndex: 2, correctAnswer: 2 },
      { roundIndex: 2, correctAnswer: 0 },
      { roundIndex: 2, correctAnswer: 2 },
      { roundIndex: 2, correctAnswer: 2 },
      { roundIndex: 2, correctAnswer: 3 },
      { roundIndex: 3, correctAnswer: 3 },
      { roundIndex: 3, correctAnswer: 0 },
      { roundIndex: 3, correctAnswer: 0 },
      { roundIndex: 3, correctAnswer: 0 },
      { roundIndex: 3, correctAnswer: 1 },
      { roundIndex: 3, correctAnswer: 0 },
      { roundIndex: 3, correctAnswer: 3 },
      { roundIndex: 3, correctAnswer: 1 },
      { roundIndex: 3, correctAnswer: 1 },
      { roundIndex: 3, correctAnswer: 0 },
    ],
  });

  assert.deepEqual(result, { total: 13, semi: 8 });
});

test('computes visible stage totals from answers', () => {
  const result = computeVisibleStageTotalsFromQuestions({
    answersChosen: [
      2, 1, 0, 1, 0, 1, 0, 1, 1, 1,
      1, 3, 0, 2, 2, 2, 2, 0, 1, -1,
    ],
    semiRoundIndex: 1,
    questionsAnsweredCount: 20,
    semiTiebreakerRoundCount: 0,
    finalTiebreakerRoundCount: 0,
    questions: [
      { roundIndex: 1, correctAnswer: 2 },
      { roundIndex: 1, correctAnswer: 1 },
      { roundIndex: 1, correctAnswer: 0 },
      { roundIndex: 1, correctAnswer: 1 },
      { roundIndex: 1, correctAnswer: 0 },
      { roundIndex: 1, correctAnswer: 1 },
      { roundIndex: 1, correctAnswer: 1 },
      { roundIndex: 1, correctAnswer: 1 },
      { roundIndex: 1, correctAnswer: 2 },
      { roundIndex: 1, correctAnswer: 1 },
      { roundIndex: 2, correctAnswer: 1 },
      { roundIndex: 2, correctAnswer: 3 },
      { roundIndex: 2, correctAnswer: 0 },
      { roundIndex: 2, correctAnswer: 2 },
      { roundIndex: 2, correctAnswer: 3 },
      { roundIndex: 2, correctAnswer: 2 },
      { roundIndex: 2, correctAnswer: 0 },
      { roundIndex: 2, correctAnswer: 2 },
      { roundIndex: 2, correctAnswer: 2 },
      { roundIndex: 2, correctAnswer: 3 },
    ],
  });

  assert.deepEqual(result, {
    semi: { correct: 8, totalQuestions: 10, answeredQuestions: 10 },
    final: { correct: 5, totalQuestions: 10, answeredQuestions: 10 },
  });
});
