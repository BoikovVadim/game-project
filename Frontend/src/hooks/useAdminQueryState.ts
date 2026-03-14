import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';

export type AdminSection = 'withdrawals' | 'users' | 'credit' | 'support' | 'statistics' | 'news';
export type AdminStatsTab = 'overview' | 'transactions' | 'questions' | 'tournaments' | 'project-cost';
export type AdminWithdrawalStatus = 'pending' | 'approved' | 'rejected' | '';
export type AdminTxCategory = '' | 'topup' | 'withdraw' | 'win' | 'other';

function parseSection(raw: string | null): AdminSection {
  if (raw === 'users' || raw === 'credit' || raw === 'support' || raw === 'withdrawals' || raw === 'news') return raw;
  return 'statistics';
}

function parseStatsTab(raw: string | null): AdminStatsTab {
  if (raw === 'transactions' || raw === 'questions' || raw === 'tournaments' || raw === 'project-cost') return raw;
  return 'overview';
}

function parseWithdrawalStatus(raw: string | null): AdminWithdrawalStatus {
  return raw === 'approved' || raw === 'rejected' || raw === '' ? raw : 'pending';
}

function parseTxCategory(raw: string | null): AdminTxCategory {
  return raw === 'topup' || raw === 'withdraw' || raw === 'win' || raw === 'other' ? raw : '';
}

export function useAdminQueryState() {
  const [searchParams, setSearchParams] = useSearchParams();

  const state = useMemo(() => {
    const supportTicketRaw = searchParams.get('supportTicket');
    const supportTicket = supportTicketRaw && /^\d+$/.test(supportTicketRaw) ? Number(supportTicketRaw) : null;
    return {
      section: parseSection(searchParams.get('tab')),
      withdrawalStatus: parseWithdrawalStatus(searchParams.get('status')),
      userSearch: searchParams.get('userSearch') ?? '',
      supportStatus: searchParams.get('supportStatus') ?? 'open',
      supportTicket,
      statsTab: parseStatsTab(searchParams.get('statsTab')),
      tournamentId: searchParams.get('tournamentId') ?? '',
      tournamentCols: searchParams.get('tournamentCols'),
      txCategory: parseTxCategory(searchParams.get('txCategory')),
      statsGroupBy: searchParams.get('statsGroupBy') ?? 'day',
    };
  }, [searchParams]);

  const patchQuery = useCallback((patch: Record<string, string | null | undefined>) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      Object.entries(patch).forEach(([key, value]) => {
        if (value == null) next.delete(key);
        else next.set(key, value);
      });
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  return {
    searchParams,
    setSearchParams,
    state,
    patchQuery,
  };
}
