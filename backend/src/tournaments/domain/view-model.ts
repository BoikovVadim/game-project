export type TournamentStageKind = 'semi' | 'final';
export type TournamentResultKind =
  | 'victory'
  | 'defeat'
  | 'timeout_defeat'
  | 'waiting_opponent'
  | 'final_ready'
  | 'tiebreaker'
  | 'in_progress';
export type TournamentResultTone =
  | 'victory'
  | 'defeat'
  | 'time-expired'
  | 'stage-passed'
  | 'final-ready'
  | 'tiebreaker'
  | 'stage-not-passed';
export type TournamentListBucket = 'active' | 'completed';

export interface TournamentViewMeta {
  stageKind: TournamentStageKind;
  resultKind: TournamentResultKind;
  resultTone: TournamentResultTone;
  listBucket: TournamentListBucket;
  canContinue: boolean;
  isWaitingOpponent: boolean;
  isTimeoutResult: boolean;
  isVictory: boolean;
  isDefeat: boolean;
}

export interface TournamentViewSeed {
  resultLabel?: string | null;
  stage?: string | null;
  userStatus?: 'passed' | 'not_passed';
  deadline?: string | null;
  roundFinished?: boolean;
}

export function deriveTournamentViewMeta(seed: TournamentViewSeed, bucket: TournamentListBucket): TournamentViewMeta {
  const label = seed.resultLabel ?? '';
  const stageKind: TournamentStageKind = seed.stage === 'Финал' ? 'final' : 'semi';
  const isVictory = label.startsWith('Победа');
  const isTimeoutResult = label.toLowerCase().includes('время истекло');
  const isDefeat = label.startsWith('Поражение') || label === 'Время истекло' || isTimeoutResult;
  const isWaitingOpponent = label === 'Ожидание соперника';

  let resultKind: TournamentResultKind = 'in_progress';
  if (isVictory) resultKind = 'victory';
  else if (isTimeoutResult) resultKind = 'timeout_defeat';
  else if (isDefeat) resultKind = 'defeat';
  else if (label === 'Финал') resultKind = 'final_ready';
  else if (label === 'Доп. раунд') resultKind = 'tiebreaker';
  else if (isWaitingOpponent) resultKind = 'waiting_opponent';

  let resultTone: TournamentResultTone = 'stage-not-passed';
  if (resultKind === 'victory') resultTone = 'victory';
  else if (resultKind === 'timeout_defeat') resultTone = 'time-expired';
  else if (resultKind === 'defeat') resultTone = 'defeat';
  else if (resultKind === 'final_ready') resultTone = 'final-ready';
  else if (resultKind === 'tiebreaker') resultTone = 'tiebreaker';
  else if (resultKind === 'waiting_opponent') resultTone = 'stage-passed';

  const deadlineOpen = !!seed.deadline && new Date(seed.deadline) > new Date();
  const canContinue =
    bucket === 'active' &&
    seed.userStatus === 'not_passed' &&
    !isWaitingOpponent &&
    !isDefeat &&
    !isTimeoutResult &&
    (!seed.deadline || deadlineOpen) &&
    !seed.roundFinished;

  return {
    stageKind,
    resultKind,
    resultTone,
    listBucket: bucket,
    canContinue,
    isWaitingOpponent,
    isTimeoutResult,
    isVictory,
    isDefeat,
  };
}
