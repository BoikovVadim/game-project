export type ReusableTournamentStatus = 'waiting' | 'active' | 'finished';

export interface ReusableTournamentCandidate {
  id: number;
  status: ReusableTournamentStatus;
  playerCount: number;
  progressCount: number;
}

export function shouldTournamentBeActive(args: {
  status: ReusableTournamentStatus;
  playerCount: number;
  progressCount: number;
}): boolean {
  const { status, playerCount, progressCount } = args;
  if (status !== 'waiting') return false;
  return playerCount >= 2 || progressCount > 0;
}

export function compareReusableTournamentCandidates(
  left: ReusableTournamentCandidate,
  right: ReusableTournamentCandidate,
): number {
  const leftStatusPriority = left.status === 'active' ? 0 : 1;
  const rightStatusPriority = right.status === 'active' ? 0 : 1;
  if (leftStatusPriority !== rightStatusPriority) {
    return leftStatusPriority - rightStatusPriority;
  }

  if (left.playerCount !== right.playerCount) {
    return right.playerCount - left.playerCount;
  }

  if (left.progressCount !== right.progressCount) {
    return right.progressCount - left.progressCount;
  }

  return left.id - right.id;
}
