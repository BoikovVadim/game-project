import assert from 'node:assert/strict';
import test from 'node:test';
import {
  normalizeProgressSnapshot,
  getEffectivePlayerOrder,
} from './progress-read-model';
import { Tournament } from '../tournament.entity';
import { TournamentProgress } from '../tournament-progress.entity';

test('getEffectivePlayerOrder appends missing player ids without mutating source order', () => {
  const tournament = {
    playerOrder: [4, 2],
    players: [{ id: 2 }, { id: 3 }, { id: 4 }],
  } as Tournament;

  assert.deepEqual(getEffectivePlayerOrder(tournament), [4, 2, 3]);
  assert.deepEqual(tournament.playerOrder, [4, 2]);
});

test('normalizeProgressSnapshot derives stable semi state and chosen answers', () => {
  const progress = {
    questionsAnsweredCount: 9,
    semiFinalCorrectCount: null,
    correctAnswersCount: 7,
    currentQuestionIndex: 9,
    tiebreakerRoundsCorrect: [3],
    finalTiebreakerRoundsCorrect: [2],
    roundStartedAt: new Date('2026-03-16T00:00:00.000Z'),
    leftAt: new Date('2026-03-16T00:01:00.000Z'),
    timeLeftSeconds: 11,
    answersChosen: '[1,2,0,-1]',
    lockedAnswerCount: 4,
  } as TournamentProgress;

  assert.deepEqual(normalizeProgressSnapshot(progress, true), {
    q: 10,
    semiCorrect: 7,
    totalCorrect: 7,
    currentIndex: 9,
    tiebreakerRounds: [3],
    finalTiebreakerRounds: [2],
    roundStartedAt: new Date('2026-03-16T00:00:00.000Z'),
    leftAt: new Date('2026-03-16T00:01:00.000Z'),
    timeLeftSeconds: 11,
    answersChosen: [1, 2, 0, -1],
    lockedAnswerCount: 4,
  });
});
