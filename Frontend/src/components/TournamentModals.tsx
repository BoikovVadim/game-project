import React from "react";
import axios from "axios";
import { formatNum, CURRENCY } from "./formatNum.ts";
import type {
  BracketPlayerTooltipData,
  BracketViewData,
  OppTooltipState,
  QuestionsReviewData,
} from "../features/tournaments/contracts.ts";
import type { PlayerStats } from "../features/users/contracts.ts";

const DollarIcon = ({ className }: { className?: string }) => (
  <svg
    viewBox="0 0 24 24"
    className={className}
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <circle cx="12" cy="12" r="10" />
    <path d="M12 6v12M15.5 9.5c0-1.4-1.6-2.5-3.5-2.5S8.5 8.1 8.5 9.5 10.1 12 12 12s3.5 1.1 3.5 2.5S13.9 17 12 17s-3.5-1.1-3.5-2.5" />
  </svg>
);

function truncateBracketName(s: string): string {
  if (!s) return "";
  return s.length > 24 ? `${s.slice(0, 24)}...` : s;
}

const BracketPlayerName = ({
  playerId,
  displayName,
  avatarUrl,
  token,
  isTooltipOpen,
  onShowTooltip,
  onCloseTooltip,
}: {
  playerId: number;
  displayName: string;
  avatarUrl: string | null;
  token: string;
  isTooltipOpen: boolean;
  onShowTooltip: (data: BracketPlayerTooltipData) => void;
  onCloseTooltip: () => void;
}) => {
  const elRef = React.useRef<HTMLButtonElement | null>(null);

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isTooltipOpen) {
      onCloseTooltip();
      return;
    }
    const rect = elRef.current?.getBoundingClientRect();
    if (!rect) return;
    axios
      .get<PlayerStats>(`/users/${playerId}/public-stats`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      .then((res) =>
        onShowTooltip({
          playerId,
          displayName,
          avatarUrl,
          stats: res.data,
          rect,
        }),
      )
      .catch(() => {});
  };

  return (
    <button
      type="button"
      ref={elRef}
      className="bracket-player-name bracket-player-name--clickable bracket-player-name-btn"
      onClick={handleClick}
      title={
        isTooltipOpen
          ? "Нажмите, чтобы закрыть"
          : "Нажмите для просмотра статистики"
      }
    >
      {displayName}
    </button>
  );
};

export function TournamentBracketModal(props: {
  variant: "admin" | "player";
  bracketView: BracketViewData | null;
  bracketLoading: boolean;
  bracketError: string;
  token: string;
  onClose: () => void;
  bracketPlayerTooltip: BracketPlayerTooltipData | null;
  setBracketPlayerTooltip: React.Dispatch<
    React.SetStateAction<BracketPlayerTooltipData | null>
  >;
  bracketLeftColRef: React.RefObject<HTMLDivElement | null>;
  bracketFinalBlockRef: React.RefObject<HTMLDivElement | null>;
  bracketBlocksEqualized: boolean;
  currentUserId?: number;
  currentUserAvatar?: string | null;
}) {
  const {
    variant,
    bracketView,
    bracketLoading,
    bracketError,
    token,
    onClose,
    bracketPlayerTooltip,
    setBracketPlayerTooltip,
    bracketLeftColRef,
    bracketFinalBlockRef,
    bracketBlocksEqualized,
    currentUserId,
    currentUserAvatar,
  } = props;

  if (!(bracketView || bracketLoading || bracketError)) return null;

  return (
    <div
      className="bracket-overlay"
      onClick={() => !bracketLoading && onClose()}
    >
      <div
        className="bracket-modal"
        onClick={(e) => {
          e.stopPropagation();
          const t = e.target as HTMLElement;
          if (
            !t.closest(".bracket-player-tooltip") &&
            !t.closest(".bracket-player-name--clickable")
          ) {
            setBracketPlayerTooltip(null);
          }
        }}
      >
        <div className="bracket-modal-header">
          <h3>
            {bracketView?.gameType === "money" ? "Противостояние" : "Турнир"} #
            {bracketView?.tournamentId ?? "..."}
            {bracketView?.status === "finished" || bracketView?.isCompleted ? (
              <span className="bracket-completed-badge">Завершен</span>
            ) : bracketView?.isActive ? (
              <span className="bracket-active-badge">Активен</span>
            ) : null}
          </h3>
          <button
            type="button"
            className="bracket-close"
            onClick={onClose}
            aria-label="Закрыть"
          >
            ×
          </button>
        </div>
        {bracketLoading && !bracketView && (
          <p className="bracket-loading">Загрузка…</p>
        )}
        {bracketError && !bracketLoading && (
          <p className="bracket-error">{bracketError}</p>
        )}
        {bracketPlayerTooltip && (
          <div
            className="bracket-player-tooltip"
            role="button"
            tabIndex={0}
            style={{
              position: "fixed",
              left: Math.min(
                bracketPlayerTooltip.rect.left,
                window.innerWidth - 280,
              ),
              top: bracketPlayerTooltip.rect.bottom + 6,
              zIndex: 1100,
              maxWidth: "calc(100vw - 20px)",
            }}
            onClick={() => setBracketPlayerTooltip(null)}
            onKeyDown={(e) =>
              e.key === "Enter" && setBracketPlayerTooltip(null)
            }
            onMouseEnter={(e) => e.stopPropagation()}
            onMouseLeave={(e) => e.stopPropagation()}
          >
            <div className="bracket-player-tooltip-inner">
              <div className="bracket-player-tooltip-avatar">
                {bracketPlayerTooltip.avatarUrl ? (
                  <img src={bracketPlayerTooltip.avatarUrl} alt="" />
                ) : (
                  <DollarIcon />
                )}
              </div>
              <div className="bracket-player-tooltip-stats">
                <div className="bracket-player-tooltip-name">
                  {bracketPlayerTooltip.displayName}
                </div>
                <div className="bracket-player-tooltip-stat">
                  <strong>Лига:</strong>{" "}
                  {bracketPlayerTooltip.stats.maxLeagueName ?? "—"}
                </div>
                <div className="bracket-player-tooltip-stat">
                  Сыграно раундов:{" "}
                  {formatNum(bracketPlayerTooltip.stats.gamesPlayed ?? 0)}
                </div>
                <div className="bracket-player-tooltip-stat">
                  Сыгранных матчей:{" "}
                  {formatNum(bracketPlayerTooltip.stats.completedMatches ?? 0)}
                </div>
                <div className="bracket-player-tooltip-stat">
                  <strong>Сумма выигрыша:</strong>{" "}
                  {formatNum(bracketPlayerTooltip.stats.totalWinnings ?? 0)}{" "}
                  {CURRENCY}
                </div>
                <div className="bracket-player-tooltip-stat">
                  <strong>Выиграно турниров:</strong>{" "}
                  {formatNum(bracketPlayerTooltip.stats.wins ?? 0)}
                </div>
                <div className="bracket-player-tooltip-stat">
                  <strong>Верных ответов:</strong>{" "}
                  {formatNum(bracketPlayerTooltip.stats.correctAnswers ?? 0)} из{" "}
                  {formatNum(bracketPlayerTooltip.stats.totalQuestions ?? 0)}
                </div>
                <div className="bracket-player-tooltip-stat">
                  <strong>% верных ответов:</strong>{" "}
                  {(bracketPlayerTooltip.stats.totalQuestions ?? 0) > 0
                    ? `${(((bracketPlayerTooltip.stats.correctAnswers ?? 0) / (bracketPlayerTooltip.stats.totalQuestions ?? 1)) * 100).toFixed(2)}%`
                    : "—"}
                </div>
              </div>
            </div>
          </div>
        )}
        {bracketView && (
          <div
            className={`bracket-grid ${variant === "admin" ? "bracket-grid--admin " : ""}${bracketBlocksEqualized ? "bracket-blocks-equalized" : ""}`}
          >
            <div className="bracket-left-col" ref={bracketLeftColRef}>
              {[bracketView.semi1, bracketView.semi2].map((semi, semiIdx) => (
                <div
                  key={semiIdx}
                  className={`bracket-semi-block bracket-semi-${semiIdx + 1}`}
                >
                  <h4>Полуфинал</h4>
                  <div className="bracket-match">
                    {[0, 1].map((i) => {
                      const p = semi?.players[i];
                      const opp = semi?.players[1 - i];
                      const isReal = p != null && p.id > 0;
                      const isWinner =
                        isReal && !p.isLoser && opp?.isLoser === true;
                      const displayName = truncateBracketName(
                        isReal
                          ? p.nickname?.trim() || `Игрок ${p.id}`
                          : "Ожидание соперника",
                      );
                      const pAvatar =
                        isReal && p.id === currentUserId
                          ? (currentUserAvatar ?? null)
                          : isReal
                            ? (p.avatarUrl ?? null)
                            : null;
                      const answered = Math.max(0, p?.questionsAnswered ?? 0);
                      const correct = Math.max(
                        0,
                        p?.semiScore ?? p?.correctAnswersCount ?? 0,
                      );
                      return (
                        <div
                          key={isReal ? p.id : `s${semiIdx + 1}-${i}`}
                          className={`bracket-player-slot ${!isReal ? "bracket-slot-empty" : ""} ${isReal && p.isLoser ? "bracket-slot-loser" : ""}`}
                        >
                          <span className="bracket-player-info">
                            {isReal && (
                              <span className="bracket-player-avatar">
                                {pAvatar ? (
                                  <img src={pAvatar} alt="" />
                                ) : (
                                  <DollarIcon />
                                )}
                              </span>
                            )}
                            {isWinner && (
                              <span className="bracket-winner-label">
                                Победитель
                              </span>
                            )}
                            {isReal ? (
                              <BracketPlayerName
                                playerId={p.id}
                                displayName={displayName}
                                avatarUrl={pAvatar}
                                token={token}
                                isTooltipOpen={
                                  bracketPlayerTooltip?.playerId === p.id
                                }
                                onShowTooltip={setBracketPlayerTooltip}
                                onCloseTooltip={() =>
                                  setBracketPlayerTooltip(null)
                                }
                              />
                            ) : (
                              <span className="bracket-player-name">
                                {displayName}
                              </span>
                            )}
                            {isReal && answered > 0 && (
                              <span className="bracket-player-score">
                                {correct}/{answered} (
                                {Math.round((correct / answered) * 100)}%)
                              </span>
                            )}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
            <div className="bracket-connector">
              <svg
                viewBox="0 0 256 220"
                preserveAspectRatio="none"
                className="bracket-lines"
              >
                <path
                  d="M 0 51 L 178 51 L 178 110 L 256 110"
                  fill="none"
                  stroke="#888"
                  strokeWidth="2"
                />
                <path
                  d="M 0 169 L 178 169 L 178 110"
                  fill="none"
                  stroke="#888"
                  strokeWidth="2"
                />
              </svg>
            </div>
            <div className="bracket-final-block" ref={bracketFinalBlockRef}>
              <h4>Финал</h4>
              <div className="bracket-match">
                {(() => {
                  const fp = bracketView.final.players;
                  const finalWinnerId = bracketView.finalWinnerId ?? null;
                  const bothFinished = finalWinnerId != null;
                  return [0, 1].map((i) => {
                    const p = fp[i];
                    const isReal = p != null && p.id > 0;
                    const isWinner = isReal && finalWinnerId === p.id;
                    const isLoser =
                      bothFinished &&
                      isReal &&
                      finalWinnerId != null &&
                      finalWinnerId !== p.id;
                    const displayName = truncateBracketName(
                      isReal
                        ? p.nickname?.trim() || `Игрок ${p.id}`
                        : "Ожидание соперника",
                    );
                    const finalAnswered = Math.max(0, p?.finalAnswered ?? 0);
                    const finalCorrect = Math.max(
                      0,
                      p?.finalScore ?? p?.finalCorrect ?? 0,
                    );
                    const total = finalAnswered;
                    const correct = finalCorrect;
                    const pAvatar =
                      isReal && p.id === currentUserId
                        ? (currentUserAvatar ?? null)
                        : isReal
                          ? (p.avatarUrl ?? null)
                          : null;
                    return (
                      <div
                        key={isReal ? p.id : `f-${i}`}
                        className={`bracket-player-slot ${!isReal ? "bracket-slot-empty" : ""} ${isLoser ? "bracket-slot-loser" : ""}`}
                      >
                        <span className="bracket-player-info">
                          {isReal && (
                            <span className="bracket-player-avatar">
                              {pAvatar ? (
                                <img src={pAvatar} alt="" />
                              ) : (
                                <DollarIcon />
                              )}
                            </span>
                          )}
                          {isWinner && (
                            <span className="bracket-winner-label">
                              Победитель
                            </span>
                          )}
                          {isReal ? (
                            <BracketPlayerName
                              playerId={p.id}
                              displayName={displayName}
                              avatarUrl={pAvatar}
                              token={token}
                              isTooltipOpen={
                                bracketPlayerTooltip?.playerId === p.id
                              }
                              onShowTooltip={setBracketPlayerTooltip}
                              onCloseTooltip={() =>
                                setBracketPlayerTooltip(null)
                              }
                            />
                          ) : (
                            <span className="bracket-player-name">
                              {displayName}
                            </span>
                          )}
                          {isReal && (
                            <span className="bracket-player-score">
                              {total > 0
                                ? `${correct}/${total} (${Math.round((correct / total) * 100)}%)`
                                : "0/0"}
                            </span>
                          )}
                        </span>
                      </div>
                    );
                  });
                })()}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export function TournamentQuestionsModal(props: {
  variant: "admin" | "player";
  questionsReviewTournamentId: number | null;
  questionsReviewLoading: boolean;
  questionsReviewError: string;
  questionsReviewData: QuestionsReviewData | null;
  closeQuestionsReview: () => void;
  questionsReviewRound: "semi" | "final";
  questionsReviewTabIdx: number;
  setQuestionsReviewTabIdx: React.Dispatch<React.SetStateAction<number>>;
  loadOppStats: (userId: number, avatarUrl?: string | null) => void;
  oppTooltip: OppTooltipState;
  setOppTooltip: React.Dispatch<React.SetStateAction<OppTooltipState>>;
}) {
  const {
    variant,
    questionsReviewTournamentId,
    questionsReviewLoading,
    questionsReviewError,
    questionsReviewData,
    closeQuestionsReview,
    questionsReviewRound,
    questionsReviewTabIdx,
    setQuestionsReviewTabIdx,
    loadOppStats,
    oppTooltip,
    setOppTooltip,
  } = props;

  if (questionsReviewTournamentId == null) return null;

  return (
    <div className="questions-review-overlay" onClick={closeQuestionsReview}>
      <div
        className={`questions-review-modal questions-review-modal--${variant}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="questions-review-header">
          <h3>Вопросы турнира #{questionsReviewTournamentId}</h3>
          <button
            type="button"
            className="questions-review-close"
            onClick={closeQuestionsReview}
            aria-label="Закрыть"
          >
            ×
          </button>
        </div>
        {questionsReviewLoading && !questionsReviewData && (
          <p className="questions-review-loading">Загрузка…</p>
        )}
        {questionsReviewError && !questionsReviewLoading && (
          <p className="questions-review-error">{questionsReviewError}</p>
        )}
        {questionsReviewData &&
          (() => {
            const raw =
              questionsReviewData.answersChosen ??
              (questionsReviewData as { answers_chosen?: number[] })
                .answers_chosen;
            const ac = Array.isArray(raw)
              ? raw.map((a: unknown) => {
                  const n =
                    typeof a === "number" && !Number.isNaN(a)
                      ? a
                      : typeof a === "string"
                        ? Number(a)
                        : NaN;
                  if (typeof n !== "number" || Number.isNaN(n)) return -1;
                  return n < 0 ? -1 : Math.floor(n);
                })
              : [];
            const oppRounds = questionsReviewData.opponentAnswersByRound ?? [];
            const oppInfoRounds = questionsReviewData.opponentInfoByRound ?? [];
            const userSemiIdx = questionsReviewData.userSemiIndex ?? 0;
            const n = questionsReviewData.questionsAnsweredCount;
            const semiQuestions =
              userSemiIdx === 0
                ? questionsReviewData.questionsSemi1
                : questionsReviewData.questionsSemi2;
            const semiCorrect =
              questionsReviewData.semiFinalCorrectCount ??
              (n <= 10 ? questionsReviewData.correctAnswersCount : 0);
            const semiTBAll =
              questionsReviewData.semiTiebreakerAllQuestions ?? [];
            const semiTBCorrects =
              questionsReviewData.semiTiebreakerRoundsCorrect ?? [];
            const finalQuestions = questionsReviewData.questionsFinal ?? [];
            const finalTBAll =
              questionsReviewData.finalTiebreakerAllQuestions ?? [];
            const finalTBCorrects =
              questionsReviewData.finalTiebreakerRoundsCorrect ?? [];
            const semiTBSum = semiTBCorrects.reduce(
              (a: number, b: number) => a + b,
              0,
            );
            const finalTBSum = finalTBCorrects.reduce(
              (a: number, b: number) => a + b,
              0,
            );
            const completedSemiTBCount = semiTBCorrects.length;
            const hasFinalStarted =
              finalQuestions.length > 0 && n > 10 + completedSemiTBCount * 10;
            const visibleSemiTBCount = hasFinalStarted
              ? Math.min(semiTBAll.length, completedSemiTBCount)
              : Math.min(
                  semiTBAll.length,
                  Math.max(
                    completedSemiTBCount,
                    Math.ceil(Math.max(0, n - 10) / 10),
                  ),
                );

            type ReviewTab = {
              label: string;
              questions: typeof semiQuestions;
              startIdx: number;
              correctCount: number;
              oppRoundIdx: number;
            };
            const tabs: ReviewTab[] = [];
            let oppIdx = 0;

            tabs.push({
              label: "Полуфинал",
              questions: semiQuestions,
              startIdx: 0,
              correctCount: semiCorrect,
              oppRoundIdx: oppIdx++,
            });

            let cursor = 10;
            for (let r = 0; r < visibleSemiTBCount; r++) {
              if (n <= cursor) break;
              tabs.push({
                label:
                  semiTBAll.length === 1
                    ? "Доп. раунд (ПФ)"
                    : `Доп. раунд ${r + 1} (ПФ)`,
                questions: semiTBAll[r],
                startIdx: cursor,
                correctCount: semiTBCorrects[r] ?? 0,
                oppRoundIdx: oppIdx++,
              });
              cursor += 10;
            }

            if (finalQuestions.length > 0 && n > cursor) {
              const finalBaseCorrect = Math.max(
                0,
                questionsReviewData.correctAnswersCount -
                  semiCorrect -
                  semiTBSum -
                  finalTBSum,
              );
              tabs.push({
                label: "Финал",
                questions: finalQuestions,
                startIdx: cursor,
                correctCount: finalBaseCorrect,
                oppRoundIdx: oppIdx++,
              });
              cursor += 10;
              const visibleFinalTBCount = Math.min(
                finalTBAll.length,
                Math.max(
                  finalTBCorrects.length,
                  Math.ceil(Math.max(0, n - cursor) / 10),
                ),
              );

              for (let r = 0; r < visibleFinalTBCount; r++) {
                if (n <= cursor) break;
                tabs.push({
                  label:
                    finalTBAll.length === 1
                      ? "Доп. раунд (Ф)"
                      : `Доп. раунд ${r + 1} (Ф)`,
                  questions: finalTBAll[r],
                  startIdx: cursor,
                  correctCount: finalTBCorrects[r] ?? 0,
                  oppRoundIdx: oppIdx++,
                });
                cursor += 10;
              }
            }

            const preferredTabIdx =
              questionsReviewRound === "final"
                ? Math.max(
                    0,
                    tabs.findIndex(
                      (tab) =>
                        tab.label === "Финал" || tab.label.includes("(Ф)"),
                    ),
                  )
                : 0;
            const resolvedTabIdx =
              questionsReviewTabIdx >= 0 && questionsReviewTabIdx < tabs.length
                ? questionsReviewTabIdx
                : preferredTabIdx;
            const activeTab = tabs[resolvedTabIdx] ?? tabs[0];
            if (!activeTab) return null;
            const answeredInRound = Math.min(
              activeTab.questions.length,
              Math.max(0, n - activeTab.startIdx),
            );
            const questionsToShow = activeTab.questions.slice(
              0,
              answeredInRound,
            );
            const oppAC = oppRounds[activeTab.oppRoundIdx] ?? [];
            const oppInfo = oppInfoRounds[activeTab.oppRoundIdx] ?? null;
            const myAnswerTitle =
              variant === "player" ? "Мой ответ" : "Ответ игрока";
            const noAnswersText =
              variant === "player"
                ? "Вы не ответили ни на один вопрос в этом раунде."
                : "Игрок не ответил ни на один вопрос в этом раунде.";

            return (
              <>
                <div className="qr-legend">
                  <span className="qr-legend-item">
                    <span className="qr-check qr-check--correct">✓</span>{" "}
                    Правильный ответ
                  </span>
                  <span className="qr-legend-item">
                    <span className="qr-check qr-check--mine">✓</span>{" "}
                    {myAnswerTitle}
                  </span>
                  <span className="qr-legend-item">
                    <span className="qr-check qr-check--opp">✓</span> Ответ
                    соперника
                  </span>
                  <span className="qr-legend-item">
                    <span className="qr-cross">✗</span> Нет ответа
                  </span>
                </div>
                {tabs.length > 1 && (
                  <div className="questions-review-tabs">
                    {tabs.map((tab, ti) => (
                      <button
                        key={ti}
                        type="button"
                        className={`questions-review-tab ${ti === resolvedTabIdx ? "active" : ""}`}
                        onClick={() => setQuestionsReviewTabIdx(ti)}
                      >
                        {tab.label}
                      </button>
                    ))}
                  </div>
                )}
                <div className="questions-review-body">
                  {oppInfo && oppInfo.id > 0 && (
                    <p className="qr-opponent-line">
                      Соперник:{" "}
                      <span className="qr-opponent-name-wrap">
                        <button
                          type="button"
                          className="qr-opponent-link"
                          onClick={() =>
                            loadOppStats(oppInfo.id, oppInfo.avatarUrl)
                          }
                        >
                          {oppInfo.nickname}
                        </button>
                        {oppTooltip.visible && (
                          <div
                            className="bracket-player-tooltip qr-opponent-tooltip"
                            onClick={() =>
                              setOppTooltip((p) => ({ ...p, visible: false }))
                            }
                            role="button"
                            tabIndex={0}
                            onKeyDown={(e) =>
                              e.key === "Enter" &&
                              setOppTooltip((p) => ({ ...p, visible: false }))
                            }
                          >
                            {oppTooltip.loading ? (
                              <div className="bracket-player-tooltip-inner">
                                <span className="qr-opponent-tooltip-loading">
                                  Загрузка…
                                </span>
                              </div>
                            ) : oppTooltip.data ? (
                              <div className="bracket-player-tooltip-inner">
                                <div className="bracket-player-tooltip-avatar">
                                  {oppTooltip.avatarUrl ? (
                                    <img src={oppTooltip.avatarUrl} alt="" />
                                  ) : (
                                    <DollarIcon />
                                  )}
                                </div>
                                <div className="bracket-player-tooltip-stats">
                                  <div className="bracket-player-tooltip-name">
                                    {oppInfo.nickname}
                                  </div>
                                  <div className="bracket-player-tooltip-stat">
                                    <strong>Лига:</strong>{" "}
                                    {oppTooltip.data.maxLeagueName ?? "—"}
                                  </div>
                                  <div className="bracket-player-tooltip-stat">
                                    Сыграно раундов:{" "}
                                    {formatNum(
                                      oppTooltip.data.gamesPlayed ?? 0,
                                    )}
                                  </div>
                                  <div className="bracket-player-tooltip-stat">
                                    Сыгранных матчей:{" "}
                                    {formatNum(
                                      oppTooltip.data.completedMatches ?? 0,
                                    )}
                                  </div>
                                  <div className="bracket-player-tooltip-stat">
                                    <strong>Сумма выигрыша:</strong>{" "}
                                    {formatNum(
                                      oppTooltip.data.totalWinnings ?? 0,
                                    )}{" "}
                                    {CURRENCY}
                                  </div>
                                  <div className="bracket-player-tooltip-stat">
                                    <strong>Выиграно турниров:</strong>{" "}
                                    {formatNum(oppTooltip.data.wins ?? 0)}
                                  </div>
                                  <div className="bracket-player-tooltip-stat">
                                    <strong>Верных ответов:</strong>{" "}
                                    {formatNum(
                                      oppTooltip.data.correctAnswers ?? 0,
                                    )}{" "}
                                    из{" "}
                                    {formatNum(
                                      oppTooltip.data.totalQuestions ?? 0,
                                    )}
                                  </div>
                                  <div className="bracket-player-tooltip-stat">
                                    <strong>% верных ответов:</strong>{" "}
                                    {(oppTooltip.data.totalQuestions ?? 0) > 0
                                      ? `${(((oppTooltip.data.correctAnswers ?? 0) / (oppTooltip.data.totalQuestions ?? 1)) * 100).toFixed(2)}%`
                                      : "—"}
                                  </div>
                                </div>
                              </div>
                            ) : (
                              <div className="bracket-player-tooltip-inner">
                                <span className="qr-opponent-tooltip-loading">
                                  Нет данных
                                </span>
                              </div>
                            )}
                          </div>
                        )}
                      </span>
                    </p>
                  )}
                  <p className="questions-review-stats">
                    {activeTab.label}: верно{" "}
                    <strong>{activeTab.correctCount}</strong> из{" "}
                    <strong>{answeredInRound}</strong> вопросов
                    {answeredInRound < activeTab.questions.length
                      ? ` (отвечено ${answeredInRound} из ${activeTab.questions.length})`
                      : ""}
                    .
                  </p>
                  {questionsToShow.length === 0 ? (
                    <p className="questions-review-empty">{noAnswersText}</p>
                  ) : (
                    <div className="questions-review-round">
                      <h4>{activeTab.label}</h4>
                      {questionsToShow.map((q, idx) => {
                        const rawChoice = ac[activeTab.startIdx + idx];
                        const playerChoice =
                          typeof rawChoice === "number" &&
                          !Number.isNaN(rawChoice) &&
                          rawChoice >= 0 &&
                          rawChoice < (q.options?.length ?? 0)
                            ? rawChoice
                            : -1;
                        const oppRaw = oppAC[idx];
                        const oppChoice =
                          typeof oppRaw === "number" &&
                          !Number.isNaN(oppRaw) &&
                          oppRaw >= 0 &&
                          oppRaw < (q.options?.length ?? 0)
                            ? oppRaw
                            : -1;
                        const correctIdx = Number(q.correctAnswer);
                        const noMyAnswer = playerChoice === -1;
                        const noOppAnswer = oppChoice === -1;
                        return (
                          <div
                            key={q.id ?? idx}
                            className="questions-review-question"
                          >
                            <p className="questions-review-question-text">
                              <span className="questions-review-question-id">
                                ID: {q.id ?? "—"}
                              </span>{" "}
                              {idx + 1}. {q.question}
                            </p>
                            <table className="qr-table">
                              <thead>
                                <tr>
                                  <th>Ответ</th>
                                  <th
                                    className="qr-th-icon qr-th-correct"
                                    title="Правильный ответ"
                                  >
                                    ✓
                                  </th>
                                  <th
                                    className="qr-th-icon qr-th-mine"
                                    title={myAnswerTitle}
                                  >
                                    {noMyAnswer ? (
                                      <span className="qr-cross">✗</span>
                                    ) : (
                                      "✓"
                                    )}
                                  </th>
                                  <th
                                    className="qr-th-icon qr-th-opp"
                                    title="Ответ соперника"
                                  >
                                    {noOppAnswer ? (
                                      <span className="qr-cross">✗</span>
                                    ) : (
                                      "✓"
                                    )}
                                  </th>
                                </tr>
                              </thead>
                              <tbody>
                                {q.options.map((opt, oi) => (
                                  <tr key={oi}>
                                    <td className="qr-td-text">{opt}</td>
                                    <td className="qr-td-icon">
                                      {oi === correctIdx && (
                                        <span className="qr-check qr-check--correct">
                                          ✓
                                        </span>
                                      )}
                                    </td>
                                    <td className="qr-td-icon">
                                      {oi === playerChoice && (
                                        <span className="qr-check qr-check--mine">
                                          ✓
                                        </span>
                                      )}
                                    </td>
                                    <td className="qr-td-icon">
                                      {oi === oppChoice && (
                                        <span className="qr-check qr-check--opp">
                                          ✓
                                        </span>
                                      )}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </>
            );
          })()}
      </div>
    </div>
  );
}
