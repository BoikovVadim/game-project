import { Transaction } from '../transaction.entity';
import { WithdrawalRequest } from '../withdrawal-request.entity';

export interface UserAdminListItemDto {
  id: number;
  username: string;
  email: string;
  nickname: string | null;
  balance: number;
  balanceRubles: number;
  isAdmin: boolean;
  referralCode: string | null;
  createdAt: string | null;
}

export interface UserProfileDto {
  id: number;
  username: string;
  nickname: string | null;
  email: string;
  balance: number;
  balanceRubles: number;
  reservedBalance: number;
  referralCode: string | null;
  referrerId: number | null;
  isAdmin: boolean;
  gender: string | null;
  birthDate: string | null;
  avatarUrl: string | null;
  readNewsIds: number[];
}

export interface UserTransactionDto {
  id: number;
  userId: number;
  amount: number;
  description: string;
  tournamentId: number | null;
  category: string;
  createdAt: string;
  balanceAfterRubles: number;
  balanceAfterL: number;
}

export interface UserWithdrawalRequestDto {
  id: number;
  userId: number;
  amount: number;
  details: string | null;
  status: string;
  adminComment: string | null;
  processedByAdminId: number | null;
  createdAt: string;
  processedAt: string | null;
}

export interface ReferralTreeNodeDto {
  id: number;
  displayName: string;
  referrerId: number | null;
  avatarUrl: string | null;
}

export interface ReferralTreeDto {
  rootUserId: number;
  levels: ReferralTreeNodeDto[][];
}

export interface UserStatsDto {
  gamesPlayed: number;
  gamesPlayedTraining: number;
  gamesPlayedMoney: number;
  completedMatches: number;
  completedMatchesTraining: number;
  completedMatchesMoney: number;
  wins: number;
  winsTraining: number;
  winsMoney: number;
  winRatePercent: number | null;
  correctAnswers: number;
  totalQuestions: number;
  correctAnswersTraining: number;
  totalQuestionsTraining: number;
  correctAnswersMoney: number;
  totalQuestionsMoney: number;
  totalWinnings: number;
  totalWithdrawn: number;
  maxLeague: number | null;
  maxLeagueName: string | null;
}

export interface UserGlobalStatsDto {
  totalUsers: number;
  onlineCount: number;
  totalEarnings: number;
  totalGamesPlayed: number;
  totalTournaments: number;
  totalWithdrawn: number;
}

export interface UserAdminStatusDto {
  isAdmin: boolean;
}

export interface UserReferralCodeDto {
  referralCode: string | null;
}

export interface UserCabinetPingDto {
  ok: boolean;
}

export function buildEmptyUserStatsDto(): UserStatsDto {
  return {
    gamesPlayed: 0,
    gamesPlayedTraining: 0,
    gamesPlayedMoney: 0,
    completedMatches: 0,
    completedMatchesTraining: 0,
    completedMatchesMoney: 0,
    wins: 0,
    winsTraining: 0,
    winsMoney: 0,
    winRatePercent: null,
    correctAnswers: 0,
    totalQuestions: 0,
    correctAnswersTraining: 0,
    totalQuestionsTraining: 0,
    correctAnswersMoney: 0,
    totalQuestionsMoney: 0,
    totalWinnings: 0,
    totalWithdrawn: 0,
    maxLeague: null,
    maxLeagueName: null,
  };
}

export function toUserTransactionDto(
  transaction: Transaction,
  balances?: { rubles: number; balanceL: number },
): UserTransactionDto {
  return {
    id: transaction.id,
    userId: transaction.userId,
    amount: Number(transaction.amount ?? 0),
    description: transaction.description ?? '',
    tournamentId: transaction.tournamentId ?? null,
    category: transaction.category ?? 'other',
    createdAt: transaction.createdAt.toISOString(),
    balanceAfterRubles: balances?.rubles ?? 0,
    balanceAfterL: balances?.balanceL ?? 0,
  };
}

export function toUserWithdrawalRequestDto(
  request: WithdrawalRequest,
): UserWithdrawalRequestDto {
  return {
    id: request.id,
    userId: request.userId,
    amount: Number(request.amount ?? 0),
    details: request.details ?? null,
    status: request.status,
    adminComment: request.adminComment ?? null,
    processedByAdminId: request.processedByAdminId ?? null,
    createdAt: request.createdAt.toISOString(),
    processedAt: request.processedAt ? request.processedAt.toISOString() : null,
  };
}
