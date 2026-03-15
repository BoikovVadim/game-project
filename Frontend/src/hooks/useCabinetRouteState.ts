import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';

export type CabinetSection =
  | 'profile'
  | 'statistics'
  | 'games'
  | 'games-training'
  | 'games-money'
  | 'finance'
  | 'finance-topup'
  | 'finance-withdraw'
  | 'partner'
  | 'partner-statistics'
  | 'news';

export type CabinetStatsMode = 'personal' | 'general';
export type CabinetGameMode = 'training' | 'money' | null;

function parsePositiveInt(raw: string | null): number | null {
  if (!raw || !/^\d+$/.test(raw)) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export const CABINET_SECTIONS: readonly CabinetSection[] = [
  'profile',
  'statistics',
  'games',
  'games-training',
  'games-money',
  'finance',
  'finance-topup',
  'finance-withdraw',
  'partner',
  'partner-statistics',
  'news',
];

const VALID_SECTIONS = new Set<CabinetSection>(CABINET_SECTIONS);

function parseSection(raw: string | null, fallback: CabinetSection = 'news'): CabinetSection {
  if (raw && VALID_SECTIONS.has(raw as CabinetSection)) return raw as CabinetSection;
  return fallback;
}

export function useCabinetRouteState(defaultSection: CabinetSection = 'news') {
  const [searchParams, setSearchParams] = useSearchParams();

  const section = useMemo(() => parseSection(searchParams.get('section'), defaultSection), [defaultSection, searchParams]);
  const gameMode: CabinetGameMode = section === 'games-training' ? 'training' : section === 'games-money' ? 'money' : null;
  const statsMode: CabinetStatsMode = searchParams.get('statsMode') === 'general' ? 'general' : 'personal';
  const paymentStatus = searchParams.get('payment');
  const selectedLeague = parsePositiveInt(searchParams.get('league'));

  const setSection = useCallback((nextSection: CabinetSection) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('section', nextSection);
      return next;
    }, { replace: false });
  }, [setSearchParams]);

  const setGameMode = useCallback((nextMode: CabinetGameMode) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (nextMode === 'training') next.set('section', 'games-training');
      else if (nextMode === 'money') next.set('section', 'games-money');
      else next.set('section', 'games');
      return next;
    }, { replace: false });
  }, [setSearchParams]);

  const setStatsMode = useCallback((nextMode: CabinetStatsMode) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('section', 'statistics');
      if (nextMode === 'general') next.set('statsMode', 'general');
      else next.delete('statsMode');
      return next;
    }, { replace: false });
  }, [setSearchParams]);

  const setSelectedLeague = useCallback((nextLeague: number | null) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (nextLeague == null || nextLeague <= 0) next.delete('league');
      else next.set('league', String(nextLeague));
      return next;
    }, { replace: false });
  }, [setSearchParams]);

  return {
    searchParams,
    setSearchParams,
    section,
    gameMode,
    statsMode,
    paymentStatus,
    selectedLeague,
    setSection,
    setGameMode,
    setStatsMode,
    setSelectedLeague,
  };
}
