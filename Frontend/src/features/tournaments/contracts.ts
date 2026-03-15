export type TournamentResultKind =
  | "victory"
  | "defeat"
  | "timeout_defeat"
  | "waiting_opponent"
  | "final_ready"
  | "tiebreaker"
  | "in_progress";

export type TournamentResultTone =
  | "victory"
  | "defeat"
  | "time-expired"
  | "stage-passed"
  | "final-ready"
  | "tiebreaker"
  | "stage-not-passed";

export type TournamentStageKind = "semi" | "final";
export type TournamentListBucket = "active" | "completed";

export type TournamentListItem = {
  id: number;
  status: string;
  createdAt: string;
  playersCount: number;
  leagueAmount?: number | null;
  deadline?: string | null;
  userStatus: "passed" | "not_passed";
  stage?: string;
  stageKind: TournamentStageKind;
  resultLabel: string;
  resultKind: TournamentResultKind;
  resultTone: TournamentResultTone;
  listBucket: TournamentListBucket;
  canContinue: boolean;
  isWaitingOpponent: boolean;
  isTimeoutResult: boolean;
  roundForQuestions: "semi" | "final";
  roundFinished?: boolean;
  roundStartedAt?: string | null;
  questionsAnswered: number;
  questionsTotal: number;
  correctAnswersInRound: number;
  completedAt?: string | null;
  tournament?: {
    id: number;
    name: string;
    type: string | null;
    status: string;
    leagueAmount?: number | null;
  };
};

export type TournamentHistoryResponse = {
  active: TournamentListItem[];
  completed: TournamentListItem[];
};

export type TrainingQuestion = {
  id: number;
  question: string;
  options: string[];
  correctAnswer: number;
};

export type TrainingStateResponse = {
  tournamentId: number;
  deadline: string | null;
  questionsSemi1: TrainingQuestion[];
  questionsSemi2: TrainingQuestion[];
  questionsFinal: TrainingQuestion[];
  questionsTiebreaker: TrainingQuestion[];
  tiebreakerRound: number;
  tiebreakerBase: number;
  tiebreakerPhase: "semi" | "final" | null;
  questionsAnsweredCount: number;
  currentQuestionIndex: number;
  lockedAnswerCount: number;
  timeLeftSeconds: number | null;
  leftAt: string | null;
  correctAnswersCount: number;
  semiFinalCorrectCount: number | null;
  semiTiebreakerCorrectSum: number;
  answersChosen: number[];
  userSemiIndex: number;
  semiResult: "playing" | "won" | "lost" | "tie" | "waiting";
  semiTiebreakerAllQuestions: TrainingQuestion[][];
  semiTiebreakerRoundsCorrect: number[];
  finalTiebreakerAllQuestions: TrainingQuestion[][];
  finalTiebreakerRoundsCorrect: number[];
  reviewRounds: QuestionsReviewRound[];
  opponentAnswersByRound: number[][];
  opponentInfoByRound: {
    id: number;
    nickname: string;
    avatarUrl: string | null;
  }[];
};

export type BracketPlayerData = {
  id: number;
  username?: string;
  nickname?: string | null;
  avatarUrl?: string | null;
  isLoser?: boolean;
  questionsAnswered?: number;
  correctAnswersCount?: number;
  semiScore?: number | null;
  finalAnswered?: number;
  finalScore?: number | null;
  finalCorrect?: number | null;
};

export type BracketViewData = {
  tournamentId: number;
  gameType?: "training" | "money" | string | null;
  semi1: { players: BracketPlayerData[] };
  semi2: { players: BracketPlayerData[] } | null;
  final: { players: BracketPlayerData[] };
  finalWinnerId?: number | null;
  status?: string;
  isCompleted?: boolean;
  isActive?: boolean;
};

export type QuestionsReviewData = {
  questionsSemi1: TrainingQuestion[];
  questionsSemi2: TrainingQuestion[];
  questionsFinal: TrainingQuestion[];
  questionsAnsweredCount: number;
  correctAnswersCount: number;
  semiFinalCorrectCount?: number | null;
  semiTiebreakerCorrectSum?: number;
  answersChosen: number[];
  userSemiIndex?: number;
  semiTiebreakerAllQuestions?: TrainingQuestion[][];
  semiTiebreakerRoundsCorrect?: number[];
  finalTiebreakerAllQuestions?: TrainingQuestion[][];
  finalTiebreakerRoundsCorrect?: number[];
  reviewRounds: QuestionsReviewRound[];
  opponentAnswersByRound?: number[][];
  opponentInfoByRound?: {
    id: number;
    nickname: string;
    avatarUrl?: string | null;
  }[];
};

export type QuestionsReviewRound = {
  key: string;
  label: string;
  stageKind: "semi" | "final";
  isTiebreaker: boolean;
  sequence: number;
  startIdx: number;
  correctCount: number;
  opponentRoundIndex: number;
  questions: TrainingQuestion[];
};

export type BracketPlayerTooltipData = {
  playerId: number;
  displayName: string;
  avatarUrl: string | null;
  stats: import("../users/contracts.ts").PlayerStats;
  rect: DOMRect;
};

export type OppTooltipState = {
  loading: boolean;
  data: null | import("../users/contracts.ts").PlayerStats;
  visible: boolean;
  avatarUrl?: string | null;
};
