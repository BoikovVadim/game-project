import assert from 'node:assert/strict';
import test from 'node:test';
import { isFinalRoundFinished } from './final-round-finished';

test('keeps final tie playable after base final questions', () => {
  assert.equal(
    isFinalRoundFinished({
      myQuestionCount: 20,
      mySemiPhaseQuestionCount: 10,
      finalResult: 'tie',
      tiebreakerRound: 1,
    }),
    false,
  );
});

test('keeps next final tiebreaker playable after the previous tiebreaker tie', () => {
  assert.equal(
    isFinalRoundFinished({
      myQuestionCount: 30,
      mySemiPhaseQuestionCount: 10,
      finalResult: 'tie',
      tiebreakerRound: 2,
    }),
    false,
  );
});

test('marks final round finished after decisive final result', () => {
  assert.equal(
    isFinalRoundFinished({
      myQuestionCount: 20,
      mySemiPhaseQuestionCount: 10,
      finalResult: 'won',
    }),
    true,
  );
});
