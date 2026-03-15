export type ReusableTournamentStatus = 'waiting' | 'active' | 'finished';

export interface ReusableTournamentCandidate {
  id: number;
  status: ReusableTournamentStatus;
  playerCount: number;
  progressCount: number;
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
