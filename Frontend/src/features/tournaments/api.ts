import axios from 'axios';
import type { BracketViewData, QuestionsReviewData, TrainingStateResponse } from './contracts.ts';
import { withBearerToken } from '../../api/client.ts';

export async function prepareTrainingState(token: string, tournamentId: number, userId?: number): Promise<void> {
  const suffix = userId != null ? `/tournaments/admin/${tournamentId}/training-state/prepare?userId=${userId}` : `/tournaments/${tournamentId}/training-state/prepare`;
  await axios.post(suffix, {}, withBearerToken(token));
}

export async function fetchTrainingState(token: string, tournamentId: number, userId?: number): Promise<TrainingStateResponse> {
  const suffix = userId != null ? `/tournaments/admin/${tournamentId}/training-state?userId=${userId}` : `/tournaments/${tournamentId}/training-state`;
  const response = await axios.get<TrainingStateResponse>(suffix, withBearerToken(token));
  return response.data;
}

export async function fetchTournamentBracket(token: string, tournamentId: number, userId?: number): Promise<BracketViewData> {
  const suffix = userId != null ? `/tournaments/admin/${tournamentId}/bracket?userId=${userId}` : `/tournaments/${tournamentId}/bracket`;
  const response = await axios.get<BracketViewData>(suffix, withBearerToken(token));
  return response.data;
}

export async function fetchTournamentQuestions(token: string, tournamentId: number, userId?: number): Promise<QuestionsReviewData> {
  return fetchTrainingState(token, tournamentId, userId);
}
