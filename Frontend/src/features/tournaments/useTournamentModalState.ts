import React from "react";
import type { SetURLSearchParams } from "react-router-dom";
import type { BracketViewData, QuestionsReviewData } from "./contracts.ts";

type ModalSource = "active" | "completed";
type ReviewRound = "semi" | "final";

type BracketModalParams = {
  tournamentId: number;
  source?: ModalSource;
  viewerUserId?: number | null;
};

type QuestionsModalParams = {
  tournamentId: number;
  round: ReviewRound;
  viewerUserId?: number | null;
};

type BracketHookOptions = {
  searchParams: URLSearchParams;
  setSearchParams: SetURLSearchParams;
  tournamentKey: string;
  sourceKey?: string;
  viewerUserKey?: string;
  loadBracket: (params: BracketModalParams) => Promise<BracketViewData>;
};

type QuestionsHookOptions = {
  searchParams: URLSearchParams;
  setSearchParams: SetURLSearchParams;
  tournamentKey: string;
  roundKey: string;
  viewerUserKey?: string;
  loadQuestions: (params: QuestionsModalParams) => Promise<QuestionsReviewData>;
};

function parsePositiveInt(raw: string | null): number | null {
  if (!raw || !/^\d+$/.test(raw)) return null;
  const value = Number(raw);
  return value > 0 ? value : null;
}

function formatUnknownError(
  error: unknown,
  fallback: string,
): string {
  if (
    error &&
    typeof error === "object" &&
    "response" in error &&
    (error as { response?: { data?: { message?: string | string[] } } }).response
  ) {
    const msg = (error as { response?: { data?: { message?: string | string[] } } })
      .response?.data?.message;
    if (Array.isArray(msg)) return msg[0] ?? fallback;
    if (typeof msg === "string" && msg.trim()) return msg;
  }
  if (error instanceof Error && error.message.trim()) return error.message;
  return fallback;
}

export function useTournamentBracketModalState({
  searchParams,
  setSearchParams,
  tournamentKey,
  sourceKey,
  viewerUserKey,
  loadBracket,
}: BracketHookOptions) {
  const [bracketView, setBracketView] = React.useState<BracketViewData | null>(null);
  const [bracketLoading, setBracketLoading] = React.useState(false);
  const [bracketError, setBracketError] = React.useState("");
  const activeKeyRef = React.useRef<string | null>(null);
  const requestIdRef = React.useRef(0);

  const openBracket = React.useCallback(
    (tournamentId: number, source?: ModalSource, viewerUserId?: number | null) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.set(tournamentKey, String(tournamentId));
          if (sourceKey) {
            if (source) next.set(sourceKey, source);
            else next.delete(sourceKey);
          }
          if (viewerUserKey) {
            if (viewerUserId != null) next.set(viewerUserKey, String(viewerUserId));
            else next.delete(viewerUserKey);
          }
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams, sourceKey, tournamentKey, viewerUserKey],
  );

  const closeBracket = React.useCallback(() => {
    activeKeyRef.current = null;
    setBracketView(null);
    setBracketError("");
    setBracketLoading(false);
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete(tournamentKey);
        if (sourceKey) next.delete(sourceKey);
        if (viewerUserKey) next.delete(viewerUserKey);
        return next;
      },
      { replace: true },
    );
  }, [setSearchParams, sourceKey, tournamentKey, viewerUserKey]);

  React.useEffect(() => {
    const tournamentId = parsePositiveInt(searchParams.get(tournamentKey));
    const viewerUserId = viewerUserKey
      ? parsePositiveInt(searchParams.get(viewerUserKey))
      : null;
    const sourceRaw = sourceKey ? searchParams.get(sourceKey) : null;
    const source: ModalSource | undefined =
      sourceRaw === "active" || sourceRaw === "completed" ? sourceRaw : undefined;
    if (!tournamentId || (viewerUserKey && !viewerUserId)) {
      activeKeyRef.current = null;
      setBracketView(null);
      setBracketError("");
      setBracketLoading(false);
      return;
    }

    const nextKey = `${tournamentId}:${source ?? ""}:${viewerUserId ?? ""}`;
    if (activeKeyRef.current === nextKey) return;
    activeKeyRef.current = nextKey;
    const requestId = ++requestIdRef.current;
    setBracketLoading(true);
    setBracketError("");
    loadBracket({ tournamentId, source, viewerUserId })
      .then((data) => {
        if (requestIdRef.current !== requestId) return;
        setBracketView(data);
      })
      .catch((error: unknown) => {
        if (requestIdRef.current !== requestId) return;
        setBracketView(null);
        setBracketError(formatUnknownError(error, "Не удалось загрузить сетку"));
      })
      .finally(() => {
        if (requestIdRef.current !== requestId) return;
        setBracketLoading(false);
      });
  }, [loadBracket, searchParams, sourceKey, tournamentKey, viewerUserKey]);

  return {
    bracketView,
    bracketLoading,
    bracketError,
    openBracket,
    closeBracket,
  };
}

export function useTournamentQuestionsModalState({
  searchParams,
  setSearchParams,
  tournamentKey,
  roundKey,
  viewerUserKey,
  loadQuestions,
}: QuestionsHookOptions) {
  const [questionsReviewTournamentId, setQuestionsReviewTournamentId] =
    React.useState<number | null>(null);
  const [questionsReviewRound, setQuestionsReviewRound] =
    React.useState<ReviewRound>("semi");
  const [questionsReviewTabIdx, setQuestionsReviewTabIdx] = React.useState(-1);
  const [questionsReviewData, setQuestionsReviewData] =
    React.useState<QuestionsReviewData | null>(null);
  const [questionsReviewLoading, setQuestionsReviewLoading] = React.useState(false);
  const [questionsReviewError, setQuestionsReviewError] = React.useState("");
  const activeKeyRef = React.useRef<string | null>(null);
  const requestIdRef = React.useRef(0);

  const openQuestionsReview = React.useCallback(
    (
      tournamentId: number,
      round: ReviewRound,
      viewerUserId?: number | null,
    ) => {
      setQuestionsReviewRound(round);
      setQuestionsReviewTabIdx(-1);
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.set(tournamentKey, String(tournamentId));
          next.set(roundKey, round);
          if (viewerUserKey) {
            if (viewerUserId != null) next.set(viewerUserKey, String(viewerUserId));
            else next.delete(viewerUserKey);
          }
          return next;
        },
        { replace: true },
      );
    },
    [roundKey, setSearchParams, tournamentKey, viewerUserKey],
  );

  const closeQuestionsReview = React.useCallback(() => {
    activeKeyRef.current = null;
    setQuestionsReviewTournamentId(null);
    setQuestionsReviewRound("semi");
    setQuestionsReviewTabIdx(0);
    setQuestionsReviewData(null);
    setQuestionsReviewLoading(false);
    setQuestionsReviewError("");
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete(tournamentKey);
        next.delete(roundKey);
        if (viewerUserKey) next.delete(viewerUserKey);
        return next;
      },
      { replace: true },
    );
  }, [roundKey, setSearchParams, tournamentKey, viewerUserKey]);

  React.useEffect(() => {
    const tournamentId = parsePositiveInt(searchParams.get(tournamentKey));
    const round = searchParams.get(roundKey) === "final" ? "final" : "semi";
    const viewerUserId = viewerUserKey
      ? parsePositiveInt(searchParams.get(viewerUserKey))
      : null;
    setQuestionsReviewRound(round);
    if (!tournamentId || (viewerUserKey && !viewerUserId)) {
      activeKeyRef.current = null;
      setQuestionsReviewTournamentId(null);
      setQuestionsReviewData(null);
      setQuestionsReviewLoading(false);
      setQuestionsReviewError("");
      return;
    }

    const nextKey = `${tournamentId}:${round}:${viewerUserId ?? ""}`;
    if (activeKeyRef.current === nextKey) return;
    activeKeyRef.current = nextKey;
    const requestId = ++requestIdRef.current;
    setQuestionsReviewTournamentId(tournamentId);
    setQuestionsReviewTabIdx(-1);
    setQuestionsReviewData(null);
    setQuestionsReviewError("");
    setQuestionsReviewLoading(true);
    loadQuestions({ tournamentId, round, viewerUserId })
      .then((data) => {
        if (requestIdRef.current !== requestId) return;
        setQuestionsReviewData(data);
      })
      .catch((error: unknown) => {
        if (requestIdRef.current !== requestId) return;
        setQuestionsReviewError(
          formatUnknownError(error, "Не удалось загрузить вопросы"),
        );
      })
      .finally(() => {
        if (requestIdRef.current !== requestId) return;
        setQuestionsReviewLoading(false);
      });
  }, [loadQuestions, roundKey, searchParams, tournamentKey, viewerUserKey]);

  return {
    questionsReviewTournamentId,
    questionsReviewRound,
    questionsReviewTabIdx,
    setQuestionsReviewTabIdx,
    questionsReviewData,
    questionsReviewLoading,
    questionsReviewError,
    openQuestionsReview,
    closeQuestionsReview,
  };
}
