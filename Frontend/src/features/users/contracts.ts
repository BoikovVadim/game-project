export type PlayerStats = {
  gamesPlayed: number;
  completedMatches: number;
  wins: number;
  winRatePercent: number | null;
  correctAnswers: number;
  totalQuestions: number;
  totalWinnings: number;
  totalWithdrawn: number;
  maxLeague: number | null;
  maxLeagueName: string | null;
};
