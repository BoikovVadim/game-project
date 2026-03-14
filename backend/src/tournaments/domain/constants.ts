export const QUESTIONS_PER_ROUND = 10;
export const TIEBREAKER_QUESTIONS = 10;

export const LEAGUE_MIN_BALANCE_MULTIPLIER = 10;
export const LEAGUE_WINS_TO_UNLOCK = 10;

export const LEAGUE_AMOUNTS: number[] = (() => {
  const base = [5, 10, 20, 50];
  const seen = new Set<number>();
  const result: number[] = [];
  let mult = 1;
  while (mult <= 1_000_000) {
    for (const amount of base) {
      const value = amount * mult;
      if (value <= 1_000_000 && !seen.has(value)) {
        seen.add(value);
        result.push(value);
      }
    }
    mult *= 10;
  }
  return result.sort((a, b) => a - b);
})();

export const LEAGUE_NAMES: Record<number, string> = {
  5: 'Янтарная лига',
  10: 'Коралловая лига',
  20: 'Нефритовая лига',
  50: 'Агатовая лига',
  100: 'Аметистовая лига',
  200: 'Топазовая лига',
  500: 'Гранатовая лига',
  1000: 'Изумрудовая лига',
  2000: 'Рубиновая лига',
  5000: 'Сапфировая лига',
  10000: 'Опаловая лига',
  20000: 'Жемчужная лига',
  50000: 'Александритовая лига',
  100000: 'Бриллиантовая лига',
  200000: 'Лазуритовая лига',
  500000: 'Лига чёрного опала',
  1000000: 'Алмазная лига',
};

export function getLeagueName(amount: number | null | undefined): string {
  if (amount == null) return 'Лига';
  return LEAGUE_NAMES[amount] ?? `Лига ${amount} L`;
}

export function getTournamentDisplayName(tournament: { gameType?: string | null; leagueAmount?: number | null }): string {
  if (tournament.gameType === 'money' && tournament.leagueAmount != null) {
    return getLeagueName(tournament.leagueAmount);
  }
  if (tournament.gameType === 'training') return 'Тренировка';
  if (tournament.leagueAmount != null) return getLeagueName(tournament.leagueAmount);
  return 'Турнир';
}

export function getLeaguePrize(stake: number): number {
  return Math.round(3.4 * stake);
}

export function getMinBalanceForLeague(leagueIndex: number, amount: number): number {
  return leagueIndex === 0 ? amount : amount * LEAGUE_MIN_BALANCE_MULTIPLIER;
}
