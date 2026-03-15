import assert from 'node:assert/strict';
import test from 'node:test';
import {
  compareReusableTournamentCandidates,
  isTournamentStructurallyFinishable,
  shouldTournamentBeActive,
} from './reusable-tournament';

test('promotes waiting tournaments with started progress to active', () => {
  assert.equal(
    shouldTournamentBeActive({
      status: 'waiting',
      playerCount: 1,
      progressCount: 1,
    }),
    true,
  );
});

test('promotes waiting tournaments with multiple players to active', () => {
  assert.equal(
    shouldTournamentBeActive({
      status: 'waiting',
      playerCount: 2,
      progressCount: 0,
    }),
    true,
  );
});

test('promotes fresh single-player waiting tournaments to active', () => {
  assert.equal(
    shouldTournamentBeActive({
      status: 'waiting',
      playerCount: 1,
      progressCount: 0,
    }),
    true,
  );
});

test('prefers active tournaments with more players for reuse', () => {
  const candidates = [
    {
      id: 20,
      status: 'waiting',
      playerCount: 1,
      progressCount: 1,
    },
    {
      id: 11,
      status: 'active',
      playerCount: 2,
      progressCount: 2,
    },
    {
      id: 10,
      status: 'active',
      playerCount: 3,
      progressCount: 3,
    },
  ];

  candidates.sort(compareReusableTournamentCandidates);
  assert.deepEqual(
    candidates.map((candidate) => candidate.id),
    [10, 11, 20],
  );
});

test('only 4-player tournaments are structurally finishable', () => {
  assert.equal(isTournamentStructurallyFinishable(2), false);
  assert.equal(isTournamentStructurallyFinishable(3), false);
  assert.equal(isTournamentStructurallyFinishable(4), true);
});
