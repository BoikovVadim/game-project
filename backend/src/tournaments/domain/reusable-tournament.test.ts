import assert from 'node:assert/strict';
import test from 'node:test';
import {
  compareReusableTournamentCandidates,
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

test('keeps fresh single-player waiting tournaments waiting', () => {
  assert.equal(
    shouldTournamentBeActive({
      status: 'waiting',
      playerCount: 1,
      progressCount: 0,
    }),
    false,
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
