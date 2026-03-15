export type ReusableTournamentStatus = 'waiting' | 'active' | 'finished';

export interface ReusableTournamentCandidate {
  id: number;
  playerCount: number;
  hasCurrentUser: boolean;
}

export interface ResumeTournamentCandidate {
  id: number;
  canContinue: boolean;
}

export function isTournamentStructurallyFinishable(playerCount: number): boolean {
  return playerCount >= 4;
}

export function shouldTournamentBeActive(args: {
  status: ReusableTournamentStatus;
  playerCount: number;
  progressCount: number;
}): boolean {
  const { status } = args;
  if (status !== 'waiting') return false;
  return true;
}

export function compareReusableTournamentCandidates(
  left: ReusableTournamentCandidate,
  right: ReusableTournamentCandidate,
): number {
  return left.id - right.id;
}

export function canReuseTournamentCandidate(
  candidate: ReusableTournamentCandidate,
): boolean {
  return !candidate.hasCurrentUser && candidate.playerCount < 4;
}

export function pickReusableTournamentCandidate<
  T extends ReusableTournamentCandidate,
>(candidates: T[]): T | null {
  return (
    candidates
      .filter((candidate) => canReuseTournamentCandidate(candidate))
      .sort(compareReusableTournamentCandidates)[0] ?? null
  );
}

export function pickResumeTournamentId<
  T extends ResumeTournamentCandidate,
>(candidates: T[]): number | null {
  return (
    candidates
      .filter((candidate) => candidate.canContinue)
      .sort((left, right) => left.id - right.id)[0]?.id ?? null
  );
}
