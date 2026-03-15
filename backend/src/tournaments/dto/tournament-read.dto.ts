import {
  type TournamentListBucket,
  type TournamentResultKind,
  type TournamentResultTone,
  type TournamentStageKind,
} from '../domain/view-model';

export interface TournamentInfoDto {
  id: number;
  name: string;
  type: string | null;
  status: string;
  leagueAmount?: number | null;
}

export interface TournamentListItemDto {
  id: number;
  status: string;
  createdAt: string;
  playersCount: number;
  leagueAmount: number | null;
  deadline: string | null;
  userStatus: 'passed' | 'not_passed';
  stage?: string;
  resultLabel?: string;
  roundForQuestions: 'semi' | 'final';
  questionsAnswered: number;
  questionsTotal: number;
  correctAnswersInRound: number;
  completedAt?: string | null;
  roundFinished?: boolean;
  roundStartedAt?: string | null;
  stageKind: TournamentStageKind;
  resultKind: TournamentResultKind;
  resultTone: TournamentResultTone;
  listBucket: TournamentListBucket;
  canContinue: boolean;
  isWaitingOpponent: boolean;
  isTimeoutResult: boolean;
  tournament: TournamentInfoDto;
}

export interface TournamentListResponseDto {
  active: TournamentListItemDto[];
  completed: TournamentListItemDto[];
}

export interface TournamentQuestionDto {
  id: number;
  question: string;
  options: string[];
  correctAnswer: number;
}

export interface TournamentStateDto {
  tournamentId: number;
  playerSlot: number;
  totalPlayers: number;
  semiIndex: number;
  positionInSemi: number;
  isCreator: boolean;
  deadline: string | null;
  tiebreakerRound?: number;
  tiebreakerQuestions?: TournamentQuestionDto[];
}

export interface TournamentTrainingStatePlayerDto {
  id: number;
  nickname: string;
  avatarUrl: string | null;
}

export interface TournamentTrainingReviewRoundDto {
  key: string;
  label: string;
  stageKind: TournamentStageKind;
  isTiebreaker: boolean;
  sequence: number;
  startIdx: number;
  correctCount: number;
  opponentRoundIndex: number;
  questions: TournamentQuestionDto[];
}

export interface TournamentTrainingStateDto {
  tournamentId: number;
  deadline: string | null;
  questionsSemi1: TournamentQuestionDto[];
  questionsSemi2: TournamentQuestionDto[];
  questionsFinal: TournamentQuestionDto[];
  questionsTiebreaker: TournamentQuestionDto[];
  tiebreakerRound: number;
  tiebreakerBase: number;
  tiebreakerPhase: 'semi' | 'final' | null;
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
  semiResult: 'playing' | 'won' | 'lost' | 'tie' | 'waiting';
  semiTiebreakerAllQuestions: TournamentQuestionDto[][];
  semiTiebreakerRoundsCorrect: number[];
  finalTiebreakerAllQuestions: TournamentQuestionDto[][];
  finalTiebreakerRoundsCorrect: number[];
  reviewRounds: TournamentTrainingReviewRoundDto[];
  opponentAnswersByRound: number[][];
  opponentInfoByRound: TournamentTrainingStatePlayerDto[];
}

export interface TournamentBracketPlayerDto {
  id: number;
  username: string;
  nickname?: string | null;
  avatarUrl?: string | null;
  semiScore?: number;
  questionsAnswered?: number;
  correctAnswersCount?: number;
  isLoser?: boolean;
  tiebreakerRound?: number;
  tiebreakerAnswered?: number;
  tiebreakerCorrect?: number;
  finalScore?: number;
  finalAnswered?: number;
  finalCorrect?: number;
}

export interface TournamentBracketDto {
  tournamentId: number;
  gameType: string | null;
  status: string;
  isCompleted: boolean;
  isActive: boolean;
  semi1: { players: TournamentBracketPlayerDto[] };
  semi2: { players: TournamentBracketPlayerDto[] } | null;
  final: { players: TournamentBracketPlayerDto[] };
  finalWinnerId?: number | null;
}
