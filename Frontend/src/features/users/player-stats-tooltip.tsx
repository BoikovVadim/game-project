import React from "react";
import axios from "axios";
import { formatNum, CURRENCY } from "../../components/formatNum.ts";
import type { PlayerStats } from "./contracts.ts";

type PlayerStatsTooltipContentProps = {
  displayName: string;
  avatarUrl: string | null;
  stats: PlayerStats;
  fallbackIcon: React.ReactNode;
};

export function usePublicPlayerStatsLoader(token: string) {
  const headers = React.useMemo(
    () => ({ Authorization: `Bearer ${token}` }),
    [token],
  );

  return React.useCallback(
    async (userId: number): Promise<PlayerStats> => {
      const response = await axios.get<PlayerStats>(
        `/users/${userId}/public-stats`,
        { headers },
      );
      return response.data;
    },
    [headers],
  );
}

export function PlayerStatsTooltipContent({
  displayName,
  avatarUrl,
  stats,
  fallbackIcon,
}: PlayerStatsTooltipContentProps) {
  const totalQuestions = stats.totalQuestions ?? 0;
  const correctAnswers = stats.correctAnswers ?? 0;
  const accuracy =
    totalQuestions > 0
      ? `${((correctAnswers / totalQuestions) * 100).toFixed(2)}%`
      : "—";

  return (
    <div className="bracket-player-tooltip-inner">
      <div className="bracket-player-tooltip-avatar">
        {avatarUrl ? <img src={avatarUrl} alt="" /> : fallbackIcon}
      </div>
      <div className="bracket-player-tooltip-stats">
        <div className="bracket-player-tooltip-name">{displayName}</div>
        <div className="bracket-player-tooltip-stat">
          <strong>Лига:</strong> {stats.maxLeagueName ?? "—"}
        </div>
        <div className="bracket-player-tooltip-stat">
          Сыграно раундов: {formatNum(stats.gamesPlayed ?? 0)}
        </div>
        <div className="bracket-player-tooltip-stat">
          Сыгранных матчей: {formatNum(stats.completedMatches ?? 0)}
        </div>
        <div className="bracket-player-tooltip-stat">
          <strong>Сумма выигрыша:</strong> {formatNum(stats.totalWinnings ?? 0)}{" "}
          {CURRENCY}
        </div>
        <div className="bracket-player-tooltip-stat">
          <strong>Выиграно турниров:</strong> {formatNum(stats.wins ?? 0)}
        </div>
        <div className="bracket-player-tooltip-stat">
          <strong>Верных ответов:</strong> {formatNum(correctAnswers)} из{" "}
          {formatNum(totalQuestions)}
        </div>
        <div className="bracket-player-tooltip-stat">
          <strong>% верных ответов:</strong> {accuracy}
        </div>
      </div>
    </div>
  );
}
