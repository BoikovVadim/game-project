import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canReuseTournamentCandidate,
  compareReusableTournamentCandidates,
  isTournamentStructurallyFinishable,
  pickResumeTournamentId,
  pickReusableTournamentCandidate,
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

test('prefers the smallest tournament id for reuse', () => {
  const candidates = [
    {
      id: 45,
      playerCount: 3,
      hasCurrentUser: false,
    },
    {
      id: 3,
      playerCount: 2,
      hasCurrentUser: false,
    },
    {
      id: 11,
      playerCount: 1,
      hasCurrentUser: false,
    },
  ];

  candidates.sort(compareReusableTournamentCandidates);
  assert.deepEqual(
    candidates.map((candidate) => candidate.id),
    [3, 11, 45],
  );
});

test('rejects reusable candidates with current user or full bracket', () => {
  assert.equal(
    canReuseTournamentCandidate({
      id: 5,
      playerCount: 4,
      hasCurrentUser: false,
    }),
    false,
  );
  assert.equal(
    canReuseTournamentCandidate({
      id: 6,
      playerCount: 2,
      hasCurrentUser: true,
    }),
    false,
  );
});

test('picks the smallest joinable reusable candidate', () => {
  const candidate = pickReusableTournamentCandidate([
    { id: 7, playerCount: 4, hasCurrentUser: false },
    { id: 5, playerCount: 2, hasCurrentUser: true },
    { id: 9, playerCount: 2, hasCurrentUser: false },
    { id: 3, playerCount: 1, hasCurrentUser: false },
  ]);

  assert.equal(candidate?.id, 3);
});

test('picks the smallest resumable tournament id', () => {
  assert.equal(
    pickResumeTournamentId([
      { id: 45, canContinue: true },
      { id: 3, canContinue: false },
      { id: 11, canContinue: true },
    ]),
    11,
  );
});

test('only 4-player tournaments are structurally finishable', () => {
  assert.equal(isTournamentStructurallyFinishable(2), false);
  assert.equal(isTournamentStructurallyFinishable(3), false);
  assert.equal(isTournamentStructurallyFinishable(4), true);
});
