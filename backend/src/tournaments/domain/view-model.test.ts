import assert from 'node:assert/strict';
import test from 'node:test';
import { deriveTournamentViewMeta } from './view-model';

test('marks active playable tournament as canContinue', () => {
  const meta = deriveTournamentViewMeta({
    resultLabel: 'Этап не пройден',
    stage: 'Полуфинал',
    userStatus: 'not_passed',
    deadline: new Date(Date.now() + 60_000).toISOString(),
    roundFinished: false,
  }, 'active');

  assert.equal(meta.resultKind, 'in_progress');
  assert.equal(meta.stageKind, 'semi');
  assert.equal(meta.canContinue, true);
});

test('marks waiting opponent tournament as non-playable', () => {
  const meta = deriveTournamentViewMeta({
    resultLabel: 'Ожидание соперника',
    stage: 'Полуфинал',
    userStatus: 'not_passed',
    deadline: null,
    roundFinished: false,
  }, 'active');

  assert.equal(meta.resultKind, 'waiting_opponent');
  assert.equal(meta.resultTone, 'stage-passed');
  assert.equal(meta.canContinue, false);
});

test('marks timeout label as timeout_defeat', () => {
  const meta = deriveTournamentViewMeta({
    resultLabel: 'Поражение, время истекло',
    stage: 'Полуфинал',
    userStatus: 'not_passed',
    deadline: null,
    roundFinished: true,
  }, 'completed');

  assert.equal(meta.resultKind, 'timeout_defeat');
  assert.equal(meta.resultTone, 'time-expired');
  assert.equal(meta.isTimeoutResult, true);
  assert.equal(meta.isDefeat, true);
});

test('marks final label as final_ready', () => {
  const meta = deriveTournamentViewMeta({
    resultLabel: 'Финал',
    stage: 'Финал',
    userStatus: 'not_passed',
    deadline: null,
    roundFinished: false,
  }, 'active');

  assert.equal(meta.resultKind, 'final_ready');
  assert.equal(meta.stageKind, 'final');
  assert.equal(meta.resultTone, 'final-ready');
});
