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

export interface TournamentMachineViewSeed {
  stageKind: TournamentStageKind;
  resultKind: TournamentResultKind;
  userStatus?: 'passed' | 'not_passed';
  deadline?: string | null;
  roundFinished?: boolean;
}

export interface TournamentLegacyViewSeed {
  resultLabel?: string | null;
  stage?: string | null;
  userStatus?: 'passed' | 'not_passed';
  deadline?: string | null;
  roundFinished?: boolean;
}

export function buildTournamentViewMeta(
  seed: TournamentMachineViewSeed,
  bucket: TournamentListBucket,
): TournamentViewMeta {
  const isVictory = seed.resultKind === 'victory';
  const isTimeoutResult = seed.resultKind === 'timeout_defeat';
  const isDefeat =
    seed.resultKind === 'defeat' || seed.resultKind === 'timeout_defeat';
  const isWaitingOpponent = seed.resultKind === 'waiting_opponent';

  let resultTone: TournamentResultTone = 'stage-not-passed';
  if (seed.resultKind === 'victory') resultTone = 'victory';
  else if (seed.resultKind === 'timeout_defeat') resultTone = 'time-expired';
  else if (seed.resultKind === 'defeat') resultTone = 'defeat';
  else if (seed.resultKind === 'final_ready') resultTone = 'final-ready';
  else if (seed.resultKind === 'tiebreaker') resultTone = 'tiebreaker';
  else if (seed.resultKind === 'waiting_opponent') resultTone = 'stage-passed';

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
    stageKind: seed.stageKind,
    resultKind: seed.resultKind,
    resultTone,
    listBucket: bucket,
    canContinue,
    isWaitingOpponent,
    isTimeoutResult,
    isVictory,
    isDefeat,
  };
}

export function deriveTournamentViewMeta(
  seed: TournamentLegacyViewSeed,
  bucket: TournamentListBucket,
): TournamentViewMeta {
  const label = seed.resultLabel ?? '';
  let resultKind: TournamentResultKind = 'in_progress';
  if (label.startsWith('Победа')) resultKind = 'victory';
  else if (label.toLowerCase().includes('время истекло'))
    resultKind = 'timeout_defeat';
  else if (label.startsWith('Поражение') || label === 'Время истекло')
    resultKind = 'defeat';
  else if (label === 'Финал') resultKind = 'final_ready';
  else if (label === 'Доп. раунд') resultKind = 'tiebreaker';
  else if (label === 'Ожидание соперника') resultKind = 'waiting_opponent';

  return buildTournamentViewMeta(
    {
      stageKind: seed.stage === 'Финал' ? 'final' : 'semi',
      resultKind,
      userStatus: seed.userStatus,
      deadline: seed.deadline,
      roundFinished: seed.roundFinished,
    },
    bucket,
  );
}
