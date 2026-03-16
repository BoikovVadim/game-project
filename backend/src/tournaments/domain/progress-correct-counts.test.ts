import assert from 'node:assert/strict';
import test from 'node:test';
import {
  computeCorrectCountsFromQuestions,
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
