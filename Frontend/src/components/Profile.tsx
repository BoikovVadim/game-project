import React, { useEffect, useState, useRef, useMemo } from 'react';
import { Link, useNavigate, useLocation, useSearchParams } from 'react-router-dom';
import axios from 'axios';
import { formatNum, CURRENCY } from './formatNum.ts';
import { toMoscowDateStr, parseMoscowDate, formatMoscowDateTime, formatMoscowDateTimeFull } from './dateUtils.ts';
import './Profile.css';

interface ProfileProps {
  token: string;
  onLogout?: () => void;
  /** При открытии по прямой ссылке /games — сразу показать раздел «Игры». */
  forceSection?: string;
}

type CabinetSection = null | 'profile' | 'statistics' | 'games' | 'finance' | 'finance-topup' | 'finance-withdraw' | 'partner' | 'partner-statistics' | 'news';

type NotificationItem = {
  id: string;
  type: 'game_status' | 'win' | 'game_started' | 'opponent_joined' | 'balance' | 'system';
  title: string;
  text: string;
  createdAt: string;
  read: boolean;
  meta?: { goToGames: true; gameMode?: 'training' | 'money' };
};
type GameMode = null | 'training' | 'money';

type TrainingQuestion = { id: number; question: string; options: string[]; correctAnswer: number };
type TrainingData = {
  tournamentId: number;
  deadline: string;
  questionsSemi1: TrainingQuestion[];
  questionsSemi2: TrainingQuestion[];
  questionsFinal: TrainingQuestion[];
  questionsTiebreaker: TrainingQuestion[];
  tiebreakerRound: number;
  tiebreakerBase: number;
  tiebreakerPhase: 'semi' | 'final' | null;
};

type TrainingRound = 0 | 1 | 2 | 3; // 0 = semi1, 1 = semi2, 2 = final, 3 = tiebreaker

/** Названия лиг по камням (от дешёвого к дорогому) */
const LEAGUE_GEMS: Record<number, { name: string; color: string }> = {
  5: { name: 'Янтарная лига', color: '#F5C842' },
  10: { name: 'Коралловая лига', color: '#FF7F50' },
  20: { name: 'Нефритовая лига', color: '#00A86B' },
  50: { name: 'Агатовая лига', color: '#8B7355' },
  100: { name: 'Аметистовая лига', color: '#9966CC' },
  200: { name: 'Топазовая лига', color: '#FFC87C' },
  500: { name: 'Гранатовая лига', color: '#733635' },
  1000: { name: 'Изумрудовая лига', color: '#50C878' },
  2000: { name: 'Рубиновая лига', color: '#E0115F' },
  5000: { name: 'Сапфировая лига', color: '#0F52BA' },
  10000: { name: 'Опаловая лига', color: '#A8C3BC' },
  20000: { name: 'Жемчужная лига', color: '#F0E6EF' },
  50000: { name: 'Александритовая лига', color: '#598556' },
  100000: { name: 'Бриллиантовая лига', color: '#B9F2FF' },
  200000: { name: 'Лазуритовая лига', color: '#26619C' },
  500000: { name: 'Лига чёрного опала', color: '#2C2C2C' },
  1000000: { name: 'Алмазная лига', color: '#E8F4FC' },
};

/** Нейрокартинки лиг (путь в public) */
const LEAGUE_IMAGES: Record<number, string> = {
  5: '/leagues/league-amber.png',
  10: '/leagues/league-coral.png',
  20: '/leagues/league-jade.png',
  50: '/leagues/league-agate.png',
  100: '/leagues/league-amethyst.png',
  200: '/leagues/league-topaz.png',
  500: '/leagues/league-garnet.png',
  1000: '/leagues/league-emerald.png',
  2000: '/leagues/league-ruby.png',
  5000: '/leagues/league-sapphire.png',
  10000: '/leagues/league-opal.png',
  20000: '/leagues/league-pearl.png',
  50000: '/leagues/league-alexandrite.png',
  100000: '/leagues/league-diamond.png',
  200000: '/leagues/league-lapis.png',
  500000: '/leagues/league-blackopal.png',
  1000000: '/leagues/league-almaz.png',
};

/** Выигрыш победителя: 4 игрока × ставка − 20% с каждого из 3 проигравших = 3.4 × ставка L */
function getLeaguePrize(stake: number): number {
  return Math.round(3.4 * stake);
}

const GemIcon = ({ amount, className }: { amount: number; className?: string }) => {
  const gem = LEAGUE_GEMS[amount] ?? { name: `Лига ${formatNum(amount)} ${CURRENCY}`, color: '#888' };
  const c = gem.color;
  return (
    <svg className={className} viewBox="0 0 80 100" fill="none">
      <defs>
        <linearGradient id={`gem-${amount}`} x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor={c} stopOpacity="1" />
          <stop offset="100%" stopColor={c} stopOpacity="0.5" />
        </linearGradient>
        <filter id={`glow-${amount}`}>
          <feGaussianBlur stdDeviation="1" result="blur" />
          <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
      </defs>
      <path d="M40 5 L75 35 L75 70 L40 95 L5 70 L5 35 Z" fill={`url(#gem-${amount})`} stroke={c} strokeWidth="2" filter={`url(#glow-${amount})`} />
      <path d="M40 5 L40 95 M5 35 L75 35 M5 70 L75 70" stroke="rgba(255,255,255,0.3)" strokeWidth="1" fill="none" />
    </svg>
  );
};

const NewsItem = ({ id, topic, date, description, unread, onRead }: { id: number; topic: string; date: string; description: React.ReactNode; unread?: boolean; onRead?: () => void }) => {
  const [expanded, setExpanded] = useState(false);
  const handleToggle = () => {
    const next = !expanded;
    setExpanded(next);
    if (next && onRead) onRead();
  };
  return (
    <div className={`cabinet-news-item ${expanded ? 'expanded' : ''}${unread && !expanded ? ' cabinet-news-item--unread' : ''}`}>
      <button
        type="button"
        className="cabinet-news-item-header"
        onClick={handleToggle}
        aria-expanded={expanded}
      >
        {unread && !expanded && <span className="cabinet-news-unread-dot" />}
        <span className="cabinet-news-item-topic">{topic}</span>
        <span className="cabinet-news-item-date">{date}</span>
        <span className="cabinet-news-item-chevron" aria-hidden>{expanded ? '▼' : '▶'}</span>
      </button>
      {expanded && (
        <div className="cabinet-news-item-body">
          {description}
        </div>
      )}
    </div>
  );
};

const DollarIcon = ({ className }: { className?: string }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
  </svg>
);

type PlayerStats = {
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

/** Имя игрока в сетке турнира — клик показывает/скрывает статистику */
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
  onShowTooltip: (data: { playerId: number; displayName: string; avatarUrl: string | null; stats: PlayerStats; rect: DOMRect }) => void;
  onCloseTooltip: () => void;
}) => {
  const elRef = useRef<HTMLButtonElement | null>(null);

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isTooltipOpen) {
      onCloseTooltip();
      return;
    }
    const rect = elRef.current?.getBoundingClientRect();
    if (!rect) return;
    axios.get<PlayerStats>(`/users/${playerId}/public-stats`, { headers: { Authorization: `Bearer ${token}` } })
      .then((res) => onShowTooltip({ playerId, displayName, avatarUrl, stats: res.data, rect }))
      .catch(() => {});
  };

  return (
    <button
      type="button"
      ref={elRef}
      className="bracket-player-name bracket-player-name--clickable bracket-player-name-btn"
      onClick={handleClick}
      title={isTooltipOpen ? 'Нажмите, чтобы закрыть' : 'Нажмите для просмотра статистики'}
    >
      {displayName}
    </button>
  );
};

type PartnerDetailNode = { id: number; displayName: string; referrerId: number | null; avatarUrl?: string | null };

/** Ячейка дерева — клик по имени показывает/скрывает статистику */
const PartnerDetailTooltipCell = React.memo(({
  node,
  col,
  expandedIds,
  setPartnerDetailExpandedIds,
  getDescendantCount,
  hasChildren,
  token,
  isTooltipOpen,
  onShowTooltip,
  onCloseTooltip,
  currentUserId,
  currentUserAvatar,
}: {
  node: PartnerDetailNode;
  col: number;
  expandedIds: Set<number>;
  setPartnerDetailExpandedIds: React.Dispatch<React.SetStateAction<Set<number>>>;
  getDescendantCount: (nodeId: number, levelIndex: number) => number;
  hasChildren: (levelIndex: number, nodeId: number) => boolean;
  token: string;
  isTooltipOpen: boolean;
  onShowTooltip: (data: { playerId: number; displayName: string; avatarUrl: string | null; stats: PlayerStats; rect: DOMRect }) => void;
  onCloseTooltip: () => void;
  currentUserId?: number;
  currentUserAvatar?: string | null;
}) => {
  const displayName = node.displayName.startsWith('ref_model_') ? node.displayName.slice(0, 10) : node.displayName;
  const avatarUrl = (currentUserId != null && node.id === currentUserId) ? currentUserAvatar : (node.avatarUrl ?? null);
  const elRef = useRef<HTMLButtonElement | null>(null);

  const handleNodeClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isTooltipOpen) {
      onCloseTooltip();
      return;
    }
    const rect = elRef.current?.getBoundingClientRect();
    if (!rect) return;
    axios.get<PlayerStats>(`/users/${node.id}/public-stats`, { headers: { Authorization: `Bearer ${token}` } })
      .then((res) => onShowTooltip({ playerId: node.id, displayName, avatarUrl, stats: res.data, rect }))
      .catch(() => {});
  };

  return (
    <div className="partner-detail-node-wrap">
      {hasChildren(col, node.id) && (
        <button
          type="button"
          className="partner-detail-expand"
          onClick={(e) => { e.stopPropagation(); setPartnerDetailExpandedIds((prev) => { const next = new Set(prev); if (next.has(node.id)) next.delete(node.id); else next.add(node.id); return next; }); }}
          aria-expanded={expandedIds.has(node.id)}
          title={expandedIds.has(node.id) ? 'Свернуть следующий уровень' : 'Раскрыть следующий уровень'}
        >
          {expandedIds.has(node.id) ? '−' : '+'}
        </button>
      )}
      <button
        type="button"
        ref={elRef}
        className="partner-detail-node partner-detail-node--clickable"
        onClick={handleNodeClick}
        title={isTooltipOpen ? 'Нажмите, чтобы закрыть' : 'Нажмите для просмотра статистики'}
      >
        <span className="bracket-player-name bracket-player-name--clickable">{displayName}</span>
        <span className="partner-detail-node-count">({getDescendantCount(node.id, col)})</span>
      </button>
    </div>
  );
});

const PartnerDetailTreeBody = React.memo(({
  rowGrid,
  subtreeLevels,
  expandedIds,
  setPartnerDetailExpandedIds,
  getDescendantCount,
  hasChildren,
  token,
  tooltipPlayerId,
  onShowTooltip,
  onCloseTooltip,
  currentUserId,
  currentUserAvatar,
}: {
  rowGrid: (PartnerDetailNode | null)[][];
  subtreeLevels: PartnerDetailNode[][];
  expandedIds: Set<number>;
  setPartnerDetailExpandedIds: React.Dispatch<React.SetStateAction<Set<number>>>;
  getDescendantCount: (nodeId: number, levelIndex: number) => number;
  hasChildren: (levelIndex: number, nodeId: number) => boolean;
  token: string;
  tooltipPlayerId: number | null;
  onShowTooltip: (data: { playerId: number; displayName: string; avatarUrl: string | null; stats: PlayerStats; rect: DOMRect }) => void;
  onCloseTooltip: () => void;
  currentUserId?: number;
  currentUserAvatar?: string | null;
}) => (
  <tbody>
    {rowGrid.map((row, rowIdx) => (
      <tr key={`row-${rowIdx}`} className="partner-detail-tr">
        {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((col) => {
          const node = row[col];
          return (
            <td key={col} className="partner-detail-td">
              {node ? (
                <PartnerDetailTooltipCell
                  node={node}
                  col={col}
                  expandedIds={expandedIds}
                  setPartnerDetailExpandedIds={setPartnerDetailExpandedIds}
                  getDescendantCount={getDescendantCount}
                  hasChildren={hasChildren}
                  token={token}
                  isTooltipOpen={tooltipPlayerId === node.id}
                  onShowTooltip={onShowTooltip}
                  onCloseTooltip={onCloseTooltip}
                  currentUserId={currentUserId}
                  currentUserAvatar={currentUserAvatar}
                />
              ) : null}
            </td>
          );
        })}
      </tr>
    ))}
  </tbody>
));

/** Обёртка дерева */
const PartnerDetailTreeSection = React.memo(({
  referralModalData,
  partnerDetailExpandedIds,
  setPartnerDetailExpandedIds,
  token,
  tooltipPlayerId,
  onShowTooltip,
  onCloseTooltip,
  currentUserId,
  currentUserAvatar,
}: {
  referralModalData: { rowGrid: (PartnerDetailNode | null)[][]; subtreeLevels: PartnerDetailNode[][]; getDescendantCount: (a: number, b: number) => number; hasChildren: (a: number, b: number) => boolean };
  partnerDetailExpandedIds: Set<number>;
  setPartnerDetailExpandedIds: React.Dispatch<React.SetStateAction<Set<number>>>;
  token: string;
  tooltipPlayerId: number | null;
  onShowTooltip: (data: { playerId: number; displayName: string; avatarUrl: string | null; stats: PlayerStats; rect: DOMRect }) => void;
  onCloseTooltip: () => void;
  currentUserId?: number;
  currentUserAvatar?: string | null;
}) => (
  <div className="partner-detail-tree partner-detail-tree-table">
    <table className="partner-detail-table">
      <thead>
        <tr>
          {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((L) => {
            const count = referralModalData.subtreeLevels[L - 1]?.length ?? 0;
            return (
              <th key={L} className="partner-detail-th">
                Линия {L} ({count} чел.)
              </th>
            );
          })}
        </tr>
      </thead>
      <PartnerDetailTreeBody
        rowGrid={referralModalData.rowGrid}
        subtreeLevels={referralModalData.subtreeLevels}
        expandedIds={partnerDetailExpandedIds}
        setPartnerDetailExpandedIds={setPartnerDetailExpandedIds}
        getDescendantCount={referralModalData.getDescendantCount}
        hasChildren={referralModalData.hasChildren}
        token={token}
        tooltipPlayerId={tooltipPlayerId}
        onShowTooltip={onShowTooltip}
        onCloseTooltip={onCloseTooltip}
        currentUserId={currentUserId}
        currentUserAvatar={currentUserAvatar}
      />
    </table>
  </div>
));

const SECTION_STORAGE_KEY = 'cabinetSection';
const GAME_MODE_STORAGE_KEY = 'cabinetGameMode';
const STATS_MODE_STORAGE_KEY = 'cabinetStatsMode';
const SELECTED_LEAGUE_STORAGE_KEY = 'cabinetSelectedLeague';
const VALID_SECTIONS = ['profile', 'statistics', 'games', 'finance', 'finance-topup', 'finance-withdraw', 'partner', 'partner-statistics', 'news'] as const;

const BRACKET_NAME_MAX_LEN = 20;

function truncateBracketName(s: string): string {
  return s;
}

/** Не показываем «Возврат по отклонённой заявке» — деньги формально не уходили. */
function filterRejectedWithdrawalRefunds(list: { category?: string; description?: string | null }[]): typeof list {
  return list.filter((t) => {
    if (t.category !== 'refund' || !t.description) return true;
    const d = t.description.toLowerCase().replace(/ё/g, 'е');
    return !((d.includes('отклонен') && d.includes('заявк')) || d.includes('возврат по отклонен'));
  });
}

function getHashBase(hash: string): string {
  const withoutQuery = (hash.split('?')[0] ?? hash).trim();
  return withoutQuery.split('&')[0] ?? withoutQuery;
}

function getBracketIdFromHash(hash: string): number | null {
  const parts = hash.split('&');
  const bracketPart = parts.find((p) => p.startsWith('bracket='));
  if (!bracketPart) return null;
  const id = parseInt(bracketPart.split('=')[1] ?? '', 10);
  return !Number.isNaN(id) ? id : null;
}

function getBracketSourceFromHash(hash: string): 'active' | 'completed' | null {
  const parts = hash.split('&');
  const sourcePart = parts.find((p) => p.startsWith('bracketSource='));
  if (!sourcePart) return null;
  const val = sourcePart.split('=')[1];
  return val === 'active' || val === 'completed' ? val : null;
}

function getQuestionsReviewFromHash(hash: string): { tournamentId: number; round: 'semi' | 'final' } | null {
  const parts = hash.split('&');
  const idPart = parts.find((p) => p.startsWith('questions='));
  const roundPart = parts.find((p) => p.startsWith('questionsRound='));
  if (!idPart) return null;
  const id = parseInt(idPart.split('=')[1] ?? '', 10);
  if (Number.isNaN(id) || id <= 0) return null;
  const round = roundPart?.split('=')[1];
  return round === 'semi' || round === 'final' ? { tournamentId: id, round } : { tournamentId: id, round: 'semi' };
}

function getStatsModeFromHash(hash: string): 'personal' | 'general' {
  const parts = hash.split('&');
  const part = parts.find((p) => p.startsWith('statsMode='));
  if (part?.split('=')[1] === 'general') return 'general';
  if (typeof window !== 'undefined') {
    const stored = localStorage.getItem(STATS_MODE_STORAGE_KEY);
    if (stored === 'general') return 'general';
  }
  return 'personal';
}

function getSectionFromHashQuery(hash: string): CabinetSection | null {
  const q = hash.indexOf('?');
  if (q < 0) return null;
  const params = new URLSearchParams(hash.slice(q));
  return getSectionFromSearchParams(params);
}

function getSectionFromSearchParams(params: URLSearchParams): CabinetSection | null {
  const section = params.get('section');
  if (!section) return null;
  const baseFirst = section.split('-')[0];
  if ((VALID_SECTIONS as readonly string[]).includes(section)) return section as CabinetSection;
  if (baseFirst === 'games' && (section === 'games' || section === 'games-training' || section === 'games-money')) return section as CabinetSection;
  if (baseFirst === 'finance' && ['finance', 'finance-topup', 'finance-withdraw'].includes(section)) return section as CabinetSection;
  if (baseFirst === 'partner' && ['partner', 'partner-statistics'].includes(section)) return section as CabinetSection;
  return null;
}

function getInitialSection(): CabinetSection {
  try {
    if (typeof window === 'undefined') return 'news';
    const hash = (typeof window !== 'undefined' ? window.location.hash.replace(/^#/, '') : '') || '/';
    const fromQuery = getSectionFromHashQuery(hash);
    if (fromQuery) return fromQuery;
    const searchParams = new URLSearchParams(window.location.search);
    const fromSearch = getSectionFromSearchParams(searchParams);
    if (fromSearch) return fromSearch;
    const base = getHashBase(hash);
    const baseFirst = base.split('-')[0];
    const stored = localStorage.getItem(SECTION_STORAGE_KEY);
    const isValidStored = stored && (VALID_SECTIONS as readonly string[]).includes(stored);
    if (base && (base === '/profile' || base === 'profile')) return 'news';
    if (base && ((VALID_SECTIONS as readonly string[]).includes(base) || (baseFirst === 'games' && (base === 'games' || base === 'games-training' || base === 'games-money')) || (baseFirst === 'finance' && ['finance', 'finance-topup', 'finance-withdraw'].includes(base)) || (baseFirst === 'partner' && ['partner', 'partner-statistics'].includes(base)))) {
      return base as CabinetSection;
    }
    if (isValidStored) return stored as CabinetSection;
    if (typeof window !== 'undefined' && (window.location.pathname === '/profile' || hash === '/profile' || hash.startsWith('/profile'))) return 'news';
  } catch (_e) {}
  const stored = typeof window !== 'undefined' ? localStorage.getItem(SECTION_STORAGE_KEY) : null;
  if (stored && (VALID_SECTIONS as readonly string[]).includes(stored)) return stored as CabinetSection;
  return 'news';
}

function getInitialGameMode(): GameMode {
  try {
    if (typeof window !== 'undefined') {
      const hash = window.location.hash.replace(/^#/, '') || '/';
      const fromHash = getSectionFromHashQuery(hash);
      if (fromHash === 'games-training') return 'training';
      if (fromHash === 'games-money') return 'money';
      const sp = new URLSearchParams(window.location.search);
      const sec = sp.get('section');
      if (sec === 'games-training') return 'training';
      if (sec === 'games-money') return 'money';
      const base = getHashBase(hash);
      if (base === 'games-training') return 'training';
      if (base === 'games-money') return 'money';
      if (base === 'games' || (base && base.startsWith('games-'))) {
        const stored = localStorage.getItem(GAME_MODE_STORAGE_KEY);
        if (stored === 'training' || stored === 'money') return stored as GameMode;
      }
    }
  } catch (_e) {}
  return null;
}

const Profile: React.FC<ProfileProps> = ({ token, onLogout, forceSection: forceSectionProp }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const forceSection = (forceSectionProp && (VALID_SECTIONS as readonly string[]).includes(forceSectionProp)) ? forceSectionProp as CabinetSection : undefined;

  const [section, setSection] = useState<CabinetSection>(() => {
    if (forceSection) return forceSection;
    const hash = typeof window !== 'undefined' ? window.location.hash.replace(/^#/, '') : '';
    const fromHash = getSectionFromHashQuery(hash);
    if (fromHash) return fromHash;
    try {
      const ss = typeof window !== 'undefined' ? sessionStorage.getItem('cabinetSectionSession') : null;
      if (ss) {
        const parsed = getSectionFromSearchParams(new URLSearchParams(`section=${ss}`));
        if (parsed) return parsed;
      }
    } catch (_e) {}
    return 'news';
  });
  const [gameMode, setGameModeState] = useState<GameMode>(() => {
    const hash = typeof window !== 'undefined' ? window.location.hash.replace(/^#/, '') : '';
    const fromHash = getSectionFromHashQuery(hash);
    if (fromHash === 'games-training') return 'training';
    if (fromHash === 'games-money') return 'money';
    try {
      const ss = typeof window !== 'undefined' ? sessionStorage.getItem('cabinetSectionSession') : null;
      if (ss === 'games-training') return 'training';
      if (ss === 'games-money') return 'money';
      const stored = typeof window !== 'undefined' ? localStorage.getItem(GAME_MODE_STORAGE_KEY) : null;
      if (stored === 'training' || stored === 'money') return stored as GameMode;
    } catch (_e) {}
    return null;
  });

  const sectionFromUrl = (() => {
    const rawHash = typeof window !== 'undefined' ? window.location.hash.replace(/^#/, '') : '';
    const fromHash = getSectionFromHashQuery(rawHash);
    if (fromHash) return fromHash;
    const fromSearch = getSectionFromSearchParams(searchParams);
    if (fromSearch) return fromSearch;
    try {
      const ss = typeof window !== 'undefined' ? sessionStorage.getItem('cabinetSectionSession') : null;
      if (ss) {
        const parsed = getSectionFromSearchParams(new URLSearchParams(`section=${ss}`));
        if (parsed) return parsed;
      }
    } catch (_e) {}
    return forceSection || 'news';
  })();

  // Прямая ссылка /games: принудительно открыть раздел «Игры» и подставить URL
  useEffect(() => {
    if (forceSection) {
      setSection(forceSection);
      navigate(`/profile?section=${encodeURIComponent(forceSection)}`, { replace: true });
    }
  }, [forceSection, navigate]);

  // После первого восстановления из URL не показывать древо/линии партнёрки до подтверждения — убирает мелькание при обновлении
  const [sectionFromUrlConfirmed, setSectionFromUrlConfirmed] = useState(false);
  useEffect(() => {
    setSectionFromUrlConfirmed(true);
  }, []);

  // Восстанавливаем раздел и режим из URL при загрузке/обновлении и при навигации (назад/вперёд)
  useEffect(() => {
    if (forceSection) return;
    const urlSection = sectionFromUrl;
    const urlGameMode = urlSection === 'games-training' ? 'training' : urlSection === 'games-money' ? 'money' : null;
    // Не сбрасывать в выбор режима, если в URL ещё section=games (navigate не успел), и пользователь уже выбрал тренировку/противостояние
    if (urlSection === 'games' && (gameMode === 'training' || gameMode === 'money')) return;
    setSection(urlSection);
    setGameModeState(urlGameMode);
  }, [sectionFromUrl, forceSection, gameMode]);

  // Держим URL в sync с текущим разделом (включая news), чтобы при обновлении вкладка не менялась
  useEffect(() => {
    const current = searchParams.get('section');
    const toSet = section || 'news';
    try { sessionStorage.setItem('cabinetSectionSession', toSet); } catch (_e) {}
    if (current === toSet) return;
    navigate(`/profile?section=${encodeURIComponent(toSet)}`, { replace: true });
  }, [section, navigate, searchParams]);
  const gameModeRef = useRef<GameMode>(gameMode);
  useEffect(() => {
    gameModeRef.current = gameMode;
  }, [gameMode]);

  useEffect(() => {
    axios.get<{ id: number; topic: string; body: string; createdAt: string }[]>('/news')
      .then((r) => setApiNews(Array.isArray(r.data) ? r.data : []))
      .catch(() => {});
  }, []);

  const goToSection = (s: CabinetSection, financeSub?: 'topup' | 'withdraw') => {
    let newHash: string;
    let sectionToSet: CabinetSection = s;
    if (s === 'games') {
      const mode = gameModeRef.current;
      newHash = mode === 'training' || mode === 'money' ? `games-${mode}` : 'games';
    } else if (s === 'statistics') {
      newHash = 'statistics';
    } else if ((s === 'finance' || s === 'finance-topup' || s === 'finance-withdraw') && financeSub) {
      newHash = financeSub === 'topup' ? 'finance-topup' : 'finance-withdraw';
      sectionToSet = newHash as CabinetSection;
    } else if (s === 'finance' || s === 'finance-topup' || s === 'finance-withdraw') {
      newHash = s;
    } else {
      newHash = s;
    }
    localStorage.setItem(SECTION_STORAGE_KEY, sectionToSet);
    navigate(newHash ? `/profile?section=${encodeURIComponent(newHash)}` : '/profile', { replace: true });
    setSection(sectionToSet);
  };
  const setGameMode = (mode: GameMode) => {
    setGameModeState(mode);
    if (mode === 'training' || mode === 'money') {
      const newSection = `games-${mode}` as CabinetSection;
      setSection(newSection);
      localStorage.setItem(GAME_MODE_STORAGE_KEY, mode);
      localStorage.setItem(SECTION_STORAGE_KEY, newSection);
      navigate(`/profile?section=${encodeURIComponent(newSection)}`, { replace: true });
    } else {
      setSection('games');
      localStorage.removeItem(GAME_MODE_STORAGE_KEY);
      if (section === 'games-training' || section === 'games-money') {
        navigate('/profile?section=games', { replace: true });
      }
    }
  };
  const [user, setUser] = useState<any>(null);
  const [showAdminLink, setShowAdminLink] = useState(false);
  const [isImpersonating] = useState(() => !!localStorage.getItem('adminToken'));
  const [transactions, setTransactions] = useState<any[]>([]);
  const [transactionsLoaded, setTransactionsLoaded] = useState(false);
  const [avatar, setAvatar] = useState<string | null>(null);
  const [rublesInput, setRublesInput] = useState('');
  const [legendsInput, setLegendsInput] = useState('');
  const [convertLoading, setConvertLoading] = useState(false);
  const [transactionSortBy, setTransactionSortBy] = useState<'id' | 'date' | 'amount' | 'category'>('date');
  const [transactionSortDir, setTransactionSortDir] = useState<'asc' | 'desc'>('desc');
  const [transactionCategoryFilter, setTransactionCategoryFilter] = useState<string | null>(null);
  const [transactionDateFrom, setTransactionDateFrom] = useState<string>('');
  const [transactionDateTo, setTransactionDateTo] = useState<string>('');
  const [convertError, setConvertError] = useState('');
  const [topupAmount, setTopupAmount] = useState('');
  const [topupProvider, setTopupProvider] = useState<'yookassa' | 'robokassa'>('yookassa');
  const [topupLoading, setTopupLoading] = useState(false);
  const [topupError, setTopupError] = useState('');
  const [paymentProviders, setPaymentProviders] = useState<{ yookassa: boolean; robokassa: boolean }>({ yookassa: false, robokassa: false });
  const [withdrawAmount, setWithdrawAmount] = useState('');
  const [withdrawDetails, setWithdrawDetails] = useState('');
  const [withdrawLoading, setWithdrawLoading] = useState(false);
  const [withdrawError, setWithdrawError] = useState('');
  const [withdrawSuccess, setWithdrawSuccess] = useState(false);
  const [myWithdrawalRequests, setMyWithdrawalRequests] = useState<{ id: number; amount: number; details: string | null; status: string; createdAt: string }[]>([]);
  const [nickname, setNickname] = useState<string>(() => {
    try {
      const id = localStorage.getItem('userId');
      return (id && localStorage.getItem(`nickname_${id}`)) || '';
    } catch {
      return '';
    }
  });
  const [isEditingName, setIsEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const [gender, setGender] = useState<string | null>(null);
  const [birthDate, setBirthDate] = useState<string | null>(null);
  const [birthYear, setBirthYear] = useState('');
  const [birthMonth, setBirthMonth] = useState('');
  const [birthDay, setBirthDay] = useState('');

  const [savedNick, setSavedNick] = useState<string>(() => {
    try {
      const id = localStorage.getItem('userId');
      return (id && localStorage.getItem(`nickname_${id}`)) || '';
    } catch { return ''; }
  });
  const [savedGender, setSavedGender] = useState<string | null>(null);
  const [savedBirthDate, setSavedBirthDate] = useState<string | null>(null);
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileSaveOk, setProfileSaveOk] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState<CabinetSection | null>(null);
  const [confirmLeaveFinanceSub, setConfirmLeaveFinanceSub] = useState<'topup' | 'withdraw' | undefined>(undefined);
  const [hasSupportUnread, setHasSupportUnread] = useState(false);
  const [showPasswordForm, setShowPasswordForm] = useState(false);
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [profileError, setProfileError] = useState('');
  const [retryTrigger, setRetryTrigger] = useState(0);
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const [logoutDropdownOpen, setLogoutDropdownOpen] = useState(false);
  const logoutDropdownRef = useRef<HTMLDivElement>(null);

  const returnToAdmin = () => {
    const adminToken = localStorage.getItem('adminToken');
    if (!adminToken) return;
    localStorage.removeItem('adminToken');
    localStorage.setItem('token', adminToken);
    window.dispatchEvent(new CustomEvent('token-refresh', { detail: adminToken }));
    navigate('/admin?tab=users');
    window.location.reload();
  };
  const [showStartGameConfirm, setShowStartGameConfirm] = useState(false);
  const [pendingStartGameAction, setPendingStartGameAction] = useState<(() => void) | null>(null);
  const [, setHashVersion] = useState(0);
  useEffect(() => {
    const syncStatsModeFromHash = () => {
      const hash = typeof window !== 'undefined' ? window.location.hash.replace(/^#/, '') : '';
      if (getHashBase(hash).split('-')[0] === 'statistics') {
        setStatsMode(getStatsModeFromHash(hash));
      }
    };
    syncStatsModeFromHash();
    const onHashChange = () => {
      setHashVersion((v) => v + 1);
      syncStatsModeFromHash();
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  // Пинг «в личном кабинете» для подсчёта онлайн по лигам (пропускаем при импeрсонации админом)
  useEffect(() => {
    if (!token || isImpersonating) return;
    const ping = () => {
      axios.post('/users/me/cabinet-ping', {}, { headers: { Authorization: `Bearer ${token}` } }).catch(() => {});
    };
    ping();
    const interval = setInterval(ping, 60 * 1000);
    return () => clearInterval(interval);
  }, [token, isImpersonating]);

  // Общая статистика для хедера (онлайн) и вкладки «Общая» — один источник данных, обновляется раз в минуту
  useEffect(() => {
    if (!token || !user) return;
    const fetchGlobal = () => {
      axios.get<{ totalUsers: number; onlineCount: number; totalEarnings: number; totalGamesPlayed: number; totalTournaments: number; totalWithdrawn: number }>('/users/global-stats', { headers: { Authorization: `Bearer ${token}` } })
        .then((res) => setGlobalStats(res.data))
        .catch(() => {});
    };
    fetchGlobal();
    const interval = setInterval(fetchGlobal, 60 * 1000);
    return () => clearInterval(interval);
  }, [token, user]);

  // Тренировка: данные турнира и прогресс
  const [trainingData, setTrainingData] = useState<TrainingData | null>(null);
  const [trainingLoading, setTrainingLoading] = useState(false);
  const [trainingError, setTrainingError] = useState('');
  const [trainingRound, setTrainingRound] = useState<TrainingRound | null>(null);
  const [trainingQuestionIndex, setTrainingQuestionIndex] = useState(0);
  const [trainingAnswers, setTrainingAnswers] = useState<number[]>([]);
  const [fullAnswersChosen, _setFullAnswersChosen] = useState<number[]>([]);
  const fullAnswersChosenRef = useRef<number[]>([]);
  const setFullAnswersChosen = (val: number[] | ((prev: number[]) => number[])) => {
    if (typeof val === 'function') {
      _setFullAnswersChosen((prev) => { const next = val(prev); fullAnswersChosenRef.current = next; return next; });
    } else {
      fullAnswersChosenRef.current = val;
      _setFullAnswersChosen(val);
    }
  };
  const [trainingRoundScores, setTrainingRoundScores] = useState<number[]>([]);
  const [trainingRoundComplete, setTrainingRoundComplete] = useState(false);
  const [answerForCurrentQuestion, setAnswerForCurrentQuestion] = useState<number | null>(null);
  const [trainingCorrectCount, setTrainingCorrectCount] = useState(0);
  const [tiebreakerBase, setTiebreakerBase] = useState(0);
  const QUESTION_TIMER_SEC = 5;
  const [timeLeft, setTimeLeft] = useState(QUESTION_TIMER_SEC);
  const timeLeftRef = useRef(QUESTION_TIMER_SEC);
  useEffect(() => {
    timeLeftRef.current = timeLeft;
  }, [timeLeft]);
  const trainingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [blinkKey, setBlinkKey] = useState(0);
  const [timerKey, setTimerKey] = useState(0);
  const timerStartRef = useRef<number>(Date.now());
  const timerPaused = answerForCurrentQuestion !== null;
  const [continueTrainingLoading, setContinueTrainingLoading] = useState<number | null>(null);
  const [continueTrainingError, setContinueTrainingError] = useState('');

  // Турнир на людей: слот в ожидающем турнире
  const [tournamentJoinInfo, setTournamentJoinInfo] = useState<{
    tournamentId: number;
    playerSlot: number;
    totalPlayers: number;
    semiIndex: number;
    positionInSemi: number;
    isCreator: boolean;
    deadline: string;
  } | null>(null);
  const [tournamentJoinLoading, setTournamentJoinLoading] = useState(false);
  const tournamentJoinInProgressRef = useRef(false);
  const [tournamentJoinError, setTournamentJoinError] = useState('');
  const [continueTournamentLoading, setContinueTournamentLoading] = useState<number | null>(null);
  const [continueTournamentError, setContinueTournamentError] = useState('');
  const [selectedLeague, setSelectedLeague] = useState<number>(() => {
    if (typeof window === 'undefined') return 5;
    const saved = localStorage.getItem(SELECTED_LEAGUE_STORAGE_KEY);
    const num = saved ? parseInt(saved, 10) : NaN;
    return !Number.isNaN(num) && num > 0 ? num : 5;
  });
  const [readNewsIds, setReadNewsIds] = useState<number[]>([]);
  const [apiNews, setApiNews] = useState<{ id: number; topic: string; body: string; createdAt: string }[]>([]);
  const [allLeagues, setAllLeagues] = useState<number[]>([5, 10, 20, 50, 100, 200, 500]);
  const [allowedLeagues, setAllowedLeagues] = useState<number[]>([]);
  const [leagueWins, setLeagueWins] = useState<Record<number, number>>({});
  const [playersOnlineByLeague, setPlayersOnlineByLeague] = useState<Record<number, number>>({});
  const [allowedLeaguesLoading, setAllowedLeaguesLoading] = useState(false);
  const [leagueCarouselIndex, setLeagueCarouselIndex] = useState(0);
  const selectedLeagueRef = useRef(5);

  const [gameHistory, setGameHistory] = useState<{
    active: { id: number; status: string; createdAt: string; playersCount: number; deadline?: string; userStatus?: 'passed' | 'not_passed'; stage?: string; resultLabel?: string; roundForQuestions?: 'semi' | 'final' }[];
    completed: { id: number; status: string; createdAt: string; playersCount: number; userStatus?: 'passed' | 'not_passed'; stage?: string; resultLabel?: string; roundForQuestions?: 'semi' | 'final' }[];
  } | null>(null);

  const [bracketOpenSource, setBracketOpenSource] = useState<'active' | 'completed' | null>(null);
  const [bracketView, setBracketView] = useState<{
    tournamentId: number;
    semi1: { players: { id: number; username: string; nickname?: string | null; semiScore?: number; questionsAnswered?: number; correctAnswersCount?: number; isLoser?: boolean; tiebreakerRound?: number; tiebreakerAnswered?: number; tiebreakerCorrect?: number }[] };
    semi2: { players: { id: number; username: string; nickname?: string | null; semiScore?: number; questionsAnswered?: number; correctAnswersCount?: number; isLoser?: boolean; tiebreakerRound?: number; tiebreakerAnswered?: number; tiebreakerCorrect?: number }[] } | null;
    final: { players: { id: number; username: string; nickname?: string | null; finalScore?: number; finalAnswered?: number; finalCorrect?: number }[] };
    gameType: string | null;
    status: string;
    isCompleted?: boolean;
    isActive?: boolean;
  } | null>(null);
  const [bracketLoading, setBracketLoading] = useState(false);
  const [bracketError, setBracketError] = useState('');
  const [bracketPlayerTooltip, setBracketPlayerTooltip] = useState<{
    playerId: number;
    displayName: string;
    avatarUrl: string | null;
    stats: PlayerStats;
    rect: DOMRect;
  } | null>(null);
  const bracketLeftColRef = useRef<HTMLDivElement>(null);
  const bracketFinalBlockRef = useRef<HTMLDivElement>(null);
  const [bracketBlocksEqualized, setBracketBlocksEqualized] = useState(false);

  useEffect(() => {
    if (!bracketView) {
      setBracketBlocksEqualized(false);
      return;
    }
    let rafId: number;
    const run = () => {
      const leftCol = bracketLeftColRef.current;
      const finalBlock = bracketFinalBlockRef.current;
      if (!leftCol || !finalBlock) return;
      const w1 = leftCol.offsetWidth;
      const w2 = finalBlock.offsetWidth;
      const maxW = Math.max(w1, w2, 200);
      leftCol.style.width = `${maxW}px`;
      finalBlock.style.width = `${maxW}px`;
      setBracketBlocksEqualized(true);
    };
    rafId = requestAnimationFrame(() => {
      requestAnimationFrame(run);
    });
    return () => cancelAnimationFrame(rafId);
  }, [bracketView]);

  const [questionsReviewTournamentId, setQuestionsReviewTournamentId] = useState<number | null>(null);
  const [questionsReviewRound, setQuestionsReviewRound] = useState<'semi' | 'final'>('semi');
  const [questionsReviewData, setQuestionsReviewData] = useState<{
    questionsSemi1: { id: number; question: string; options: string[]; correctAnswer: number }[];
    questionsSemi2: { id: number; question: string; options: string[]; correctAnswer: number }[];
    questionsFinal: { id: number; question: string; options: string[]; correctAnswer: number }[];
    questionsAnsweredCount: number;
    correctAnswersCount: number;
    semiFinalCorrectCount?: number | null;
    answersChosen: number[];
    userSemiIndex?: number;
  } | null>(null);
  const [questionsReviewLoading, setQuestionsReviewLoading] = useState(false);
  const [questionsReviewError, setQuestionsReviewError] = useState('');

  const [referralCode, setReferralCode] = useState<string | null>(null);
  const [referralLinkCopied, setReferralLinkCopied] = useState(false);
  const [referralTree, setReferralTree] = useState<{ rootUserId?: number; levels: { id: number; displayName: string; referrerId: number | null }[][] } | null>(null);
  const [referralTreeLoading, setReferralTreeLoading] = useState(false);
  const [referralTreeError, setReferralTreeError] = useState('');
  const [partnerDetailExpandedIds, setPartnerDetailExpandedIds] = useState<Set<number>>(new Set());
  const [partnerPlayerTooltip, setPartnerPlayerTooltip] = useState<{
    playerId: number;
    displayName: string;
    avatarUrl: string | null;
    stats: PlayerStats;
    rect: DOMRect;
  } | null>(null);
  const referralModalData = useMemo(() => {
    if (!user?.id || !referralTree) return null;
    const levels = Array.isArray(referralTree.levels) ? referralTree.levels : [];
    const rootId = referralTree.rootUserId ?? Number(user.id);
    const rootDisplayName = String((user as { nickname?: string; username?: string }).nickname?.trim() || (user as { username?: string }).username || user.id || 'Вы');
    type Node = PartnerDetailNode;
    const findDepth = (id: number): number => {
      if (id === rootId) return -1;
      for (let L = 0; L < levels.length; L++) {
        const arr = Array.isArray(levels[L]) ? levels[L] : [];
        if (arr.some((x) => Number(x.id) === id)) return L;
      }
      return -1;
    };
    const buildSubtree = (fromId: number, fromDisplayName: string): Node[][] => {
      const depth = findDepth(fromId);
      const rootNode: Node = { id: fromId, displayName: fromDisplayName, referrerId: null };
      if (depth < 0) {
        return [ [rootNode], ...levels.map((arr) => (Array.isArray(arr) ? arr : []).map((x: any) => ({ id: Number(x.id), displayName: String(x.displayName ?? x.id), referrerId: x.referrerId != null ? Number(x.referrerId) : null, avatarUrl: x.avatarUrl ?? null }))) ];
      }
      const subtreeLevels: Node[][] = [[rootNode]];
      let currentIds: number[] = [fromId];
      for (let L = depth + 1; L < levels.length && currentIds.length > 0; L++) {
        const arr = Array.isArray(levels[L]) ? levels[L] : [];
        const parentIds = currentIds;
        const nodes = arr.filter((x) => parentIds.includes(Number(x.referrerId))).map((x: any) => ({ id: Number(x.id), displayName: String(x.displayName ?? x.id), referrerId: x.referrerId != null ? Number(x.referrerId) : null, avatarUrl: x.avatarUrl ?? null }));
        subtreeLevels.push(nodes);
        currentIds = nodes.map((n) => n.id);
      }
      return subtreeLevels;
    };
    const subtreeLevels = buildSubtree(rootId, rootDisplayName);
    const levelsForDisplay = subtreeLevels.slice(1);
    const expandedIds = partnerDetailExpandedIds;
    const COL_COUNT = 10;
    const grid: (Node | null)[][] = [];
    const ensureRow = (r: number) => { while (grid.length <= r) grid.push(Array(COL_COUNT).fill(null)); };
    const visit = (r: number, levelIndex: number, node: Node): number => {
      ensureRow(r);
      grid[r][levelIndex] = node;
      if (!expandedIds.has(node.id) || levelIndex + 1 >= levelsForDisplay.length) return r + 1;
      const children = (levelsForDisplay[levelIndex + 1] ?? []).filter((n) => Number(n.referrerId) === node.id);
      if (children.length === 0) return r + 1;
      let nextR = visit(r, levelIndex + 1, children[0]);
      for (let i = 1; i < children.length; i++) nextR = visit(nextR, levelIndex + 1, children[i]);
      return nextR;
    };
    let row = 0;
    (levelsForDisplay[0] ?? []).forEach((node) => {
      row = visit(row, 0, node);
    });
    const hasChildren = (levelIndex: number, nodeId: number) =>
      (levelsForDisplay[levelIndex + 1] ?? []).some((n) => Number(n.referrerId) === nodeId);
    const getDescendantCount = (nodeId: number, levelIndex: number): number => {
      if (levelIndex + 1 >= levelsForDisplay.length) return 0;
      const children = (levelsForDisplay[levelIndex + 1] ?? []).filter((n) => Number(n.referrerId) === nodeId);
      return children.length + children.reduce((sum, c) => sum + getDescendantCount(c.id, levelIndex + 1), 0);
    };
    return { rowGrid: grid, subtreeLevels: levelsForDisplay, hasChildren, getDescendantCount };
  }, [referralTree, partnerDetailExpandedIds, user]);

  const [statsMode, setStatsMode] = useState<'personal' | 'general'>(() =>
    typeof window !== 'undefined' ? getStatsModeFromHash(window.location.hash.replace(/^#/, '')) : 'personal',
  );
  const [rankingMetric, setRankingMetric] = useState<'gamesPlayed' | 'wins' | 'totalWinnings' | 'correctAnswers' | 'correctAnswerRate' | 'referrals' | 'totalWithdrawn'>('gamesPlayed');
  const [rankings, setRankings] = useState<null | {
    rankings: { rank: number; userId: number; displayName: string; value: number; valueFormatted: string }[];
    myRank: number | null;
    myValue: number | null;
    totalParticipants: number;
  }>(null);
  const [rankingsError, setRankingsError] = useState('');
  const [globalStats, setGlobalStats] = useState<null | { totalUsers: number; onlineCount: number; totalEarnings: number; totalGamesPlayed: number; totalTournaments: number; totalWithdrawn: number }>(null);
  const [globalStatsLoading, setGlobalStatsLoading] = useState(false);
  const [globalStatsError, setGlobalStatsError] = useState('');
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const notificationsRef = useRef<HTMLDivElement>(null);
  const cabinetMainWrapRef = useRef<HTMLDivElement>(null);
  const [stats, setStats] = useState<null | {
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
  }>(null);
  const [statsError, setStatsError] = useState('');
  const [chartData, setChartData] = useState<{ date: string; value: number }[]>([]);
  const [chartMetric, setChartMetric] = useState<'gamesPlayed' | 'wins' | 'totalWinnings' | 'correctAnswers'>('gamesPlayed');
  const [chartGameType, setChartGameType] = useState<'training' | 'money' | 'all'>('all');
  const [chartFrom, setChartFrom] = useState(() => {
    const d = parseMoscowDate(toMoscowDateStr());
    d.setDate(d.getDate() - 13);
    return toMoscowDateStr(d);
  });
  const [chartTo, setChartTo] = useState(() => toMoscowDateStr());

  const [partnerChartData, setPartnerChartData] = useState<{ date: string; value: number }[]>([]);
  const [partnerChartMetric, setPartnerChartMetric] = useState<'referralCount' | 'referralEarnings'>('referralCount');
  const [partnerChartFrom, setPartnerChartFrom] = useState(() => {
    const d = parseMoscowDate(toMoscowDateStr());
    d.setDate(d.getDate() - 29);
    return toMoscowDateStr(d);
  });
  const [partnerChartTo, setPartnerChartTo] = useState(() => toMoscowDateStr());

  useEffect(() => {
    if (user) {
      requestAnimationFrame(() => window.dispatchEvent(new CustomEvent('cabinet-ready')));
    }
  }, [user]);


  const NOTIFICATIONS_STORAGE_KEY = 'cabinet_notifications';
  const welcomeAddedRef = useRef(false);
  useEffect(() => {
    if (!user?.id) return;
    try {
      const raw = localStorage.getItem(`${NOTIFICATIONS_STORAGE_KEY}_${user.id}`);
      const list = raw ? (JSON.parse(raw) as NotificationItem[]) : [];
      const loaded = Array.isArray(list) ? list : [];
      const welcomeKey = `cabinet_welcome_shown_${user.id}`;
      if (loaded.length === 0 && !localStorage.getItem(welcomeKey) && !welcomeAddedRef.current) {
        welcomeAddedRef.current = true;
        localStorage.setItem(welcomeKey, '1');
        const welcome: NotificationItem = {
          id: `n_${Date.now()}_welcome`,
          type: 'system',
          title: 'Добро пожаловать!',
          text: 'Здесь будут отображаться уведомления о статусе игр, победах и других событиях.',
          createdAt: new Date().toISOString(),
          read: false,
        };
        setNotifications([welcome]);
      } else {
        setNotifications(loaded);
      }
    } catch {
      setNotifications([]);
    }
  }, [user?.id]);

  useEffect(() => {
    if (!user?.id || notifications.length === 0) return;
    try {
      localStorage.setItem(`${NOTIFICATIONS_STORAGE_KEY}_${user.id}`, JSON.stringify(notifications));
    } catch {
      /* ignore */
    }
  }, [user?.id, notifications]);

  useEffect(() => {
    if (!token) return;
    const check = () => {
      axios.get<{ unread: boolean }>('/support/unread', { headers: { Authorization: `Bearer ${token}` } })
        .then((r) => setHasSupportUnread(r.data.unread))
        .catch(() => {});
    };
    check();
    const iv = setInterval(check, 10000);
    return () => clearInterval(iv);
  }, [token]);

  const addNotification = React.useCallback((n: Omit<NotificationItem, 'id' | 'createdAt' | 'read'>) => {
    const now = Date.now();
    setNotifications((prev) => {
      const item: NotificationItem = {
        ...n,
        id: `n_${now}_${Math.random().toString(36).slice(2, 9)}`,
        createdAt: new Date().toISOString(),
        read: false,
      };
      return [item, ...prev].slice(0, 100);
    });
  }, []);

  const markNotificationsRead = React.useCallback(() => {
    setNotifications((prev) => prev.map((p) => ({ ...p, read: true })));
  }, []);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (notificationsOpen && notificationsRef.current && !notificationsRef.current.contains(e.target as Node)) {
        setNotificationsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [notificationsOpen]);

  const authHeaders = useMemo(() => ({ headers: { Authorization: `Bearer ${token}` } as const }), [token]);

  useEffect(() => {
    const fetchProfile = async () => {
      try {
        setProfileError('');
        const response = await axios.get('/users/profile', authHeaders);
        const data = response?.data;
        if (!data || typeof data !== 'object') {
          setProfileError('Сервер вернул пустой ответ. Попробуйте обновить страницу.');
          return;
        }
        setUser(data);
        const isAdmin = data.isAdmin === true || data.isAdmin === 1 || data.isAdmin === '1' || !!data.isAdmin;
        setShowAdminLink(!!isAdmin);
        if (data.id != null) localStorage.setItem('userId', String(data.id));
        if (data.avatarUrl) setAvatar(data.avatarUrl);
        const backendNick = data.nickname;
        const savedNickname = backendNick ?? (data.id != null ? localStorage.getItem(`nickname_${data.id}`) : null);
        const nickVal = savedNickname ?? '';
        setNickname(nickVal);
        setSavedNick(nickVal);
        const genderVal = data.gender ?? null;
        setGender(genderVal);
        setSavedGender(genderVal);
        const bdVal = data.birthDate ?? null;
        setBirthDate(bdVal);
        setSavedBirthDate(bdVal);
        if (bdVal) {
          const p = bdVal.split('-');
          if (p[0]) setBirthYear(p[0]);
          if (p[1]) setBirthMonth(String(Number(p[1])));
          if (p[2]) setBirthDay(String(Number(p[2])));
        }
        if (Array.isArray(data.readNewsIds)) {
          setReadNewsIds(data.readNewsIds);
        }
      } catch (err: unknown) {
        const ax = err && typeof err === 'object' && 'isAxiosError' in err && (err as { isAxiosError?: boolean }).isAxiosError;
        const status = ax && err && typeof err === 'object' && 'response' in err ? (err as { response?: { status?: number } }).response?.status : undefined;
        const msg = ax && err && typeof err === 'object' && 'message' in err ? (err as { message?: string }).message : '';
        if (status === 401) {
          setProfileError('Сессия истекла. Выйдите и войдите снова.');
        } else if (msg === 'Network Error' || !status) {
          setProfileError('Сервер временно недоступен. Попробуйте обновить страницу или зайти позже.');
        } else {
          setProfileError(`Не удалось загрузить профиль. Ошибка: ${status || msg}. Проверьте соединение или попробуйте позже.`);
        }
        return;
      }
    };

    const fetchTransactions = async () => {
      try {
        const response = await axios.get('/users/transactions', authHeaders);
        setTransactions(filterRejectedWithdrawalRefunds(response.data ?? []));
      } catch (error) {
        console.error('Не удалось загрузить транзакции');
      } finally {
        setTransactionsLoaded(true);
      }
    };

    fetchProfile();
    fetchTransactions();
  }, [authHeaders, retryTrigger]);

  useEffect(() => {
    if (user || profileError) return;
    const t = setTimeout(() => {
      setProfileError('Загрузка заняла слишком много времени. Проверьте соединение или перейдите на страницу входа.');
    }, 20000);
    return () => clearTimeout(t);
  }, [user, profileError]);

  useEffect(() => {
    if (!logoutDropdownOpen) return;
    const close = (e: MouseEvent) => {
      if (logoutDropdownRef.current && !logoutDropdownRef.current.contains(e.target as Node)) {
        setLogoutDropdownOpen(false);
      }
    };
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, [logoutDropdownOpen]);

  const fetchGameHistory = React.useCallback((mode: 'training' | 'money', currentTournamentId?: number) => {
    if (!token) return;
    const params = new URLSearchParams({ mode });
    if (currentTournamentId) params.set('currentTournamentId', String(currentTournamentId));
    axios.get<{
      active: { id: number; status: string; createdAt: string; playersCount: number; deadline?: string; userStatus?: 'passed' | 'not_passed'; stage?: string; resultLabel?: string }[];
      completed: { id: number; status: string; createdAt: string; playersCount: number; userStatus?: 'passed' | 'not_passed'; stage?: string; resultLabel?: string }[];
    }>(`/tournaments/my?${params}`, { headers: { Authorization: `Bearer ${token}` } })
      .then((res) => setGameHistory(res.data))
      .catch(() => setGameHistory({ active: [], completed: [] }));
  }, [token]);

  useEffect(() => {
    const inGamesSection = section === 'games' || section === 'games-training' || section === 'games-money';
    if (inGamesSection && token && (gameMode === 'training' || gameMode === 'money')) {
      const currentId = gameMode === 'training' ? trainingData?.tournamentId : undefined;
      fetchGameHistory(gameMode, currentId);
    }
  }, [section, token, gameMode, fetchGameHistory, trainingData?.tournamentId]);

  useEffect(() => {
    if (section === 'games' && gameMode === 'training') {
      window.scrollTo(0, 0);
      requestAnimationFrame(() => {
        document.documentElement.scrollTop = 0;
        document.body.scrollTop = 0;
        cabinetMainWrapRef.current?.scrollTo(0, 0);
        const content = document.querySelector('.cabinet-content');
        if (content && 'scrollTop' in content) (content as HTMLElement).scrollTop = 0;
      });
    }
  }, [section, gameMode]);

  useEffect(() => {
    selectedLeagueRef.current = selectedLeague;
  }, [selectedLeague]);

  useEffect(() => {
    if (gameMode === 'money' && selectedLeague) {
      localStorage.setItem(SELECTED_LEAGUE_STORAGE_KEY, String(selectedLeague));
    }
  }, [gameMode, selectedLeague]);

  useEffect(() => {
    const saveOnUnload = () => {
      if (gameMode === 'money' && selectedLeagueRef.current) {
        localStorage.setItem(SELECTED_LEAGUE_STORAGE_KEY, String(selectedLeagueRef.current));
      }
    };
    window.addEventListener('beforeunload', saveOnUnload);
    window.addEventListener('pagehide', saveOnUnload);
    return () => {
      window.removeEventListener('beforeunload', saveOnUnload);
      window.removeEventListener('pagehide', saveOnUnload);
    };
  }, [gameMode]);

  useEffect(() => {
    if (gameMode !== 'money' || !token) {
      setAllowedLeagues([]);
      setAllLeagues([5, 10, 20, 50, 100, 200, 500]);
      return;
    }
    if (!allLeagues || allLeagues.length === 0) setAllowedLeaguesLoading(true);
    axios
      .get<{ allLeagues?: number[]; allowedLeagues: number[]; balance: number; leagueWins: Record<number, number>; playersOnlineByLeague?: Record<number, number> }>('/tournaments/allowed-leagues', {
        headers: { Authorization: `Bearer ${token}` },
      })
      .then((res) => {
        const list = res.data.allowedLeagues ?? [];
        const fullList = Array.isArray(res.data.allLeagues) && res.data.allLeagues.length > 0
          ? res.data.allLeagues
          : [5, 10, 20, 50, 100, 200, 500];
        setAllowedLeagues(list);
        setAllLeagues(fullList);
        setLeagueWins(res.data.leagueWins ?? {});
        setPlayersOnlineByLeague(res.data.playersOnlineByLeague ?? {});
        const saved = localStorage.getItem(SELECTED_LEAGUE_STORAGE_KEY);
        const savedNum = saved ? parseInt(saved, 10) : NaN;
        const savedIdx = fullList.indexOf(savedNum);
        if (!Number.isNaN(savedNum) && savedIdx >= 0) {
          setSelectedLeague(savedNum);
          setLeagueCarouselIndex(savedIdx);
        } else {
          const fallback = list[0] ?? fullList[0] ?? 5;
          const fallbackIdx = fullList.indexOf(fallback);
          setSelectedLeague(fallback);
          setLeagueCarouselIndex(fallbackIdx >= 0 ? fallbackIdx : 0);
        }
      })
      .catch(() => {
        setAllowedLeagues([]);
        setLeagueWins({});
        setPlayersOnlineByLeague({});
      })
      .finally(() => setAllowedLeaguesLoading(false));
  }, [gameMode, token]);

  useEffect(() => {
    if (section === 'finance' || section === 'finance-topup' || section === 'finance-withdraw') {
      axios.get<{ yookassa: boolean; robokassa: boolean }>('/payments/providers')
        .then((res) => {
          setPaymentProviders(res.data);
          if (res.data.yookassa && !res.data.robokassa) setTopupProvider('yookassa');
          else if (res.data.robokassa) setTopupProvider('robokassa');
        })
        .catch(() => setPaymentProviders({ yookassa: false, robokassa: false }));
    }
  }, [section]);

  const fetchMyWithdrawalRequests = () => {
    if (!token) return;
    axios.get<{ id: number; amount: number; details: string | null; status: string; createdAt: string }[]>('/users/withdrawal-requests', { headers: { Authorization: `Bearer ${token}` } })
      .then((res) => setMyWithdrawalRequests(Array.isArray(res.data) ? res.data : []))
      .catch(() => setMyWithdrawalRequests([]));
  };

  useEffect(() => {
    if ((section === 'finance' || section === 'finance-topup' || section === 'finance-withdraw') && token) {
      fetchMyWithdrawalRequests();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [section, token]);

  useEffect(() => {
    if (section === 'partner' && token) {
      axios.get<{ referralCode: string }>('/users/referral-code', { headers: { Authorization: `Bearer ${token}` } })
        .then((res) => setReferralCode(res.data.referralCode))
        .catch(() => setReferralCode(null));
      setReferralTreeError('');
      if (!referralTree) setReferralTreeLoading(true);
      const treeUrl = `/users/referral-tree?t=${Date.now()}`;
      axios.get<{ rootUserId?: number; levels: { id: number; displayName: string; referrerId: number | null }[][] }>(treeUrl, { headers: { Authorization: `Bearer ${token}` } })
        .then(async (res) => {
          const data = res.data;
          const rootId = data.rootUserId ?? Number(user?.id) ?? 0;
          setReferralTree({ ...data, rootUserId: rootId });
          // Auto-seeding disabled for production
        })
        .catch((e) => {
          setReferralTree(null);
          setReferralTreeError(e?.response?.data?.message || e?.message || 'Не удалось загрузить древо рефералов');
        })
        .finally(() => setReferralTreeLoading(false));
    }
  }, [section, token, user?.id]);

  useEffect(() => {
    if ((section !== 'statistics' && section !== 'profile') || !token) return;
    setStatsError('');
    const fetchStats = (authToken: string) =>
      axios.get<{
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
    }>('/users/me/stats', { headers: { Authorization: `Bearer ${authToken}` } });
    fetchStats(token)
      .then((res) => setStats(res.data))
      .catch(async (e) => {
        const status = e?.response?.status;
        if (status === 401) {
          try {
            const { data } = await axios.get<{ access_token: string }>('/auth/refresh', {
              headers: { Authorization: `Bearer ${token}` },
            });
            const newToken = data.access_token;
            localStorage.setItem('token', newToken);
            window.dispatchEvent(new CustomEvent('token-refresh', { detail: newToken }));
            const retryRes = await fetchStats(newToken);
            setStats(retryRes.data);
            return;
          } catch {
            /* fall through to error */
          }
        }
        setStats(null);
        const msg = e?.response?.data?.message || e?.message || 'Не удалось загрузить статистику';
        setStatsError(typeof msg === 'string' ? msg : 'Не удалось загрузить статистику');
      });
  }, [section, token]);

  useEffect(() => {
    if ((section !== 'statistics' || statsMode !== 'general') || !token) return;
    if (globalStats) return;
    setGlobalStatsError('');
    setGlobalStatsLoading(true);
    axios.get<{ totalUsers: number; onlineCount: number; totalEarnings: number; totalGamesPlayed: number; totalTournaments: number; totalWithdrawn: number }>('/users/global-stats', { headers: { Authorization: `Bearer ${token}` } })
      .then((res) => setGlobalStats(res.data))
      .catch((e) => {
        setGlobalStats(null);
        setGlobalStatsError(e?.response?.data?.message || e?.message || 'Не удалось загрузить общую статистику');
      })
      .finally(() => setGlobalStatsLoading(false));
  }, [section, token, statsMode, globalStats]);

  useEffect(() => {
    if ((section !== 'statistics' || statsMode !== 'general') || !token) return;
    setRankingsError('');
    axios.get<{
      rankings: { rank: number; userId: number; displayName: string; value: number; valueFormatted: string }[];
      myRank: number | null;
      myValue: number | null;
      totalParticipants: number;
    }>(`/users/rankings?metric=${rankingMetric}`, { headers: { Authorization: `Bearer ${token}` } })
      .then((res) => setRankings(res.data))
      .catch((e) => {
        setRankings(null);
        setRankingsError(e?.response?.data?.message || e?.message || 'Не удалось загрузить рейтинг');
      });
  }, [section, token, statsMode, rankingMetric]);

  useEffect(() => {
    if ((section !== 'statistics' || statsMode !== 'personal') || !token) return;
    axios.get<{ data: { date: string; value: number }[]; availableMetrics: string[] }>(
      `/users/me/stats-by-day?from=${chartFrom}&to=${chartTo}&metric=${chartMetric}&gameType=${chartGameType}`,
      { headers: { Authorization: `Bearer ${token}` } },
    )
      .then((res) => setChartData(res.data.data || []))
      .catch(() => setChartData([]));
  }, [section, token, statsMode, chartFrom, chartTo, chartMetric, chartGameType]);

  useEffect(() => {
    if (section !== 'partner-statistics' || !token) return;
    axios.get<{ data: { date: string; value: number }[] }>(
      `/users/me/referral-stats-by-day?from=${partnerChartFrom}&to=${partnerChartTo}&metric=${partnerChartMetric}`,
      { headers: { Authorization: `Bearer ${token}` } },
    )
      .then((res) => setPartnerChartData(res.data.data || []))
      .catch(() => setPartnerChartData([]));
  }, [section, token, partnerChartFrom, partnerChartTo, partnerChartMetric]);

  useEffect(() => {
    if (user && nickname === '' && !isEditingName) setIsEditingName(true);
  }, [user, nickname, isEditingName]);

  const getTrainingQuestions = (round: TrainingRound): TrainingQuestion[] => {
    if (!trainingData) return [];
    if (round === 0) return trainingData.questionsSemi1;
    if (round === 1) return trainingData.questionsSemi2;
    if (round === 3) return trainingData.questionsTiebreaker;
    return trainingData.questionsFinal;
  };

  const startTraining = async () => {
    setTrainingLoading(true);
    setTrainingError('');
    try {
      const { data } = await axios.post<{
        tournamentId: number;
        deadline: string;
        questionsSemi1: TrainingQuestion[];
        questionsSemi2: TrainingQuestion[];
        questionsFinal: TrainingQuestion[];
        playerSlot?: number;
        totalPlayers?: number;
        semiIndex?: number;
        isCreator?: boolean;
      }>('/tournaments/training/start', {}, { headers: { Authorization: `Bearer ${token}` } });
      setTrainingData({
        tournamentId: data.tournamentId,
        deadline: data.deadline,
        questionsSemi1: data.questionsSemi1,
        questionsSemi2: data.questionsSemi2,
        questionsFinal: data.questionsFinal,
        questionsTiebreaker: [],
        tiebreakerRound: 0,
        tiebreakerBase: 0,
        tiebreakerPhase: null,
      });
      setTournamentJoinInfo({
        tournamentId: data.tournamentId,
        playerSlot: data.playerSlot ?? 0,
        totalPlayers: data.totalPlayers ?? 1,
        semiIndex: data.semiIndex ?? 0,
        positionInSemi: 0,
        isCreator: data.isCreator ?? true,
        deadline: data.deadline,
      });
      completedForfeitRef.current = false;
      const playersMsg = data.totalPlayers && data.totalPlayers > 1 ? ` Игроков: ${data.totalPlayers}/4.` : ' Ожидайте соперников.';
      addNotification({ type: 'game_started', title: 'Тренировка началась', text: `Турнир создан.${playersMsg} Ответьте на вопросы полуфинала.`, meta: { goToGames: true, gameMode: 'training' } });
      const semiIdx = data.semiIndex ?? 0;
      setTrainingRound(semiIdx === 0 ? 0 : 1);
      setTrainingQuestionIndex(0);
      setTrainingAnswers([]);
      setFullAnswersChosen([]);
      setTrainingRoundScores([]);
      setTrainingRoundComplete(false);
      setAnswerForCurrentQuestion(null);
      setTrainingCorrectCount(0);
      timeLeftRef.current = QUESTION_TIMER_SEC;
      setTimeLeft(QUESTION_TIMER_SEC);
    } catch (e: any) {
      setTrainingError(e?.response?.data?.message || 'Не удалось начать тренировку');
    } finally {
      setTrainingLoading(false);
    }
  };

  const currentQuestions = trainingRound !== null ? getTrainingQuestions(trainingRound) : [];
  const currentQuestion = currentQuestions[trainingQuestionIndex];
  const isLastQuestion = currentQuestions.length > 0 && trainingQuestionIndex === currentQuestions.length - 1;
  const answered = answerForCurrentQuestion !== null;
  const isCorrect = currentQuestion && answerForCurrentQuestion !== null && answerForCurrentQuestion >= 0 && currentQuestion.correctAnswer === answerForCurrentQuestion;

  const [, setDeadlineTick] = useState(0);
  const trainingDeadline = trainingData?.deadline;
  const isForfeited = trainingDeadline ? new Date() > new Date(trainingDeadline) : false;
  const completedForfeitRef = useRef(false);
  useEffect(() => {
    if (!trainingDeadline || isForfeited) return;
    const interval = setInterval(() => setDeadlineTick((t) => t + 1), 30_000);
    return () => clearInterval(interval);
  }, [trainingDeadline, isForfeited]);
  useEffect(() => {
    if (isForfeited && trainingData?.tournamentId && token && !completedForfeitRef.current) {
      completedForfeitRef.current = true;
      axios.post(`/tournaments/${trainingData.tournamentId}/complete`, { passed: false }, { headers: { Authorization: `Bearer ${token}` } }).catch(() => {});
      addNotification({ type: 'game_status', title: 'Время вышло', text: 'Турнир завершён по таймауту. Вы не успели ответить на все вопросы.' });
    }
  }, [isForfeited, trainingData?.tournamentId, token, addNotification]);

  const formatTimeLeft = (deadlineStr: string): string => {
    const end = new Date(deadlineStr).getTime();
    const now = Date.now();
    if (now >= end) return '0';
    const ms = end - now;
    const h = Math.floor(ms / (60 * 60 * 1000));
    const m = Math.floor((ms % (60 * 60 * 1000)) / (60 * 1000));
    if (h > 0) return `${h} ч ${m} мин`;
    return `${m} мин`;
  };

  useEffect(() => {
    if (!currentQuestion || trainingRound === null) return;
    if (answerForCurrentQuestion !== null) {
      if (trainingTimerRef.current) {
        clearInterval(trainingTimerRef.current);
        trainingTimerRef.current = null;
      }
      return;
    }
    if (trainingTimerRef.current) clearInterval(trainingTimerRef.current);
    timerStartRef.current = Date.now();
    setTimerKey((k) => k + 1);
    setTimeLeft(QUESTION_TIMER_SEC);
    trainingTimerRef.current = setInterval(() => {
      const elapsed = (Date.now() - timerStartRef.current) / 1000;
      const remaining = Math.max(0, QUESTION_TIMER_SEC - elapsed);
      const rounded = Math.ceil(remaining);
      setTimeLeft(rounded);
      if (remaining <= 0) {
        if (trainingTimerRef.current) clearInterval(trainingTimerRef.current);
        trainingTimerRef.current = null;
        setAnswerForCurrentQuestion(-1);
        setTrainingAnswers((prev) => [...prev, -1]);
        setFullAnswersChosen((prev) => {
          const arr = [...prev];
          const timerBase = trainingRound !== null && trainingRound >= 2 ? 10 : 0;
          const gIdx = timerBase + trainingQuestionIndex;
          while (arr.length <= gIdx) arr.push(-1);
          arr[gIdx] = -1;
          return arr;
        });
        setBlinkKey((k) => k + 1);
      }
    }, 200);
    return () => {
      if (trainingTimerRef.current) clearInterval(trainingTimerRef.current);
      trainingTimerRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trainingRound, trainingQuestionIndex, answerForCurrentQuestion]);

  const chooseTrainingAnswer = (answerIndex: number) => {
    if (answerForCurrentQuestion !== null) return;
    if (trainingTimerRef.current) {
      clearInterval(trainingTimerRef.current);
      trainingTimerRef.current = null;
    }
    const isAnswerCorrect = currentQuestion ? currentQuestion.correctAnswer === answerIndex : false;
    const nextCorrect = trainingCorrectCount + (isAnswerCorrect ? 1 : 0);
    setTrainingCorrectCount(nextCorrect);
    setAnswerForCurrentQuestion(answerIndex);
    setBlinkKey((k) => k + 1);
    const newRoundAnswers = [...trainingAnswers, answerIndex];
    setTrainingAnswers(newRoundAnswers);
    const base = trainingRound === 3 ? tiebreakerBase : (trainingRound !== null && trainingRound >= 2 ? 10 : 0);
    const globalIdx = base + trainingQuestionIndex;
    setFullAnswersChosen((prev) => {
      const arr = [...prev];
      while (arr.length <= globalIdx) arr.push(-1);
      arr[globalIdx] = answerIndex;
      return arr;
    });
    const totalAnswered = base + trainingQuestionIndex + 1;
    const currentIndex = totalAnswered;
    if (trainingData?.tournamentId && token) {
      const cumulative = [...fullAnswersChosenRef.current];
      while (cumulative.length <= globalIdx) cumulative.push(-1);
      cumulative[globalIdx] = answerIndex;
      const body: { count: number; currentIndex: number; timeLeft?: number; correctCount?: number; answersChosen?: number[] } = { count: totalAnswered, currentIndex, timeLeft: QUESTION_TIMER_SEC, correctCount: nextCorrect, answersChosen: cumulative };
      axios.post(`/tournaments/${trainingData.tournamentId}/progress`, body, { headers: { Authorization: `Bearer ${token}` } }).catch(() => {});
    }
  };

  const goToNextQuestion = () => {
    const roundBase = trainingRound === 3 ? tiebreakerBase : (trainingRound !== null && trainingRound >= 2 ? 10 : 0);
    const totalAnswered = roundBase + trainingQuestionIndex + 1;
    const currentIndex = totalAnswered;
    const correctThisRound = isLastQuestion ? currentQuestions.filter((q, i) => q.correctAnswer === trainingAnswers[i]).length : 0;
    const totalCorrectToSend = isLastQuestion ? trainingRoundScores.reduce((a, b) => a + b, 0) + correctThisRound : trainingCorrectCount;
    if (trainingData?.tournamentId && token) {
      axios.post(
        `/tournaments/${trainingData.tournamentId}/progress`,
        { count: totalAnswered, currentIndex, timeLeft: QUESTION_TIMER_SEC, correctCount: totalCorrectToSend, answersChosen: fullAnswersChosenRef.current },
        { headers: { Authorization: `Bearer ${token}` } },
      ).catch(() => {});
    }
    if (isLastQuestion) {
      setTrainingCorrectCount(totalCorrectToSend);
      setTrainingRoundScores((prev) => [...prev, correctThisRound]);
      setTrainingRoundComplete(true);
    } else {
      setTrainingQuestionIndex((i) => i + 1);
      setAnswerForCurrentQuestion(null);
      timeLeftRef.current = QUESTION_TIMER_SEC;
      setTimeLeft(QUESTION_TIMER_SEC);
    }
  };

  const semiScore = trainingRoundScores[0];

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const goNextRound = async () => {
    if (trainingTimerRef.current) clearInterval(trainingTimerRef.current);
    trainingTimerRef.current = null;

    if (trainingRound === 3) {
      addNotification({
        type: 'game_status',
        title: 'Доп. раунд завершён',
        text: 'Результат будет определён после ответа соперника.',
      });
      fetchGameHistory(gameMode === 'money' ? 'money' : 'training');
    } else if (trainingRound === 2) {
      if (trainingData?.tournamentId && token) {
        try {
          await axios.post(`/tournaments/${trainingData.tournamentId}/complete`, { passed: true }, { headers: { Authorization: `Bearer ${token}` } });
          addNotification({
            type: 'win',
            title: gameMode === 'money' ? 'Победа в противостоянии!' : 'Победа в тренировке!',
            text: gameMode === 'money' ? 'Поздравляем! Вы выиграли турнир за деньги. Выигрыш зачислен на баланс.' : 'Поздравляем! Вы успешно прошли тренировочный турнир.',
          });
        } catch (_) {}
        fetchGameHistory(gameMode === 'money' ? 'money' : 'training');
      }
    }
    setTrainingData(null);
    setTournamentJoinInfo(null);
    setTrainingRound(null);
    setTrainingQuestionIndex(0);
    setTrainingAnswers([]);
    setFullAnswersChosen([]);
    setTrainingRoundScores([]);
    setTrainingRoundComplete(false);
    setAnswerForCurrentQuestion(null);
    setTimeLeft(QUESTION_TIMER_SEC);
    setTiebreakerBase(0);
  };

  const resetTraining = async () => {
    saveTrainingProgress();
    if (trainingTimerRef.current) clearInterval(trainingTimerRef.current);
    trainingTimerRef.current = null;
    const tid = trainingData?.tournamentId;
    if (tid && token) {
      try {
        await axios.post(`/tournaments/${tid}/complete`, { passed: false }, { headers: { Authorization: `Bearer ${token}` } });
      } catch (_) {}
      fetchGameHistory('training');
    }
    setTrainingData(null);
    setTrainingRound(null);
    setTrainingQuestionIndex(0);
    setTrainingAnswers([]);
    setFullAnswersChosen([]);
    setTrainingRoundScores([]);
    setTrainingRoundComplete(false);
    setAnswerForCurrentQuestion(null);
    setTimeLeft(QUESTION_TIMER_SEC);
  };

  const joinTournament = async (leagueAmount: number) => {
    if (tournamentJoinInProgressRef.current) return;
    tournamentJoinInProgressRef.current = true;
    setTournamentJoinLoading(true);
    setTournamentJoinError('');
    try {
      const { data } = await axios.post<{
        tournamentId: number;
        playerSlot: number;
        totalPlayers: number;
        semiIndex: number;
        positionInSemi: number;
        isCreator: boolean;
        deadline: string;
      }>('/tournaments/join', { leagueAmount }, { headers: { Authorization: `Bearer ${token}` } });
      setTournamentJoinInfo(data);
      addNotification({ type: 'game_started', title: 'Турнир начался', text: `Вы присоединились к турниру в лиге ${leagueAmount} L. Удачи!`, meta: { goToGames: true, gameMode: 'money' } });
      const { data: trainData } = await axios.get<{
        tournamentId: number;
        deadline: string;
        questionsSemi1: TrainingQuestion[];
        questionsSemi2: TrainingQuestion[];
        questionsFinal: TrainingQuestion[];
        questionsAnsweredCount: number;
        currentQuestionIndex: number;
        timeLeftSeconds: number | null;
        leftAt: string | null;
        correctAnswersCount: number;
        semiFinalCorrectCount: number | null;
        answersChosen?: number[];
        semiResult?: 'playing' | 'won' | 'lost' | 'tie' | 'waiting';
      }>(`/tournaments/${data.tournamentId}/training-state`, { headers: { Authorization: `Bearer ${token}` } });
      setTrainingData({
        tournamentId: trainData.tournamentId,
        deadline: trainData.deadline,
        questionsSemi1: trainData.questionsSemi1,
        questionsSemi2: trainData.questionsSemi2,
        questionsFinal: trainData.questionsFinal,
        questionsTiebreaker: (trainData as any).questionsTiebreaker ?? [],
        tiebreakerRound: (trainData as any).tiebreakerRound ?? 0,
        tiebreakerBase: (trainData as any).tiebreakerBase ?? 0,
        tiebreakerPhase: (trainData as any).tiebreakerPhase ?? null,
      });
      completedForfeitRef.current = false;
      const ac = Array.isArray(trainData.answersChosen) ? trainData.answersChosen : [];
      setFullAnswersChosen(ac);
      const cur = trainData.currentQuestionIndex ?? trainData.questionsAnsweredCount ?? 0;
      const semiIdx = data.semiIndex ?? 0;
      const sr = trainData.semiResult;
      if (cur < 10) {
        setTrainingRound(semiIdx === 0 ? 0 : 1);
        setTrainingQuestionIndex(cur);
        setTrainingAnswers(Array(cur).fill(-1));
        setTrainingRoundScores([]);
      } else if (sr === 'won' && trainData.questionsFinal && trainData.questionsFinal.length > 0 && cur >= 10) {
        if (cur < 20) {
          setTrainingRound(2);
          const indexInFinal = cur - 10;
          setTrainingQuestionIndex(indexInFinal);
          setTrainingAnswers(Array(indexInFinal).fill(-1));
          setTrainingRoundScores([trainData.semiFinalCorrectCount ?? trainData.correctAnswersCount ?? 0]);
        } else {
          const semiScore = trainData.semiFinalCorrectCount ?? 0;
          const finalScore = (trainData.correctAnswersCount ?? 0) - semiScore;
          setTrainingRound(2);
          setTrainingQuestionIndex(10);
          setTrainingAnswers(Array(10).fill(-1));
          setTrainingRoundScores([semiScore, finalScore]);
          setTrainingRoundComplete(true);
        }
      } else {
        setTrainingRound(semiIdx === 0 ? 0 : 1);
        setTrainingQuestionIndex(Math.min(cur, 10));
        setTrainingAnswers(Array(Math.min(cur, 10)).fill(-1));
        setTrainingRoundScores(cur >= 10 ? [trainData.correctAnswersCount ?? 0] : []);
        setTrainingRoundComplete(cur >= 10);
      }
      setTrainingRoundComplete(false);
      setAnswerForCurrentQuestion(null);
      setTrainingCorrectCount(trainData.correctAnswersCount ?? 0);
      const restoredTimeLeft = trainData.timeLeftSeconds ?? QUESTION_TIMER_SEC;
      timeLeftRef.current = restoredTimeLeft;
      setTimeLeft(restoredTimeLeft);
      fetchGameHistory('money');
      if (user?.id) {
        const profileRes = await axios.get('/users/profile', { headers: { Authorization: `Bearer ${token}` } });
        setUser(profileRes.data);
        const transRes = await axios.get('/users/transactions', { headers: { Authorization: `Bearer ${token}` } });
        setTransactions(filterRejectedWithdrawalRefunds(transRes.data ?? []));
      }
    } catch (e: any) {
      const msg = e?.response?.data?.message;
      setTournamentJoinError(Array.isArray(msg) ? msg[0] : typeof msg === 'string' ? msg : e?.message || 'Не удалось присоединиться к турниру');
    } finally {
      tournamentJoinInProgressRef.current = false;
      setTournamentJoinLoading(false);
    }
  };

  const leaveTournamentQueue = () => {
    setTournamentJoinInfo(null);
  };

  const saveTrainingProgress = () => {
    if (!trainingData?.tournamentId || !token || trainingRound === null) return;
    // Останавливаем таймер мгновенно при любом выходе/навигации.
    if (trainingTimerRef.current) {
      clearInterval(trainingTimerRef.current);
      trainingTimerRef.current = null;
    }
    const base = trainingRound === 3 ? tiebreakerBase : (trainingRound >= 2 ? 10 : 0);
    const answered = answerForCurrentQuestion !== null;
    const count = base + trainingQuestionIndex + (answered ? 1 : 0);
    const currentIndex = count;
    const body: { count: number; currentIndex: number; timeLeft?: number; correctCount?: number; answersChosen?: number[] } = { count, currentIndex, correctCount: trainingCorrectCount, answersChosen: fullAnswersChosenRef.current };
    body.timeLeft = answered ? QUESTION_TIMER_SEC : (typeof timeLeftRef.current === 'number' ? timeLeftRef.current : QUESTION_TIMER_SEC);
    axios.post(`/tournaments/${trainingData.tournamentId}/progress`, body, { headers: { Authorization: `Bearer ${token}` } }).catch(() => {});
  };

  const clearTrainingState = () => {
    if (trainingTimerRef.current) {
      clearInterval(trainingTimerRef.current);
      trainingTimerRef.current = null;
    }
    setTrainingData(null);
    setTrainingRound(null);
    setTrainingQuestionIndex(0);
    setTrainingAnswers([]);
    setFullAnswersChosen([]);
    setTrainingRoundScores([]);
    setTrainingRoundComplete(false);
    setAnswerForCurrentQuestion(null);
    setTimeLeft(QUESTION_TIMER_SEC);
  };

  const continueTraining = async (tournamentId: number) => {
    if (continueTrainingLoading !== null || !token) return;
    setContinueTrainingLoading(tournamentId);
    setContinueTrainingError('');
    try {
      const { data } = await axios.get<{
        tournamentId: number;
        deadline: string;
        questionsSemi1: TrainingQuestion[];
        questionsSemi2: TrainingQuestion[];
        questionsFinal: TrainingQuestion[];
        questionsTiebreaker?: TrainingQuestion[];
        tiebreakerRound?: number;
        tiebreakerBase?: number;
        tiebreakerPhase?: 'semi' | 'final' | null;
        questionsAnsweredCount: number;
        currentQuestionIndex: number;
        timeLeftSeconds: number | null;
        leftAt: string | null;
        correctAnswersCount: number;
        semiFinalCorrectCount: number | null;
        answersChosen?: number[];
        semiResult?: 'playing' | 'won' | 'lost' | 'tie' | 'waiting';
      }>(`/tournaments/${tournamentId}/training-state`, { headers: { Authorization: `Bearer ${token}` } });
      setTrainingData({
        tournamentId: data.tournamentId,
        deadline: data.deadline,
        questionsSemi1: data.questionsSemi1,
        questionsSemi2: data.questionsSemi2,
        questionsFinal: data.questionsFinal,
        questionsTiebreaker: data.questionsTiebreaker ?? [],
        tiebreakerRound: data.tiebreakerRound ?? 0,
        tiebreakerBase: data.tiebreakerBase ?? 0,
        tiebreakerPhase: data.tiebreakerPhase ?? null,
      });
      setTournamentJoinInfo({
        tournamentId: data.tournamentId,
        playerSlot: 0,
        totalPlayers: 1,
        semiIndex: 0,
        positionInSemi: 0,
        isCreator: false,
        deadline: data.deadline,
      });
      completedForfeitRef.current = false;
      const ac = data.answersChosen ?? [];
      setFullAnswersChosen(ac);
      const cur = data.currentQuestionIndex ?? data.questionsAnsweredCount ?? 0;
      const sr = data.semiResult;
      const tbPhase = data.tiebreakerPhase;
      const tbQuestions = data.questionsTiebreaker ?? [];
      const tbBase = data.tiebreakerBase ?? 0;
      if (sr === 'tie' && tbQuestions.length > 0) {
        setTiebreakerBase(tbBase);
        setTrainingRound(3);
        const indexInTB = Math.max(0, cur - tbBase);
        setTrainingQuestionIndex(Math.min(indexInTB, tbQuestions.length));
        setTrainingAnswers(indexInTB > 0 ? ac.slice(tbBase, tbBase + indexInTB) : []);
        setTrainingRoundScores([]);
        setTrainingRoundComplete(indexInTB >= tbQuestions.length);
      } else if (sr === 'won' && tbPhase === 'final' && tbQuestions.length > 0) {
        setTiebreakerBase(tbBase);
        setTrainingRound(3);
        const indexInTB = Math.max(0, cur - tbBase);
        setTrainingQuestionIndex(Math.min(indexInTB, tbQuestions.length));
        setTrainingAnswers(indexInTB > 0 ? ac.slice(tbBase, tbBase + indexInTB) : []);
        setTrainingRoundScores([]);
        setTrainingRoundComplete(indexInTB >= tbQuestions.length);
      } else if (cur < 10) {
        setTrainingRound(0);
        setTrainingQuestionIndex(cur);
        setTrainingAnswers(ac.length >= cur ? ac.slice(0, cur) : [...ac, ...Array(Math.max(0, cur - ac.length)).fill(-1)]);
        setTrainingRoundScores([]);
        setTrainingRoundComplete(false);
      } else if (cur >= 10 && sr === 'won' && data.questionsFinal && data.questionsFinal.length > 0) {
        if (cur < 20) {
          const indexInFinal = cur - 10;
          setTrainingRound(2);
          setTrainingQuestionIndex(indexInFinal);
          setTrainingAnswers(ac.length >= cur ? ac.slice(10, cur) : [...ac.slice(10), ...Array(Math.max(0, indexInFinal - Math.max(0, ac.length - 10))).fill(-1)]);
          setTrainingRoundScores([data.semiFinalCorrectCount ?? data.correctAnswersCount ?? 0]);
          setTrainingRoundComplete(indexInFinal >= 10);
        } else {
          const semiScore = data.semiFinalCorrectCount ?? 0;
          const finalScore = (data.correctAnswersCount ?? 0) - semiScore;
          setTrainingRound(2);
          setTrainingQuestionIndex(10);
          setTrainingAnswers(ac.length >= 20 ? ac.slice(10, 20) : [...ac.slice(10), ...Array(10 - Math.max(0, ac.length - 10)).fill(-1)]);
          setTrainingRoundScores([semiScore, finalScore]);
          setTrainingRoundComplete(true);
        }
      } else if (sr === 'waiting' || (cur >= 10 && (!data.questionsFinal || data.questionsFinal.length === 0))) {
        setContinueTrainingLoading(null);
        addNotification({
          type: 'game_status',
          title: sr === 'lost' ? 'Полуфинал завершён' : 'Ожидание соперника',
          text: sr === 'lost' ? 'К сожалению, соперник набрал больше баллов.' : 'Вы завершили полуфинал. Ожидайте, пока соперник ответит на все вопросы.',
        });
        return;
      } else {
        setTrainingRound(0);
        setTrainingQuestionIndex(Math.min(cur, 10));
        setTrainingAnswers(ac.length >= Math.min(cur, 10) ? ac.slice(0, Math.min(cur, 10)) : [...ac, ...Array(Math.max(0, Math.min(cur, 10) - ac.length)).fill(-1)]);
        setTrainingRoundScores(cur >= 10 ? [data.correctAnswersCount ?? 0] : []);
        setTrainingRoundComplete(cur >= 10);
      }
      setAnswerForCurrentQuestion(null);
      setTrainingCorrectCount(data.correctAnswersCount ?? 0);
      // Возвращаем в ту же секунду, на которой вышли (таймер "замораживается" вне игры).
      const restoredTimeLeft = data.timeLeftSeconds ?? QUESTION_TIMER_SEC;
      timeLeftRef.current = restoredTimeLeft;
      setTimeLeft(restoredTimeLeft);
    } catch (e: any) {
      setContinueTrainingError(e?.response?.data?.message || e?.message || 'Не удалось загрузить игру');
    } finally {
      setContinueTrainingLoading(null);
    }
  };

  const openBracket = React.useCallback(async (tournamentId: number, source?: 'active' | 'completed') => {
    setBracketLoading(true);
    setBracketError('');
    setBracketOpenSource(source ?? null);
    const base = `${window.location.pathname}${window.location.search}`;
    const h = window.location.hash.replace(/^#/, '');
    const baseHash = getHashBase(h);
    const validBase = baseHash && !baseHash.startsWith('bracket=') ? baseHash : (section === 'games' ? `games${gameMode ? `-${gameMode}` : ''}` : section || 'games');
    const sourceSuffix = source ? `&bracketSource=${source}` : '';
    const newHash = `${validBase}&bracket=${tournamentId}${sourceSuffix}`;
    window.history.replaceState(null, '', `${base}#${newHash}`);
    try {
      const { data } = await axios.get(`/tournaments/${tournamentId}/bracket`, { headers: { Authorization: `Bearer ${token}` } });
      setBracketView(data);
    } catch (e: unknown) {
      const err = e && typeof e === 'object' && 'response' in e ? (e as { response?: { data?: { message?: string | string[] }; status?: number } }).response : undefined;
      const msg = err?.data?.message;
      const text = Array.isArray(msg) ? msg[0] : typeof msg === 'string' ? msg : (e instanceof Error ? e.message : 'Не удалось загрузить сетку');
      setBracketError(text || 'Не удалось загрузить сетку');
    } finally {
      setBracketLoading(false);
    }
  }, [token, section, gameMode]);

  // Восстановить сетку при обновлении страницы (bracket в URL)
  const bracketRestoredRef = useRef(false);
  useEffect(() => {
    if (!token || bracketRestoredRef.current) return;
    const hash = window.location.hash.replace(/^#/, '');
    const bracketId = getBracketIdFromHash(hash);
    if (bracketId != null) {
      bracketRestoredRef.current = true;
      const source = getBracketSourceFromHash(hash);
      openBracket(bracketId, source ?? undefined);
    }
  }, [token, openBracket]);

  const closeBracket = () => {
    setBracketView(null);
    setBracketError('');
    setBracketPlayerTooltip(null);
    setBracketOpenSource(null);
    const base = `${window.location.pathname}${window.location.search}`;
    const h = window.location.hash.replace(/^#/, '');
    const parts = h.split('&').filter((p) => !p.startsWith('bracket=') && !p.startsWith('bracketSource='));
    const newHash = parts.join('&') || (section === 'games' ? `games${gameMode ? `-${gameMode}` : ''}` : section);
    window.history.replaceState(null, '', `${base}#${newHash || 'games'}`);
  };

  const openQuestionsReview = React.useCallback(async (tournamentId: number, roundForQuestions: 'semi' | 'final') => {
    setQuestionsReviewTournamentId(tournamentId);
    setQuestionsReviewRound(roundForQuestions);
    setQuestionsReviewData(null);
    setQuestionsReviewError('');
    setQuestionsReviewLoading(true);
    const base = `${window.location.pathname}${window.location.search}`;
    const h = window.location.hash.replace(/^#/, '');
    const parts = h.split('&').filter((p) => !p.startsWith('questions=') && !p.startsWith('questionsRound='));
    parts.push(`questions=${tournamentId}`, `questionsRound=${roundForQuestions}`);
    window.history.replaceState(null, '', `${base}#${parts.join('&')}`);
    try {
      const { data } = await axios.get<{
        questionsSemi1: { id: number; question: string; options: string[]; correctAnswer: number }[];
        questionsSemi2: { id: number; question: string; options: string[]; correctAnswer: number }[];
        questionsFinal: { id: number; question: string; options: string[]; correctAnswer: number }[];
        questionsAnsweredCount: number;
        correctAnswersCount: number;
        semiFinalCorrectCount?: number | null;
        answersChosen?: number[];
        userSemiIndex?: number;
      }>(`/tournaments/${tournamentId}/training-state`, { headers: { Authorization: `Bearer ${token}` } });
      const answersChosenRaw = data.answersChosen ?? (data as { answers_chosen?: number[] }).answers_chosen;
      setQuestionsReviewData({
        questionsSemi1: data.questionsSemi1 ?? [],
        questionsSemi2: data.questionsSemi2 ?? [],
        questionsFinal: data.questionsFinal ?? [],
        questionsAnsweredCount: data.questionsAnsweredCount ?? 0,
        correctAnswersCount: data.correctAnswersCount ?? 0,
        semiFinalCorrectCount: data.semiFinalCorrectCount ?? null,
        answersChosen: Array.isArray(answersChosenRaw) ? answersChosenRaw : [],
        userSemiIndex: data.userSemiIndex ?? 0,
      });
    } catch (e: unknown) {
      const msg = axios.isAxiosError(e) && e.response?.data?.message ? String(e.response.data.message) : 'Не удалось загрузить вопросы';
      setQuestionsReviewError(msg);
    } finally {
      setQuestionsReviewLoading(false);
    }
  }, [token]);

  const closeQuestionsReview = () => {
    setQuestionsReviewTournamentId(null);
    setQuestionsReviewData(null);
    setQuestionsReviewError('');
    const base = `${window.location.pathname}${window.location.search}`;
    const h = window.location.hash.replace(/^#/, '');
    const parts = h.split('&').filter((p) => !p.startsWith('questions=') && !p.startsWith('questionsRound='));
    const newHash = parts.join('&') || (section === 'games' ? `games${gameMode ? `-${gameMode}` : ''}` : section ?? 'games');
    window.history.replaceState(null, '', `${base}#${newHash}`);
  };

  // Восстановить модалку вопросов при обновлении страницы (questions в URL)
  const questionsRestoredRef = useRef(false);
  useEffect(() => {
    if (!token || questionsRestoredRef.current) return;
    const hash = window.location.hash.replace(/^#/, '');
    const q = getQuestionsReviewFromHash(hash);
    if (q != null) {
      questionsRestoredRef.current = true;
      openQuestionsReview(q.tournamentId, q.round);
    }
  }, [token, openQuestionsReview]);

  const continueTournament = async (tournamentId: number) => {
    if (continueTournamentLoading !== null) return;
    setContinueTournamentLoading(tournamentId);
    setContinueTournamentError('');
    try {
      const { data } = await axios.get<{
        tournamentId: number;
        playerSlot: number;
        totalPlayers: number;
        semiIndex: number;
        positionInSemi: number;
        isCreator: boolean;
        deadline: string;
      }>(`/tournaments/${tournamentId}/state`, { headers: { Authorization: `Bearer ${token}` } });
      setTournamentJoinInfo(data);
      setContinueTournamentError('');
      const { data: trainData } = await axios.get<{
        tournamentId: number;
        deadline: string;
        questionsSemi1: TrainingQuestion[];
        questionsSemi2: TrainingQuestion[];
        questionsFinal: TrainingQuestion[];
        questionsAnsweredCount: number;
        currentQuestionIndex: number;
        timeLeftSeconds: number | null;
        leftAt: string | null;
        correctAnswersCount: number;
        semiFinalCorrectCount: number | null;
        answersChosen?: number[];
        semiResult?: 'playing' | 'won' | 'lost' | 'tie' | 'waiting';
      }>(`/tournaments/${tournamentId}/training-state`, { headers: { Authorization: `Bearer ${token}` } });
      const ac = Array.isArray(trainData.answersChosen) ? trainData.answersChosen : [];
      setFullAnswersChosen(ac);
      const hasQuestions = (trainData.questionsSemi1?.length ?? 0) > 0 || (trainData.questionsSemi2?.length ?? 0) > 0 || (trainData.questionsFinal?.length ?? 0) > 0;
      if (hasQuestions) {
        setTrainingData({
          tournamentId: trainData.tournamentId,
          deadline: trainData.deadline,
          questionsSemi1: trainData.questionsSemi1 ?? [],
          questionsSemi2: trainData.questionsSemi2 ?? [],
          questionsFinal: trainData.questionsFinal ?? [],
          questionsTiebreaker: (trainData as any).questionsTiebreaker ?? [],
          tiebreakerRound: (trainData as any).tiebreakerRound ?? 0,
          tiebreakerBase: (trainData as any).tiebreakerBase ?? 0,
          tiebreakerPhase: (trainData as any).tiebreakerPhase ?? null,
        });
        completedForfeitRef.current = false;
        const cur = trainData.currentQuestionIndex ?? trainData.questionsAnsweredCount ?? 0;
        const semiIdx = data.semiIndex ?? 0;
        const sr = trainData.semiResult;
        if (cur < 10) {
          setTrainingRound(semiIdx === 0 ? 0 : 1);
          setTrainingQuestionIndex(cur);
          setTrainingAnswers(ac.length >= cur ? ac.slice(0, cur) : [...ac, ...Array(Math.max(0, cur - ac.length)).fill(-1)]);
          setTrainingRoundScores([]);
          setTrainingRoundComplete(false);
        } else if (sr === 'won' && trainData.questionsFinal && trainData.questionsFinal.length > 0 && cur >= 10) {
          if (cur < 20) {
            setTrainingRound(2);
            const indexInFinal = cur - 10;
            setTrainingQuestionIndex(indexInFinal);
            setTrainingAnswers(ac.length >= cur ? ac.slice(10, cur) : [...ac.slice(10), ...Array(Math.max(0, indexInFinal - Math.max(0, ac.length - 10))).fill(-1)]);
            setTrainingRoundScores([trainData.semiFinalCorrectCount ?? trainData.correctAnswersCount ?? 0]);
            setTrainingRoundComplete(false);
          } else {
            const semiScore = trainData.semiFinalCorrectCount ?? 0;
            const finalScore = (trainData.correctAnswersCount ?? 0) - semiScore;
            setTrainingRound(2);
            setTrainingQuestionIndex(10);
            setTrainingAnswers(ac.length >= 20 ? ac.slice(10, 20) : [...ac.slice(10), ...Array(10 - Math.max(0, ac.length - 10)).fill(-1)]);
            setTrainingRoundScores([semiScore, finalScore]);
            setTrainingRoundComplete(true);
          }
        } else {
          setTrainingRound(semiIdx === 0 ? 0 : 1);
          setTrainingQuestionIndex(Math.min(cur, 10));
          setTrainingAnswers(ac.length >= Math.min(cur, 10) ? ac.slice(0, Math.min(cur, 10)) : [...ac, ...Array(Math.max(0, Math.min(cur, 10) - ac.length)).fill(-1)]);
          setTrainingRoundScores(cur >= 10 ? [trainData.correctAnswersCount ?? 0] : []);
          setTrainingRoundComplete(cur >= 10);
        }
        setAnswerForCurrentQuestion(null);
        setTrainingCorrectCount(trainData.correctAnswersCount ?? 0);
        const restoredTimeLeft = trainData.timeLeftSeconds ?? QUESTION_TIMER_SEC;
        timeLeftRef.current = restoredTimeLeft;
        setTimeLeft(restoredTimeLeft);
      }
    } catch (e: any) {
      setContinueTournamentError(e?.response?.data?.message || e?.message || 'Не удалось загрузить турнир');
    } finally {
      setContinueTournamentLoading(null);
    }
  };

  const handleAvatarUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 10_000_000) {
      alert('Файл слишком большой. Максимум 10 МБ.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      setAvatar(result);
      axios.post('/users/profile/avatar', { avatarUrl: result }, authHeaders)
        .catch(() => alert('Не удалось сохранить фото на сервере'));
    };
    reader.readAsDataURL(file);
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    if (newPassword !== confirmPassword) {
      setError('Новые пароли не совпадают');
      return;
    }

    if (newPassword.length < 6) {
      setError('Пароль должен быть не менее 6 символов');
      return;
    }

    try {
      await axios.post(
        '/auth/change-password',
        { oldPassword, newPassword },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      setSuccess('Пароль успешно изменён');
      setOldPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setShowPasswordForm(false);
    } catch (error) {
      setError('Не удалось изменить пароль. Проверьте старый пароль');
    }
  };

  if (!user && !profileError) {
    return (
      <div className="cabinet cabinet-loading-skeleton" style={{ background: '#f0f0f0', minHeight: '100vh', width: '100%' }}>
        <aside className="cabinet-sidebar" aria-hidden style={{ background: '#000' }} />
        <div className="cabinet-main-wrap" style={{ marginLeft: 80, background: '#f0f0f0', flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div className="cabinet-loading-spinner" aria-label="Загрузка" />
        </div>
      </div>
    );
  }

  if (profileError) {
    const isSessionExpired = profileError.includes('Сессия истекла');
    return (
      <div className="cabinet cabinet-loading cabinet-loading--error" style={{ background: '#f5f5f5', minHeight: '100vh', padding: 24 }}>
        <div className="profile-error-block" style={{ background: '#fff', padding: 24, borderRadius: 12, maxWidth: 480 }}>
          <p className="profile-error-text">{profileError}</p>
          <div className="profile-error-actions">
            <button
              type="button"
              className="profile-login-btn"
              onClick={() => onLogout?.()}
            >
              Войти заново
            </button>
            {!isSessionExpired && (
              <button
                type="button"
                className="profile-retry-btn"
                onClick={() => { setProfileError(''); setRetryTrigger((t) => t + 1); }}
              >
                Повторить
              </button>
            )}
          </div>
          <Link to="/login" style={{ display: 'inline-block', marginTop: 16, fontSize: 14 }}>Перейти на страницу входа</Link>
        </div>
      </div>
    );
  }

  const currentBirthDateStr = (() => {
    if (birthYear && birthMonth && birthDay) {
      return `${birthYear}-${birthMonth.padStart(2, '0')}-${birthDay.padStart(2, '0')}`;
    }
    if (!birthYear && !birthMonth && !birthDay) return null;
    return undefined;
  })();

  const profileDirty =
    nickname !== savedNick ||
    gender !== savedGender ||
    (currentBirthDateStr !== undefined && currentBirthDateStr !== savedBirthDate);

  const saveProfileChanges = async () => {
    if (!profileDirty || profileSaving) return;
    setProfileSaving(true);
    setProfileSaveOk(false);
    try {
      if (nickname !== savedNick) {
        await axios.post('/users/profile/nickname', { nickname: nickname || null }, { headers: { Authorization: `Bearer ${token}` } });
        if (user?.id != null) localStorage.setItem(`nickname_${user.id}`, nickname);
        setSavedNick(nickname);
      }
      const newBd = currentBirthDateStr !== undefined ? currentBirthDateStr : savedBirthDate;
      if (gender !== savedGender || newBd !== savedBirthDate) {
        await axios.post('/users/profile/personal', { gender, birthDate: newBd }, { headers: { Authorization: `Bearer ${token}` } });
        setSavedGender(gender);
        if (newBd !== undefined) {
          setSavedBirthDate(newBd);
          setBirthDate(newBd);
        }
      }
      setProfileSaveOk(true);
      setTimeout(() => setProfileSaveOk(false), 2500);
    } catch (_) {}
    setProfileSaving(false);
  };

  const discardProfileChanges = () => {
    setNickname(savedNick);
    setGender(savedGender);
    setBirthDate(savedBirthDate);
    if (savedBirthDate) {
      const p = savedBirthDate.split('-');
      setBirthYear(p[0] || '');
      setBirthMonth(p[1] ? String(Number(p[1])) : '');
      setBirthDay(p[2] ? String(Number(p[2])) : '');
    } else {
      setBirthYear('');
      setBirthMonth('');
      setBirthDay('');
    }
    setIsEditingName(false);
  };

  const tryGoToSection = (s: CabinetSection, financeSub?: 'topup' | 'withdraw') => {
    if (profileDirty && (section === null || section === 'profile') && s !== 'profile') {
      setConfirmLeave(s);
      setConfirmLeaveFinanceSub(financeSub);
      return;
    }
    goToSection(s, financeSub);
  };

  return (
    <div className="cabinet" style={{ background: '#f0f0f0', minHeight: '100vh', width: '100%' }} data-page="cabinet">
      <aside className="cabinet-sidebar" style={{ background: '#000' }}>
        <button
          type="button"
          className={`cabinet-menu-item ${section === 'profile' ? 'active' : ''}`}
          onClick={() => { saveTrainingProgress(); tryGoToSection('profile'); }}
          aria-label="Профиль"
        >
          <span className="cabinet-menu-icon" aria-hidden>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
              <circle cx="12" cy="7" r="4" />
            </svg>
          </span>
          <span className="cabinet-menu-label">Профиль</span>
        </button>
        <button
          type="button"
          className={`cabinet-menu-item ${section === 'statistics' ? 'active' : ''}`}
          onClick={() => { saveTrainingProgress(); tryGoToSection('statistics'); }}
          aria-label="Статистика"
        >
          <span className="cabinet-menu-icon" aria-hidden>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="20" x2="12" y2="10" />
              <line x1="18" y1="20" x2="18" y2="4" />
              <line x1="6" y1="20" x2="6" y2="16" />
            </svg>
          </span>
          <span className="cabinet-menu-label">Статистика</span>
        </button>
        <button
          type="button"
          className={`cabinet-menu-item ${section === 'games' || section === 'games-training' || section === 'games-money' ? 'active' : ''}`}
          onClick={() => {
            if (profileDirty && (section === null || section === 'profile')) {
              setConfirmLeave('games');
              return;
            }
            saveTrainingProgress();
            clearTrainingState();
            setGameModeState(null);
            localStorage.removeItem(GAME_MODE_STORAGE_KEY);
            navigate('/profile?section=games', { replace: true });
            setSection('games');
            localStorage.setItem(SECTION_STORAGE_KEY, 'games');
          }}
          aria-label="Игры"
        >
          <span className="cabinet-menu-icon" aria-hidden>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="6" y1="12" x2="10" y2="12" />
              <line x1="8" y1="10" x2="8" y2="14" />
              <line x1="15" y1="13" x2="15.01" y2="13" />
              <line x1="18" y1="11" x2="18.01" y2="11" />
              <rect x="2" y="6" width="20" height="12" rx="2" />
            </svg>
          </span>
          <span className="cabinet-menu-label">Игры</span>
        </button>
        <button
          type="button"
          className={`cabinet-menu-item ${section === 'finance' || section === 'finance-topup' || section === 'finance-withdraw' ? 'active' : ''}`}
          onClick={() => { saveTrainingProgress(); tryGoToSection('finance'); }}
          aria-label="Финансы"
        >
          <span className="cabinet-menu-icon" aria-hidden>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="1" y="4" width="22" height="16" rx="2" ry="2" />
              <line x1="1" y1="10" x2="23" y2="10" />
              <path d="M12 15h.01" />
            </svg>
          </span>
          <span className="cabinet-menu-label">Финансы</span>
        </button>
        <button
          type="button"
          className={`cabinet-menu-item ${(section === 'partner' || section === 'partner-statistics') ? 'active' : ''}`}
          onClick={() => { saveTrainingProgress(); tryGoToSection('partner'); }}
          aria-label="Партнерская программа"
        >
          <span className="cabinet-menu-icon" aria-hidden>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
              <circle cx="9" cy="7" r="4" />
              <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
              <path d="M16 3.13a4 4 0 0 1 0 7.75" />
            </svg>
          </span>
          <span className="cabinet-menu-label">Партнёрка</span>
        </button>
      </aside>
      {showLogoutConfirm && onLogout && (
        <div className="bracket-overlay" role="dialog" aria-modal="true" aria-labelledby="logout-confirm-title" onClick={() => setShowLogoutConfirm(false)}>
          <div className="bracket-modal cabinet-confirm-modal" onClick={(e) => e.stopPropagation()}>
            <div className="bracket-modal-header">
              <h3 id="logout-confirm-title">Выход</h3>
              <button type="button" className="bracket-close" onClick={() => setShowLogoutConfirm(false)} aria-label="Закрыть">×</button>
            </div>
            <p className="cabinet-confirm-text">Вы уверены, что хотите выйти?</p>
            <div className="cabinet-confirm-buttons">
              <button type="button" className="cabinet-confirm-cancel" onClick={() => { setShowLogoutConfirm(false); onLogout(); }}>Выйти</button>
              <button type="button" className="cabinet-confirm-submit" onClick={() => setShowLogoutConfirm(false)}>Остаться</button>
            </div>
          </div>
        </div>
      )}
      {showStartGameConfirm && pendingStartGameAction && (
        <div className="bracket-overlay" role="dialog" aria-modal="true" aria-labelledby="start-game-confirm-title" onClick={() => { setShowStartGameConfirm(false); setPendingStartGameAction(null); }}>
          <div className="bracket-modal cabinet-confirm-modal" onClick={(e) => e.stopPropagation()}>
            <div className="bracket-modal-header">
              <h3 id="start-game-confirm-title">Начать игру</h3>
              <button type="button" className="bracket-close" onClick={() => { setShowStartGameConfirm(false); setPendingStartGameAction(null); }} aria-label="Закрыть">×</button>
            </div>
            <p className="cabinet-confirm-text">Вы точно готовы начать игру?</p>
            <div className="cabinet-confirm-buttons">
              <button type="button" className="cabinet-confirm-cancel" onClick={() => { setShowStartGameConfirm(false); setPendingStartGameAction(null); }}>Нет</button>
              <button type="button" className="cabinet-confirm-submit" onClick={() => { const fn = pendingStartGameAction; setShowStartGameConfirm(false); setPendingStartGameAction(null); if (fn) fn(); }}>Да</button>
            </div>
          </div>
        </div>
      )}
      <div className="cabinet-main-wrap" ref={cabinetMainWrapRef}>
        {isImpersonating && (
          <div className="impersonate-banner">
            <span className="impersonate-banner-text">
              Вы вошли как <strong>{user?.nickname || user?.username || `#${user?.id}`}</strong>
            </span>
            <button type="button" className="impersonate-banner-btn" onClick={returnToAdmin}>
              ← Вернуться в админку
            </button>
          </div>
        )}
        <header className="cabinet-header">
          <div className="cabinet-header-left">
            <div className="cabinet-notifications-wrap" ref={notificationsRef}>
              <button
                type="button"
                className={`cabinet-header-bell ${notificationsOpen ? 'active' : ''}`}
                onClick={() => { setNotificationsOpen((v) => !v); if (!notificationsOpen) markNotificationsRead(); }}
                aria-label="Уведомления"
              >
                <span className="cabinet-header-bell-icon-wrap">
                  <span className="cabinet-header-bell-icon" aria-hidden>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
                    </svg>
                  </span>
                  {notifications.some((n) => !n.read) && (
                    <span className="cabinet-header-bell-badge" aria-label="Непрочитанные уведомления" />
                  )}
                </span>
              </button>
              {notificationsOpen && (
                <div className="cabinet-notifications-dropdown">
                  <div className="cabinet-notifications-header">Уведомления</div>
                  {notifications.length === 0 ? (
                    <div className="cabinet-notifications-empty">Нет уведомлений</div>
                  ) : (
                    <div className="cabinet-notifications-list">
                      {notifications.map((n) => {
                        const isGameStartClickable = n.type === 'game_started' || !!n.meta?.goToGames;
                        const handleGameStartClick = () => {
                          goToSection('games');
                          if (n.meta?.gameMode) setGameMode(n.meta.gameMode);
                          setNotificationsOpen(false);
                          markNotificationsRead();
                        };
                        return (
                        <div
                          key={n.id}
                          role={isGameStartClickable ? 'button' : undefined}
                          tabIndex={isGameStartClickable ? 0 : undefined}
                          className={`cabinet-notification-item ${n.read ? '' : 'unread'} ${isGameStartClickable ? 'clickable' : ''}`}
                          onClick={isGameStartClickable ? handleGameStartClick : undefined}
                          onKeyDown={isGameStartClickable ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleGameStartClick(); } } : undefined}
                        >
                          <div className="cabinet-notification-title">{n.title}</div>
                          <div className="cabinet-notification-text">{n.text}</div>
                          <div className="cabinet-notification-date">
                            {formatMoscowDateTime(n.createdAt)}
                          </div>
                          {isGameStartClickable && (
                            <div className="cabinet-notification-action">Перейти к активным турнирам →</div>
                          )}
                        </div>
                      ); })}
                    </div>
                  )}
                </div>
              )}
            </div>
            <button
              type="button"
              className="cabinet-header-chat"
              onClick={() => navigate('/support')}
              aria-label="Тех. поддержка"
            >
              <span className="cabinet-header-chat-icon-wrap">
                <span className="cabinet-header-chat-icon" aria-hidden>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                  </svg>
                </span>
                {hasSupportUnread && <span className="cabinet-header-bell-badge" />}
              </span>
            </button>
            <button
              type="button"
              className={`cabinet-header-news ${section === 'news' ? 'active' : ''}`}
              onClick={() => { saveTrainingProgress(); tryGoToSection('news'); }}
              aria-label="Новости"
            >
            <span className="cabinet-header-news-icon-wrap">
              <span className="cabinet-header-news-icon" aria-hidden>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M4 22h16a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v16a2 2 0 0 1-2 2Zm0 0a2 2 0 0 1-2-2v-9c0-1.1.9-2 2-2h2" />
                  <path d="M18 14h-8" />
                  <path d="M15 18h-5" />
                  <path d="M10 6h8v4h-8V6Z" />
                </svg>
              </span>
              {apiNews.some((n) => !readNewsIds.includes(n.id)) && (
                <span className="cabinet-header-news-badge" aria-label="Есть непрочитанные новости" />
              )}
            </span>
          </button>
          </div>
          <div className="cabinet-header-center">
            <span className="cabinet-header-online">
              {globalStats !== null ? (
                <>
                  <span className="cabinet-header-online-value">{globalStats.onlineCount}</span>
                  <span className="cabinet-header-online-label"> онлайн</span>
                </>
              ) : (
                <span className="cabinet-header-online-loading">—</span>
              )}
            </span>
          </div>
          <div className="cabinet-header-right">
            <div className="cabinet-balance-dropdown">
              <div className="cabinet-balance">
                <span className="cabinet-balance-icon" aria-hidden>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="12" y1="1" x2="12" y2="23" />
                    <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
                  </svg>
                </span>
                <span className="cabinet-balance-label">Баланс: {formatNum(user?.balance ?? 0)} {CURRENCY}</span>
              </div>
              <div className="cabinet-balance-dropdown-menu">
                <div className="cabinet-balance-dropdown-balance">
                  <span className="cabinet-balance-dropdown-label">Баланс в рублях:</span>
                  <span key={`balance-rubles-${user?.balanceRubles ?? 0}`} className="cabinet-balance-dropdown-value">{formatNum(user?.balanceRubles ?? 0)} ₽</span>
                </div>
                <button
                  type="button"
                  className="cabinet-balance-dropdown-item"
                  onClick={() => { saveTrainingProgress(); tryGoToSection('finance', 'topup'); }}
                >
                  Пополнить баланс
                </button>
                <button
                  type="button"
                  className="cabinet-balance-dropdown-item"
                  onClick={() => { saveTrainingProgress(); tryGoToSection('finance', 'withdraw'); }}
                >
                  Вывод средств
                </button>
              </div>
            </div>
            {onLogout && (
              <div
                className={`cabinet-header-logout-dropdown ${logoutDropdownOpen ? 'is-open' : ''}`}
                ref={logoutDropdownRef}
              >
                <button
                  type="button"
                  className="cabinet-header-logout"
                  aria-label="Выход и админка"
                  onClick={() => setLogoutDropdownOpen((v) => !v)}
                >
                  <span className="cabinet-header-logout-icon" aria-hidden>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                      <polyline points="16 17 21 12 16 7" />
                      <line x1="21" y1="12" x2="9" y2="12" />
                    </svg>
                  </span>
                </button>
                <div className="cabinet-header-logout-menu">
                  {(user?.id === 1 || showAdminLink || user?.isAdmin === true || user?.isAdmin === 1 || user?.isAdmin === '1' || !!user?.isAdmin) && (
                    <button type="button" className="cabinet-header-logout-item" onClick={() => { setLogoutDropdownOpen(false); navigate('/admin'); }}>
                      Кабинет админа
                    </button>
                  )}
                  <button type="button" className="cabinet-header-logout-item" onClick={() => setShowLogoutConfirm(true)}>
                    Выход
                  </button>
                </div>
              </div>
            )}
          </div>
        </header>
        <main className="cabinet-content" style={{ background: '#fff', color: '#222', minHeight: '50vh', flex: 1 }} role="main">
        {(section === null || section === 'profile') && (<>
    <div className="profile-container" style={{ padding: '24px', background: '#fff', minHeight: 200 }}>
      <div className="profile-header">
        <div className="avatar-section">
          <div className="avatar-box">
            {avatar ? (
              <img src={avatar} alt="Avatar" className="avatar-image" />
            ) : (
              <div className="avatar-placeholder avatar-placeholder-dollar">
                <DollarIcon />
              </div>
            )}
          </div>
          <label htmlFor="avatar-upload" className="upload-button">
            Загрузить фото
          </label>
          <input
            id="avatar-upload"
            type="file"
            accept="image/*"
            onChange={handleAvatarUpload}
            style={{ display: 'none' }}
          />
          <div className="password-section">
            {!showPasswordForm ? (
              <button onClick={() => setShowPasswordForm(true)} className="change-password-btn">
                Изменить пароль
              </button>
            ) : (
              <form onSubmit={handleChangePassword} className="password-form">
                <h3>Изменение пароля</h3>
                <input
                  type="password"
                  placeholder="Старый пароль"
                  value={oldPassword}
                  onChange={(e) => setOldPassword(e.target.value)}
                  required
                />
                <input
                  type="password"
                  placeholder="Новый пароль"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  required
                />
                <input
                  type="password"
                  placeholder="Повторите новый пароль"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                />
                {error && <p style={{ color: 'red' }}>{error}</p>}
                {success && <p style={{ color: 'green' }}>{success}</p>}
                <div className="form-buttons">
                  <button type="submit">Сохранить</button>
                  <button type="button" onClick={() => setShowPasswordForm(false)}>
                    Отмена
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>

        <div className="user-info">
          <p className="user-info-row">
            <span className="user-info-label">ID:</span>{' '}
            <span className="user-info-value">{user.id != null ? formatNum(user.id) : '—'}</span>
          </p>
          <p className="user-info-row">
            <span className="user-info-label">Логин:</span>{' '}
            <span className="user-info-value">{user.username ?? '—'}</span>
          </p>
          <p className="user-info-row">
            <span className="user-info-label">Email:</span>{' '}
            <span className="user-info-value">{user.email ?? '—'}</span>
          </p>
          <div className="user-info-row user-info-row-name">
            <span className="user-info-label">Ник в игре:</span>
            {isEditingName ? (
              <>
                <input
                  type="text"
                  placeholder="Введите имя"
                  value={nameDraft}
                  onChange={(e) => setNameDraft(e.target.value.slice(0, BRACKET_NAME_MAX_LEN))}
                  maxLength={BRACKET_NAME_MAX_LEN}
                  className="profile-nickname-input"
                  autoFocus
                />
                <button
                  type="button"
                  className="profile-name-save"
                  onClick={() => {
                    const v = nameDraft.trim().slice(0, BRACKET_NAME_MAX_LEN);
                    setNickname(v);
                    setIsEditingName(false);
                  }}
                  title="Применить"
                  aria-label="Применить"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                </button>
              </>
            ) : (
              <>
                <span className="user-info-value user-info-name-value">{nickname ? nickname : (user?.username || '—')}</span>
                <button
                  type="button"
                  className="profile-name-edit"
                  onClick={() => {
                    setNameDraft((nickname || '').slice(0, BRACKET_NAME_MAX_LEN));
                    setIsEditingName(true);
                  }}
                  title="Редактировать"
                  aria-label="Редактировать имя"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                  </svg>
                </button>
              </>
            )}
          </div>
          <p className="user-info-row">
            <span className="user-info-label">Лига:</span>{' '}
            <span className="user-info-value">{stats?.maxLeagueName ?? (stats === null && !statsError ? '…' : '—')}</span>
          </p>
          <p className="user-info-row">
            <span className="user-info-label">Пол:</span>
            <span className="user-info-value gender-selector">
              {(['male', 'female'] as const).map((g) => (
                <button
                  key={g}
                  type="button"
                  className={`gender-btn ${gender === g ? 'gender-btn--active' : ''}`}
                  onClick={() => {
                    setGender(gender === g ? null : g);
                  }}
                >
                  {g === 'male' ? 'Мужской' : 'Женский'}
                </button>
              ))}
            </span>
          </p>
          <p className="user-info-row">
            <span className="user-info-label">Дата рождения:</span>
            <span className="birthdate-selects">
              {(() => {
                const MONTHS_RU = ['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];
                const currentYear = new Date().getFullYear();
                const minYear = currentYear - 100;
                const maxYear = currentYear - 18;
                const years: number[] = [];
                for (let y = maxYear; y >= minYear; y--) years.push(y);
                const daysCount = (y: string, m: string) => {
                  if (!y || !m) return 31;
                  return new Date(Number(y), Number(m), 0).getDate();
                };
                const maxDay = daysCount(birthYear, birthMonth);
                const days: number[] = [];
                for (let d = 1; d <= maxDay; d++) days.push(d);

                return (
                  <>
                    <select className="birthdate-select" value={birthDay} onChange={(e) => {
                      setBirthDay(e.target.value);
                    }}>
                      <option value="">День</option>
                      {days.map(d => <option key={d} value={String(d)}>{d}</option>)}
                    </select>
                    <select className="birthdate-select birthdate-select--month" value={birthMonth} onChange={(e) => {
                      const m = e.target.value;
                      setBirthMonth(m);
                      if (birthDay && Number(birthDay) > daysCount(birthYear, m)) {
                        setBirthDay(String(daysCount(birthYear, m)));
                      }
                    }}>
                      <option value="">Месяц</option>
                      {MONTHS_RU.map((name, i) => <option key={i} value={String(i+1)}>{name}</option>)}
                    </select>
                    <select className="birthdate-select" value={birthYear} onChange={(e) => {
                      const y = e.target.value;
                      setBirthYear(y);
                      if (birthDay && birthMonth && Number(birthDay) > daysCount(y, birthMonth)) {
                        setBirthDay(String(daysCount(y, birthMonth)));
                      }
                    }}>
                      <option value="">Год</option>
                      {years.map(y => <option key={y} value={String(y)}>{y}</option>)}
                    </select>
                  </>
                );
              })()}
            </span>
          </p>
        </div>
      </div>
      <div className="profile-save-bar">
        <button
          type="button"
          className={`profile-save-btn${profileDirty ? ' profile-save-btn--active' : ''}`}
          disabled={!profileDirty || profileSaving}
          onClick={saveProfileChanges}
        >
          {profileSaving ? 'Сохранение...' : profileSaveOk ? 'Сохранено' : 'Сохранить изменения'}
        </button>
        {profileDirty && (
          <button
            type="button"
            className="profile-discard-btn"
            onClick={discardProfileChanges}
          >
            Отменить изменения
          </button>
        )}
      </div>
    </div>

    {confirmLeave !== null && (
      <div className="profile-confirm-overlay" onClick={() => setConfirmLeave(null)}>
        <div className="profile-confirm-modal" onClick={(e) => e.stopPropagation()}>
          <p className="profile-confirm-text">У вас есть несохранённые изменения. Выйти без сохранения?</p>
          <div className="profile-confirm-buttons">
            <button
              type="button"
              className="profile-confirm-btn profile-confirm-btn--cancel"
              onClick={() => setConfirmLeave(null)}
            >
              Остаться
            </button>
            <button
              type="button"
              className="profile-confirm-btn profile-confirm-btn--leave"
              onClick={() => {
                const target = confirmLeave!;
                const sub = confirmLeaveFinanceSub;
                discardProfileChanges();
                setConfirmLeave(null);
                setConfirmLeaveFinanceSub(undefined);
                goToSection(target, sub);
              }}
            >
              Выйти
            </button>
          </div>
        </div>
      </div>
    )}
        </>)}
        {section === 'statistics' && (
          <div className="cabinet-statistics">
            <h2>Статистика</h2>
            <div className="cabinet-statistics-tabs">
              <button
                type="button"
                className={`cabinet-statistics-tab ${statsMode === 'personal' ? 'cabinet-statistics-tab--active' : ''}`}
                onClick={() => {
                  setStatsMode('personal');
                  localStorage.removeItem(STATS_MODE_STORAGE_KEY);
                  const base = `${window.location.pathname}${window.location.search}`;
                  const h = window.location.hash.replace(/^#/, '');
                  const parts = h.split('&').filter((p) => !p.startsWith('statsMode='));
                  const newHash = parts.join('&') || 'statistics';
                  window.history.replaceState(null, '', `${base}#${newHash}`);
                }}
              >
                Личная
              </button>
              <button
                type="button"
                className={`cabinet-statistics-tab ${statsMode === 'general' ? 'cabinet-statistics-tab--active' : ''}`}
                onClick={() => {
                  setStatsMode('general');
                  localStorage.setItem(STATS_MODE_STORAGE_KEY, 'general');
                  const base = `${window.location.pathname}${window.location.search}`;
                  const h = window.location.hash.replace(/^#/, '');
                  const parts = h.split('&').filter((p) => !p.startsWith('statsMode='));
                  const basePart = parts[0] || 'statistics';
                  const newHash = [basePart, ...parts.slice(1), 'statsMode=general'].join('&');
                  window.history.replaceState(null, '', `${base}#${newHash}`);
                }}
              >
                Общая
              </button>
            </div>
            {statsMode === 'personal' && (
              <>
                {statsError && <p style={{ color: '#c00', margin: 0 }}>{statsError}</p>}
                {stats && (
                  <div className="cabinet-statistics-personal">
                  <div className="cabinet-statistics-list">
                    <div className="cabinet-stat-group cabinet-stat-group--general">
                      <p className="cabinet-stat-item"><strong>Лига:</strong> {stats.maxLeagueName ?? '—'}</p>
                      <p className="cabinet-stat-item"><strong>Общая</strong> — сыграно раундов: {formatNum(stats.gamesPlayed ?? 0)}</p>
                      <p className="cabinet-stat-item"><strong>Сыгранных матчей:</strong> {formatNum(stats.completedMatches ?? 0)}</p>
                      <p className="cabinet-stat-item"><strong>Сумма выигрыша:</strong> {formatNum(stats.totalWinnings ?? 0)} {CURRENCY}</p>
                      <p className="cabinet-stat-item"><strong>Выведено денег:</strong> {formatNum(stats.totalWithdrawn ?? 0)} ₽</p>
                      <p className="cabinet-stat-item"><strong>Выиграно турниров:</strong> {formatNum(stats.wins ?? 0)}</p>
                      <p className="cabinet-stat-item"><strong>Верных ответов:</strong> {formatNum(stats.correctAnswers ?? 0)} из {formatNum(stats.totalQuestions ?? 0)}</p>
                      <p className="cabinet-stat-item"><strong>% верных ответов:</strong> {(stats.totalQuestions ?? 0) > 0 ? `${(((stats.correctAnswers ?? 0) / (stats.totalQuestions ?? 1)) * 100).toFixed(2)}%` : '—'}</p>
                    </div>
                    <div className="cabinet-stat-group cabinet-stat-group--training">
                      <p className="cabinet-stat-item"><strong>Тренировка</strong> — сыграно раундов: {formatNum(stats.gamesPlayedTraining ?? 0)}</p>
                      <p className="cabinet-stat-item"><strong>Сыгранных матчей:</strong> {formatNum(stats.completedMatchesTraining ?? 0)}</p>
                      <p className="cabinet-stat-item"><strong>Выиграно турниров:</strong> {formatNum(stats.winsTraining ?? 0)}</p>
                      <p className="cabinet-stat-item"><strong>Верных ответов:</strong> {formatNum(stats.correctAnswersTraining ?? 0)} из {formatNum(stats.totalQuestionsTraining ?? 0)}</p>
                      <p className="cabinet-stat-item"><strong>% верных ответов:</strong> {(stats.totalQuestionsTraining ?? 0) > 0 ? `${(((stats.correctAnswersTraining ?? 0) / (stats.totalQuestionsTraining ?? 1)) * 100).toFixed(2)}%` : '—'}</p>
                    </div>
                    <div className="cabinet-stat-group cabinet-stat-group--money">
                      <p className="cabinet-stat-item"><strong>Противостояние</strong> — сыграно раундов: {formatNum(stats.gamesPlayedMoney ?? 0)}</p>
                      <p className="cabinet-stat-item"><strong>Сыгранных матчей:</strong> {formatNum(stats.completedMatchesMoney ?? 0)}</p>
                      <p className="cabinet-stat-item"><strong>Выиграно турниров:</strong> {formatNum(stats.winsMoney ?? 0)}</p>
                      <p className="cabinet-stat-item"><strong>Верных ответов:</strong> {formatNum(stats.correctAnswersMoney ?? 0)} из {formatNum(stats.totalQuestionsMoney ?? 0)}</p>
                      <p className="cabinet-stat-item"><strong>% верных ответов:</strong> {(stats.totalQuestionsMoney ?? 0) > 0 ? `${(((stats.correctAnswersMoney ?? 0) / (stats.totalQuestionsMoney ?? 1)) * 100).toFixed(2)}%` : '—'}</p>
                    </div>
                  </div>
                  <div className="cabinet-stats-chart">
                    <h3 className="cabinet-stats-chart-title">График по дням</h3>
                    <div className="cabinet-stats-chart-controls">
                      <div className="cabinet-stats-chart-filters">
                        {(['today', 'yesterday', 'week', 'month'] as const).map((preset) => {
                          const todayMoscow = parseMoscowDate(toMoscowDateStr());
                          const getRange = () => {
                            if (preset === 'today') {
                              const from = new Date(todayMoscow);
                              return { from: toMoscowDateStr(from), to: toMoscowDateStr(from) };
                            }
                            if (preset === 'yesterday') {
                              const y = new Date(todayMoscow);
                              y.setDate(y.getDate() - 1);
                              return { from: toMoscowDateStr(y), to: toMoscowDateStr(y) };
                            }
                            if (preset === 'week') {
                              const from = new Date(todayMoscow);
                              from.setDate(from.getDate() - 6);
                              return { from: toMoscowDateStr(from), to: toMoscowDateStr(todayMoscow) };
                            }
                            const from = new Date(todayMoscow);
                            from.setDate(from.getDate() - 29);
                            return { from: toMoscowDateStr(from), to: toMoscowDateStr(todayMoscow) };
                          };
                          const labels = { today: 'Сегодня', yesterday: 'Вчера', week: 'Неделя', month: 'Месяц' };
                          const range = getRange();
                          const isActive = chartFrom === range.from && chartTo === range.to;
                          return (
                            <button
                              key={preset}
                              type="button"
                              className={`cabinet-stats-chart-filter-btn ${isActive ? 'cabinet-stats-chart-filter-btn--active' : ''}`}
                              onClick={() => { setChartFrom(range.from); setChartTo(range.to); }}
                            >
                              {labels[preset]}
                            </button>
                          );
                        })}
                      </div>
                      <div className="cabinet-stats-chart-period">
                        <label>Период:</label>
                        <input
                          type="date"
                          value={chartFrom}
                          onChange={(e) => setChartFrom(e.target.value)}
                          className="cabinet-stats-chart-input"
                        />
                        <span>—</span>
                        <input
                          type="date"
                          value={chartTo}
                          onChange={(e) => setChartTo(e.target.value)}
                          className="cabinet-stats-chart-input"
                        />
                      </div>
                      <div className="cabinet-stats-chart-metric">
                        <label>Метрика:</label>
                        <select
                          value={chartMetric}
                          onChange={(e) => setChartMetric(e.target.value as typeof chartMetric)}
                          className="cabinet-stats-chart-select"
                        >
                          <option value="gamesPlayed">Сыграно раундов</option>
                          <option value="wins">Побед</option>
                          <option value="totalWinnings">Сумма выигрыша</option>
                          <option value="correctAnswers">Верных ответов</option>
                        </select>
                      </div>
                      <div className="cabinet-stats-chart-metric">
                        <label>Режим:</label>
                        <select
                          value={chartGameType}
                          onChange={(e) => setChartGameType(e.target.value as typeof chartGameType)}
                          className="cabinet-stats-chart-select"
                        >
                          <option value="all">Общая</option>
                          <option value="training">Тренировка</option>
                          <option value="money">Противостояние</option>
                        </select>
                      </div>
                    </div>
                    <div className="cabinet-stats-chart-area cabinet-stats-chart-area--personal">
                      {chartData.length === 0 ? (
                        <p className="cabinet-stats-chart-empty">Нет данных за выбранный период</p>
                      ) : (
                        (() => {
                          const maxVal = Math.max(1, ...chartData.map((d) => d.value));
                          const formatVal = (v: number) => chartMetric === 'totalWinnings' ? `${formatNum(v)} ${CURRENCY}` : formatNum(v);
                          const gridLevels = [100, 75, 50, 25];
                          const chartMinWidth = Math.max(chartData.length * 28, 280);
                          return (
                            <div className="cabinet-stats-chart-scroll" style={{ minWidth: 0 }}>
                              <div className="cabinet-stats-chart-scroll-inner" style={{ minWidth: chartMinWidth }}>
                                <div className="cabinet-stats-chart-plot">
                                  <div className="cabinet-stats-chart-grid" aria-hidden>
                                    {gridLevels.map((pct, i) => (
                                      <div key={i} className="cabinet-stats-chart-grid-line" style={{ bottom: `${pct}%` }} />
                                    ))}
                                  </div>
                                  <div className="cabinet-stats-chart-yaxis">
                                    {gridLevels.map((pct, i) => {
                                      const val = Math.round((maxVal * pct) / 100);
                                      if (val === 0) return null;
                                      return (
                                        <div key={i} className="cabinet-stats-chart-yaxis-tick" style={{ bottom: `${pct}%` }}>
                                          {formatVal(val)}
                                        </div>
                                      );
                                    })}
                                  </div>
                                  <div className="cabinet-stats-chart-bars">
                                    {chartData.map((d) => (
                                      <div key={d.date} className="cabinet-stats-chart-bar-wrap">
                                        <div className="cabinet-stats-chart-bar-container">
                                          <div
                                            className="cabinet-stats-chart-bar cabinet-stats-chart-bar--volumetric"
                                            style={{ height: `${maxVal > 0 ? (d.value / maxVal) * 100 : 0}%` }}
                                            title={`${d.date}: ${formatVal(d.value)}`}
                                          />
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                                <div className="cabinet-stats-chart-labels">
                                  {chartData.map((d) => (
                                    <div key={d.date} className="cabinet-stats-chart-label-wrap">
                                      <span className="cabinet-stats-chart-value">{formatVal(d.value)}</span>
                                      <span className="cabinet-stats-chart-label">{parseInt(d.date.slice(8), 10)}</span>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            </div>
                          );
                        })()
                      )}
                    </div>
                  </div>
                  </div>
                )}
              </>
            )}
            {statsMode === 'general' && (
              <>
                <div className="cabinet-global-stats">
                  <h3 className="cabinet-global-stats-title">Общая статистика</h3>
                  {globalStatsError && <p className="cabinet-global-stats-error">{globalStatsError}</p>}
                  <div className="cabinet-global-stats-grid">
                    <div className="cabinet-global-stat-item">
                      <span className="cabinet-global-stat-value">{globalStats ? formatNum(globalStats.totalUsers) : '—'}</span>
                      <span className="cabinet-global-stat-label">Зарегистрировано пользователей</span>
                    </div>
                    <div className="cabinet-global-stat-item">
                      <span className="cabinet-global-stat-value">{globalStats ? formatNum(globalStats.totalGamesPlayed) : '—'}</span>
                      <span className="cabinet-global-stat-label">Сыграно раундов</span>
                    </div>
                    <div className="cabinet-global-stat-item">
                      <span className="cabinet-global-stat-value">{globalStats ? formatNum(globalStats.totalTournaments) : '—'}</span>
                      <span className="cabinet-global-stat-label">Сыграно турниров</span>
                    </div>
                    <div className="cabinet-global-stat-item">
                      <span className="cabinet-global-stat-value">{globalStats ? formatNum(globalStats.onlineCount) : '—'}</span>
                      <span className="cabinet-global-stat-label">Онлайн</span>
                    </div>
                    <div className="cabinet-global-stat-item">
                      <span className="cabinet-global-stat-value">{globalStats ? `${formatNum(globalStats.totalEarnings)} ${CURRENCY}` : '—'}</span>
                      <span className="cabinet-global-stat-label">Общий заработок игроков</span>
                    </div>
                    <div className="cabinet-global-stat-item">
                      <span className="cabinet-global-stat-value">{globalStats ? `${formatNum(globalStats.totalWithdrawn)} ₽` : '—'}</span>
                      <span className="cabinet-global-stat-label">Выведено денег</span>
                    </div>
                  </div>
                </div>
                <div className="cabinet-rankings-centered">
                  <h3 className="cabinet-rankings-centered-title">Рейтинг</h3>
                  <div className="cabinet-rankings-metric-tabs">
                    {([
                      { key: 'gamesPlayed', label: 'Сыграно раундов' },
                      { key: 'wins', label: 'Побед' },
                      { key: 'correctAnswers', label: 'Верных ответов' },
                      { key: 'correctAnswerRate', label: '% верных ответов' },
                      { key: 'totalWinnings', label: 'Сумма выигрыша' },
                      { key: 'referrals', label: 'Кол-во рефералов' },
                      { key: 'totalWithdrawn', label: 'Сумма вывода' },
                    ] as { key: typeof rankingMetric; label: string }[]).map((m) => (
                      <button
                        key={m.key}
                        type="button"
                        className={`cabinet-rankings-metric-btn ${rankingMetric === m.key ? 'cabinet-rankings-metric-btn--active' : ''}`}
                        onClick={() => setRankingMetric(m.key)}
                      >
                        {m.label}
                      </button>
                    ))}
                  </div>
                  <div className="cabinet-rankings-content">
                    {rankingsError && <p style={{ color: '#c00', margin: 0 }}>{rankingsError}</p>}
                    {!rankingsError && rankings && (
                      <>
                        <div className="cabinet-rankings-my">
                          Ваше место: <strong>{rankings.myRank != null ? `${rankings.myRank} из ${rankings.totalParticipants}` : '—'}</strong>
                          {rankings.myValue != null && (
                            <span className="cabinet-rankings-my-value">
                              {' '}({rankingMetric === 'totalWinnings' ? `${formatNum(rankings.myValue)} ${CURRENCY}` : rankingMetric === 'totalWithdrawn' ? `${formatNum(rankings.myValue)} ₽` : rankingMetric === 'correctAnswerRate' ? `${rankings.myValue}%` : formatNum(rankings.myValue)})
                            </span>
                          )}
                        </div>
                        <div className="cabinet-rankings-table">
                          <div className="cabinet-rankings-header">
                            <span>#</span>
                            <span>Игрок</span>
                            <span>Значение</span>
                          </div>
                          {rankings.rankings.slice(0, 100).map((r) => (
                            <div
                              key={r.userId}
                              className={`cabinet-rankings-row ${r.userId === user?.id ? 'cabinet-rankings-row--me' : ''}`}
                            >
                              <span>{r.rank}</span>
                              <span>{r.displayName}</span>
                              <span>{r.valueFormatted}</span>
                            </div>
                          ))}
                        </div>
                      </>
                    )}
                  </div>
                </div>
              </>
            )}
          </div>
        )}
        {(section === 'games' || section === 'games-training' || section === 'games-money') && (
          <div className={`cabinet-games ${gameMode === 'training' ? 'cabinet-games--training' : gameMode === 'money' ? 'cabinet-games--money' : ''}`}>
            {gameMode === null && <h2>Игры</h2>}
            {gameMode === null ? (
              <div className="game-modes">
                <button
                  type="button"
                  className="game-mode-card game-mode-card-training"
                  onClick={() => setGameMode('training')}
                >
                  <span className="game-mode-card-overlay" aria-hidden />
                  <span className="game-mode-title">Тренировка</span>
                  <span className="game-mode-desc">Игра без ставок, отработка навыков</span>
                </button>
                <button
                  type="button"
                  className="game-mode-card game-mode-card-tournament"
                  onClick={() => setGameMode('money')}
                >
                  <span className="game-mode-card-overlay" aria-hidden />
                  <span className="game-mode-title">Противостояние</span>
                  <span className="game-mode-desc">Борьба за деньги, режим на реальные ставки</span>
                </button>
              </div>
            ) : (
              <div className="game-mode-content">
                {gameMode === 'training' && (
                  <div className="game-mode-panel training-panel">
                    <h3>Тренировка</h3>
                    {!trainingData ? (
                      <div className="training-start">
                        <p>Турнир из двух полуфиналов и финала. В каждом матче — 10 вопросов.</p>
                        <div className="training-start-buttons">
                          <button
                            type="button"
                            className="training-start-btn"
                            onClick={() => {
                              setPendingStartGameAction(() => () => { startTraining(); });
                              setShowStartGameConfirm(true);
                            }}
                            disabled={trainingLoading || continueTrainingLoading !== null}
                          >
                            {trainingLoading ? 'Загрузка...' : 'Начать игру'}
                          </button>
                          <button
                            type="button"
                            className="game-mode-back"
                            onClick={() => { saveTrainingProgress(); setGameMode(null); }}
                          >
                            ← Назад к выбору режима
                          </button>
                        </div>
                        {trainingError && <p className="training-error">{trainingError}</p>}
                        <div className="game-history">
                          <div className="game-history-section">
                            <div className="game-history-section-header">
                              <strong>Активные игры</strong>
                              {gameHistory?.active?.some((t) => t.userStatus === 'not_passed') && (() => {
                                const sorted = [...(gameHistory?.active ?? [])].sort((a, b) => a.id - b.id);
                                const tbReady = sorted.find((t) => t.resultLabel === 'Доп. раунд');
                                const finalReady = sorted.find((t) => t.resultLabel === 'Финал');
                                const continuable = sorted.find((t) => t.userStatus === 'not_passed' && t.resultLabel !== 'Ожидание соперника');
                                const target = tbReady ?? finalReady ?? continuable;
                                if (!target) return null;
                                return (
                                  <button
                                    type="button"
                                    className="confrontation-continue-btn"
                                    onClick={() => {
                                      setPendingStartGameAction(() => () => { continueTraining(target.id); });
                                      setShowStartGameConfirm(true);
                                    }}
                                    disabled={continueTrainingLoading !== null}
                                  >
                                    {continueTrainingLoading !== null ? 'Загрузка...' : `Продолжить игру #${target.id}`}
                                  </button>
                                );
                              })()}
                            </div>
                            {gameHistory === null ? null : gameHistory.active.length ? (
                              <div className="game-history-table-wrap">
                              <table className="game-history-table">
                                <thead>
                                  <tr>
                                    <th>№ турнира</th>
                                    <th>Этап</th>
                                    <th className="game-history-questions-col"><span className="game-history-questions-tooltip" data-tooltip="Формат: всего / отвечено / верных. Пример: 10/10/7 = всего 10 вопросов, отвечено 10, верных 7" tabIndex={0} onClick={(e) => { const el = e.currentTarget; if (el.classList.contains('tooltip-active')) { el.classList.remove('tooltip-active'); el.blur(); } else { el.classList.add('tooltip-active'); } }} onBlur={(e) => e.currentTarget.classList.remove('tooltip-active')}>Вопросы</span></th>
                                    <th>Осталось до конца</th>
                                    <th>Статус</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {gameHistory.active.map((t) => (
                                    <tr key={t.id}>
                                      <td>
                                        <button type="button" className="game-history-id-link" onClick={() => openBracket(t.id, 'active')} title="Открыть сетку турнира">
                                          #{t.id}
                                        </button>
                                      </td>
                                      <td>{t.stage ?? 'Полуфинал'}</td>
                                      <td className="game-history-questions-col">
                                        <button type="button" className="game-history-questions-link" onClick={() => openQuestionsReview(t.id, t.roundForQuestions ?? (t.stage === 'Финал' ? 'final' : 'semi'))} title="Посмотреть вопросы турнира">
                                          {(t as any).questionsTotal ?? 10}/{(t as any).questionsAnswered ?? 0}/{(t as any).correctAnswersInRound ?? 0}
                                        </button>
                                      </td>
                                      <td>{t.deadline ? (new Date(t.deadline) > new Date() ? formatTimeLeft(t.deadline) : 'Время вышло') : '—'}</td>
                                      <td>
                                        <span className={`game-history-status game-history-status--${t.resultLabel === 'Победа' ? 'victory' : t.resultLabel === 'Поражение' ? 'defeat' : t.resultLabel === 'Время истекло' ? 'time-expired' : t.resultLabel === 'Финал' ? 'final-ready' : t.resultLabel === 'Доп. раунд' ? 'tiebreaker' : t.resultLabel === 'Ожидание соперника' ? 'stage-passed' : 'stage-not-passed'}`}>
                                          {t.resultLabel ?? 'Этап не пройден'}
                                        </span>
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                              </div>
                            ) : (
                              <p className="game-history-empty">Нет активных турниров</p>
                            )}
                            {continueTrainingError && <p className="training-error">{continueTrainingError}</p>}
                          </div>
                          <div className="game-history-section">
                            <strong>История игр</strong>
                            {gameHistory === null ? null : gameHistory.completed.length ? (
                              <div className="game-history-table-wrap">
                              <table className="game-history-table">
                                <thead>
                                  <tr>
                                    <th>№ турнира</th>
                                    <th>Этап</th>
                                    <th className="game-history-questions-col"><span className="game-history-questions-tooltip" data-tooltip="Формат: всего / отвечено / верных. Пример: 10/10/7 = всего 10 вопросов, отвечено 10, верных 7" tabIndex={0} onClick={(e) => { const el = e.currentTarget; if (el.classList.contains('tooltip-active')) { el.classList.remove('tooltip-active'); el.blur(); } else { el.classList.add('tooltip-active'); } }} onBlur={(e) => e.currentTarget.classList.remove('tooltip-active')}>Вопросы</span></th>
                                    <th>Дата завершения</th>
                                    <th>Статус</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {gameHistory.completed.map((t) => (
                                    <tr key={t.id}>
                                      <td>
                                        <button type="button" className="game-history-id-link" onClick={() => openBracket(t.id, 'completed')} title="Открыть сетку турнира">
                                          #{t.id}
                                        </button>
                                      </td>
                                      <td>{t.stage ?? 'Полуфинал'}</td>
                                      <td className="game-history-questions-col">
                                        <button type="button" className="game-history-questions-link" onClick={() => openQuestionsReview(t.id, t.roundForQuestions ?? (t.stage === 'Финал' ? 'final' : 'semi'))} title="Посмотреть вопросы турнира">
                                          {(t as any).questionsTotal ?? 10}/{(t as any).questionsAnswered ?? 0}/{(t as any).correctAnswersInRound ?? 0}
                                        </button>
                                      </td>
                                      <td>{(t as any).completedAt ? formatMoscowDateTime((t as any).completedAt) : '—'}</td>
                                      <td><span className={`game-history-status game-history-status--${t.resultLabel === 'Победа' ? 'victory' : t.resultLabel === 'Поражение' ? 'defeat' : t.resultLabel === 'Время истекло' ? 'time-expired' : t.resultLabel === 'Доп. раунд' ? 'tiebreaker' : t.resultLabel === 'Ожидание соперника' ? 'stage-passed' : 'stage-not-passed'}`}>{t.resultLabel ?? 'Этап не пройден'}</span></td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                              </div>
                            ) : (
                              <p className="game-history-empty">Нет завершённых турниров</p>
                            )}
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="training-bracket">
                        <div className="bracket-header">
                          {trainingRound === 0 && <span className="bracket-round active">Полуфинал</span>}
                          {trainingRound === 2 && <span className="bracket-round active">Финал</span>}
                          {trainingRound === 3 && <span className="bracket-round active">Доп. раунд {trainingData?.tiebreakerPhase === 'final' ? '(финал)' : '(полуфинал)'}</span>}
                        </div>
                        {trainingRoundComplete ? (
                          <div className="training-round-result">
                            <p>
                              Вы ответили на {trainingRoundScores[trainingRoundScores.length - 1]} из {currentQuestions.length} вопросов верно.
                            </p>
                            {trainingRound === 2 && (
                              <button type="button" className="training-next-round-btn" style={{ marginBottom: 8, background: '#27ae60' }} onClick={goNextRound}>
                                Завершить турнир
                              </button>
                            )}
                            {trainingRound === 3 && (
                              <button type="button" className="training-next-round-btn" style={{ marginBottom: 8, background: '#2980b9' }} onClick={goNextRound}>
                                Завершить доп. раунд
                              </button>
                            )}
                            <button type="button" className="training-next-round-btn" onClick={resetTraining}>
                              {trainingRound === 2 ? 'Выйти' : trainingRound === 3 ? 'Выйти' : 'Завершить полуфинал'}
                            </button>
                          </div>
                        ) : isForfeited ? (
                          <div className="training-question-block training-forfeit">
                            <p className="training-forfeit-text">Время вышло. Вы считаетесь проигравшим.</p>
                            <button type="button" className="training-next-question-btn" onClick={resetTraining}>
                              Выйти
                            </button>
                          </div>
                        ) : currentQuestion ? (
                          <div className="training-question-block" key={blinkKey}>
                            <p className="training-round-label">Вопрос {trainingQuestionIndex + 1} из {currentQuestions.length}</p>
                            <p className="training-question-text">{currentQuestion.question}</p>
                            <div className="training-timer-wrap">
                              <p className="training-timer-label">
                                Осталось: {timeLeft} сек
                              </p>
                              <div className="training-timer-track">
                                <div
                                  key={timerKey}
                                  className={`training-timer-fill ${timerPaused ? 'training-timer-fill--paused' : ''}`}
                                  style={{ animationDuration: `${QUESTION_TIMER_SEC}s` }}
                                />
                              </div>
                            </div>
                            <div className="training-options">
                              {currentQuestion.options.map((opt, idx) => (
                                <button
                                  key={idx}
                                  type="button"
                                  className={`training-option ${answered && currentQuestion.correctAnswer === idx ? 'training-option-correct training-blink-3' : ''} ${answered && !isCorrect && answerForCurrentQuestion === idx ? 'training-option-wrong' : ''}`}
                                  onClick={() => chooseTrainingAnswer(idx)}
                                  disabled={answered}
                                >
                                  {opt}
                                </button>
                              ))}
                            </div>
                            {answered && (
                              <button type="button" className="training-next-question-btn" onClick={goToNextQuestion}>
                                {isLastQuestion ? 'Завершить игру' : 'Следующий вопрос'}
                              </button>
                            )}
                          </div>
                        ) : null}
                        {!trainingRoundComplete && (
                          <button type="button" className="training-reset-btn" onClick={resetTraining}>
                            Выйти из турнира
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                )}
                {gameMode === 'money' && (
                  <>
                    <div className="game-mode-panel training-panel">
                      <h3>Противостояние</h3>
                      {!tournamentJoinInfo ? (
                        <div className="training-start">
                          <p>Два полуфинала и финал. Вы играете против других игроков. Первый нажавший создаёт турнир, остальные присоединяются в свободные места.</p>
                          {(() => {
                            const leagues = allLeagues ?? [];
                            const isSelectedAllowed = (allowedLeagues ?? []).includes(selectedLeague ?? 5);
                            const balance = user?.balance ?? 0;
                            const idx = leagues.indexOf(selectedLeague ?? 5);
                            const minBalanceFirst = 5;
                            const minBalanceOther = (selectedLeague ?? 5) * 10;
                            const prevAmount = idx > 0 ? leagues[idx - 1] : null;
                            const winsPrev = prevAmount != null ? ((leagueWins || {})[prevAmount] ?? 0) : 0;
                            const conditionItems: { label: string; value: string }[] = [];
                            if (!isSelectedAllowed && (selectedLeague ?? 0) && idx >= 0) {
                              if (idx === 0 && balance < minBalanceFirst) {
                                conditionItems.push({ label: 'Минимальный баланс', value: `${formatNum(minBalanceFirst)} ${CURRENCY} (у вас ${formatNum(balance)} ${CURRENCY})` });
                              } else if (idx > 0) {
                                if (balance < minBalanceOther) {
                                  conditionItems.push({ label: 'Минимальный баланс', value: `${formatNum(minBalanceOther)} ${CURRENCY} (у вас ${formatNum(balance)} ${CURRENCY})` });
                                }
                                if (prevAmount != null && winsPrev < 10) {
                                  conditionItems.push({ label: 'Количество побед в предыдущей лиге', value: `10 (у вас ${formatNum(winsPrev)})` });
                                }
                              }
                            }
                            const hasConditions = conditionItems.length > 0;
                            const insufficientFunds = !hasConditions && isSelectedAllowed && balance < (selectedLeague ?? 5);
                            return (
                              <>
                                <div className="confrontation-league-conditions confrontation-league-conditions-top">
                                  <strong>Условия лиги</strong>
                                  {hasConditions ? (
                                    <ol className="confrontation-league-conditions-list">
                                      {conditionItems.map((item, i) => (
                                        <li key={i}>{item.label}: {item.value}</li>
                                      ))}
                                    </ol>
                                  ) : insufficientFunds ? (
                                    <p className="confrontation-league-conditions-insufficient">
                                      Недостаточно средств для входа в лигу. Нужно {formatNum(selectedLeague ?? 5)} {CURRENCY}, у вас {formatNum(balance)} {CURRENCY}.
                                    </p>
                                  ) : (
                                    <p className="confrontation-league-conditions-placeholder">Все условия выполнены</p>
                                  )}
                                </div>
                                <div className="confrontation-league-carousel-block">
                                  {allowedLeaguesLoading ? (
                                    <p className="confrontation-league-loading">Загрузка лиг...</p>
                                  ) : (allLeagues ?? []).length > 0 ? (
                                    <>
                                      <div className="confrontation-league-carousel">
                                        <button
                                          type="button"
                                          className="confrontation-carousel-arrow confrontation-carousel-prev"
                                          onClick={() => {
                                            const list = allLeagues ?? [];
                                            const next = leagueCarouselIndex <= 0 ? list.length - 1 : leagueCarouselIndex - 1;
                                            setLeagueCarouselIndex(next);
                                            setSelectedLeague(list[next] ?? 5);
                                          }}
                                          aria-label="Предыдущая лига"
                                        >
                                          ‹
                                        </button>
                                        <div className="confrontation-carousel-slide">
                                          {(() => {
                                            const list = allLeagues ?? [];
                                            const n = list.length;
                                            if (n === 0) return null;
                                            const renderCard = (amount: number, side: 'prev' | 'center' | 'next') => {
                                              const gem = LEAGUE_GEMS[amount] ?? { name: `Лига ${formatNum(amount)} ${CURRENCY}`, color: '#888' };
                                              const isAllowed = (allowedLeagues ?? []).includes(amount);
                                              const online = (playersOnlineByLeague ?? {})[amount] ?? 0;
                                              return (
                                                <button
                                                  key={`${amount}-${side}`}
                                                  type="button"
                                                  className={`confrontation-carousel-card confrontation-carousel-card-${side} ${!isAllowed ? 'confrontation-league-locked' : ''}`}
                                                  onClick={() => { setLeagueCarouselIndex(list.indexOf(amount)); setSelectedLeague(amount); }}
                                                >
                                                  <div className="confrontation-carousel-card-image">
                                                    {LEAGUE_IMAGES[amount] ? (
                                                      <>
                                                        <img
                                                          src={LEAGUE_IMAGES[amount]}
                                                          alt=""
                                                          className="confrontation-league-image"
                                                          onError={(e) => {
                                                            const t = e.target as HTMLImageElement;
                                                            if (t && !t.dataset.fallback) {
                                                              t.style.display = 'none';
                                                              const fallback = t.nextElementSibling as HTMLElement;
                                                              if (fallback) fallback.style.display = 'flex';
                                                              t.dataset.fallback = '1';
                                                            }
                                                          }}
                                                        />
                                                        <span className="confrontation-league-image-fallback" style={{ display: 'none' }}>
                                                          <GemIcon amount={amount} />
                                                        </span>
                                                      </>
                                                    ) : (
                                                      <GemIcon amount={amount} />
                                                    )}
                                                  </div>
                                                  <div className="confrontation-carousel-card-overlay">
                                                    <div className="confrontation-carousel-name">{gem.name}</div>
                                                    <div className="confrontation-carousel-online">{formatNum(online)} онлайн</div>
                                                  </div>
                                                </button>
                                              );
                                            };
                                            const prevIdx = leagueCarouselIndex <= 0 ? n - 1 : leagueCarouselIndex - 1;
                                            const nextIdx = leagueCarouselIndex >= n - 1 ? 0 : leagueCarouselIndex + 1;
                                            const centerAmount = list[leagueCarouselIndex] ?? list[0] ?? 5;
                                            const prevAmount = list[prevIdx] ?? centerAmount;
                                            const nextAmount = list[nextIdx] ?? centerAmount;
                                            if (n === 1) {
                                              return renderCard(centerAmount, 'center');
                                            }
                                            return (
                                              <>
                                                {renderCard(prevAmount, 'prev')}
                                                {renderCard(centerAmount, 'center')}
                                                {renderCard(nextAmount, 'next')}
                                              </>
                                            );
                                          })()}
                                        </div>
                                        <button
                                          type="button"
                                          className="confrontation-carousel-arrow confrontation-carousel-next"
                                          onClick={() => {
                                            const list = allLeagues ?? [];
                                            const next = leagueCarouselIndex >= list.length - 1 ? 0 : leagueCarouselIndex + 1;
                                            setLeagueCarouselIndex(next);
                                            setSelectedLeague(list[next] ?? 5);
                                          }}
                                          aria-label="Следующая лига"
                                        >
                                          ›
                                        </button>
                                      </div>
                                      <div className="confrontation-carousel-dots">
                                        {(allLeagues ?? []).map((_, i) => (
                                          <button
                                            key={i}
                                            type="button"
                                            className={`confrontation-carousel-dot ${i === leagueCarouselIndex ? 'active' : ''}`}
                                            onClick={() => { setLeagueCarouselIndex(i); setSelectedLeague((allLeagues ?? [])[i] ?? 5); }}
                                            aria-label={`Лига ${i + 1}`}
                                          />
                                        ))}
                                      </div>
                                      <div className="confrontation-carousel-cost-prize">
                                        <div className="confrontation-carousel-cost">
                                          Стоимость участия: {formatNum(selectedLeague ?? 5)} {CURRENCY}
                                        </div>
                                        <div className="confrontation-carousel-prize">
                                          Возможный выигрыш: {formatNum(getLeaguePrize(selectedLeague ?? 5))} {CURRENCY}
                                        </div>
                                      </div>
                                    </>
                                  ) : null}
                                </div>
                                <button
                                  type="button"
                                  className="confrontation-start-btn"
                                  onClick={() => {
                                    setPendingStartGameAction(() => () => { joinTournament(selectedLeague ?? 5); });
                                    setShowStartGameConfirm(true);
                                  }}
                                  disabled={
                                    tournamentJoinLoading ||
                                    allowedLeaguesLoading ||
                                    !isSelectedAllowed ||
                                    balance < (selectedLeague ?? 5)
                                  }
                                  title={
                                    tournamentJoinLoading || allowedLeaguesLoading
                                      ? undefined
                                      : hasConditions
                                        ? conditionItems.map((i) => `${i.label}: ${i.value}`).join('. ')
                                        : isSelectedAllowed && balance < (selectedLeague ?? 5)
                                          ? `Нужно ${formatNum(selectedLeague ?? 5)} ${CURRENCY}, у вас ${formatNum(balance)} ${CURRENCY}`
                                          : undefined
                                  }
                                >
                                  {tournamentJoinLoading ? 'Загрузка...' : 'Начать игру'}
                                </button>
                              </>
                            );
                          })()}
                          <div className="training-start-buttons">
                            <button
                              type="button"
                              className="game-mode-back"
                              onClick={() => { saveTrainingProgress(); setGameMode(null); }}
                            >
                              ← Назад к выбору режима
                            </button>
                          </div>
                          {tournamentJoinError && <p className="training-error">{tournamentJoinError}</p>}
                          {continueTournamentError && <p className="training-error">{continueTournamentError}</p>}
                          <div className="game-history">
                            <div className="game-history-section">
                              <div className="game-history-section-header">
                                <strong>Активные игры</strong>
                                {gameHistory?.active?.some((t) => t.userStatus === 'not_passed') && (
                                    (() => {
                                    const notPassed = [...(gameHistory?.active?.filter((t) => t.userStatus === 'not_passed') ?? [])].sort((a, b) => a.id - b.id);
                                    const first = notPassed.find((t) => t.resultLabel !== 'Ожидание соперника') ?? notPassed[0];
                                    const allWaitingForOpponent = notPassed.length > 0 && notPassed.every((t) => t.resultLabel === 'Ожидание соперника');
                                    return (
                                      <button
                                        type="button"
                                        className="confrontation-continue-btn"
                                        onClick={() => {
                                          if (first) {
                                            setPendingStartGameAction(() => () => { continueTournament(first.id); });
                                            setShowStartGameConfirm(true);
                                          }
                                        }}
                                        disabled={continueTournamentLoading !== null || allWaitingForOpponent}
                                        title={allWaitingForOpponent ? 'Все вопросы отвечены, ожидание соперника' : undefined}
                                      >
                                        {continueTournamentLoading !== null ? 'Загрузка...' : first ? `Продолжить игру #${first.id}` : 'Продолжить игру'}
                                      </button>
                                    );
                                  })()
                                )}
                              </div>
                              {gameHistory === null ? null : gameHistory.active.length ? (
                                <div className="game-history-table-wrap">
                                <table className="game-history-table">
                                  <thead>
                                    <tr>
                                      <th>№ турнира</th>
                                      <th>Стоимость лиги</th>
                                      <th>Этап</th>
                                      <th className="game-history-questions-col"><span className="game-history-questions-tooltip" data-tooltip="Формат: всего / отвечено / верных. Пример: 10/10/7 = всего 10 вопросов, отвечено 10, верных 7" tabIndex={0} onClick={(e) => { const el = e.currentTarget; if (el.classList.contains('tooltip-active')) { el.classList.remove('tooltip-active'); el.blur(); } else { el.classList.add('tooltip-active'); } }} onBlur={(e) => e.currentTarget.classList.remove('tooltip-active')}>Вопросы</span></th>
                                      <th>Осталось до конца</th>
                                      <th>Статус</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {gameHistory.active.map((t) => (
                                      <tr key={t.id}>
                                        <td>
                                          <button type="button" className="game-history-id-link" onClick={() => openBracket(t.id, 'active')} title="Открыть сетку турнира">
                                            #{t.id}
                                          </button>
                                        </td>
                                        <td>{(t as { leagueAmount?: number | null }).leagueAmount != null ? `${formatNum((t as { leagueAmount: number }).leagueAmount)} ${CURRENCY}` : '—'}</td>
                                        <td>{t.stage ?? 'Полуфинал'}</td>
                                        <td className="game-history-questions-col">
                                          <button type="button" className="game-history-questions-link" onClick={() => openQuestionsReview(t.id, t.roundForQuestions ?? (t.stage === 'Финал' ? 'final' : 'semi'))} title="Посмотреть вопросы турнира">
                                            {(t as any).questionsTotal ?? 10}/{(t as any).questionsAnswered ?? 0}/{(t as any).correctAnswersInRound ?? 0}
                                          </button>
                                        </td>
                                        <td>{t.deadline ? (new Date(t.deadline) > new Date() ? formatTimeLeft(t.deadline) : 'Время вышло') : '—'}</td>
                                        <td><span className={`game-history-status game-history-status--${t.resultLabel === 'Победа' ? 'victory' : t.resultLabel === 'Поражение' ? 'defeat' : t.resultLabel === 'Время истекло' ? 'time-expired' : t.resultLabel === 'Доп. раунд' ? 'tiebreaker' : t.resultLabel === 'Ожидание соперника' ? 'stage-passed' : 'stage-not-passed'}`}>{t.resultLabel ?? 'Этап не пройден'}</span></td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                                </div>
                              ) : (
                                <p className="game-history-empty">Нет активных турниров</p>
                              )}
                            </div>
                            <div className="game-history-section">
                              <strong>История игр</strong>
                              {gameHistory === null ? null : gameHistory.completed.length ? (
                                <div className="game-history-table-wrap">
                                <table className="game-history-table">
                                  <thead>
                                    <tr>
                                      <th>№ турнира</th>
                                      <th>Стоимость лиги</th>
                                      <th>Этап</th>
                                      <th className="game-history-questions-col"><span className="game-history-questions-tooltip" data-tooltip="Формат: всего / отвечено / верных. Пример: 10/10/7 = всего 10 вопросов, отвечено 10, верных 7" tabIndex={0} onClick={(e) => { const el = e.currentTarget; if (el.classList.contains('tooltip-active')) { el.classList.remove('tooltip-active'); el.blur(); } else { el.classList.add('tooltip-active'); } }} onBlur={(e) => e.currentTarget.classList.remove('tooltip-active')}>Вопросы</span></th>
                                      <th>Дата завершения</th>
                                      <th>Статус</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {gameHistory.completed.map((t) => (
                                      <tr key={t.id}>
                                        <td>
                                          <button type="button" className="game-history-id-link" onClick={() => openBracket(t.id, 'completed')} title="Открыть сетку турнира">
                                            #{t.id}
                                          </button>
                                        </td>
                                        <td>{(t as { leagueAmount?: number | null }).leagueAmount != null ? `${formatNum((t as { leagueAmount: number }).leagueAmount)} ${CURRENCY}` : '—'}</td>
                                        <td>{t.stage ?? 'Полуфинал'}</td>
                                        <td className="game-history-questions-col">
                                          <button type="button" className="game-history-questions-link" onClick={() => openQuestionsReview(t.id, t.roundForQuestions ?? (t.stage === 'Финал' ? 'final' : 'semi'))} title="Посмотреть вопросы турнира">
                                            {(t as any).questionsTotal ?? 10}/{(t as any).questionsAnswered ?? 0}/{(t as any).correctAnswersInRound ?? 0}
                                          </button>
                                        </td>
                                        <td>{(t as any).completedAt ? formatMoscowDateTime((t as any).completedAt) : '—'}</td>
                                        <td><span className={`game-history-status game-history-status--${t.resultLabel === 'Победа' ? 'victory' : t.resultLabel === 'Поражение' ? 'defeat' : t.resultLabel === 'Время истекло' ? 'time-expired' : t.resultLabel === 'Доп. раунд' ? 'tiebreaker' : t.resultLabel === 'Ожидание соперника' ? 'stage-passed' : 'stage-not-passed'}`}>{t.resultLabel ?? 'Этап не пройден'}</span></td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                                </div>
                              ) : (
                                <p className="game-history-empty">Нет завершённых турниров</p>
                              )}
                            </div>
                          </div>
                        </div>
                      ) : trainingData && tournamentJoinInfo?.tournamentId === trainingData.tournamentId ? (
                        <div className="training-bracket">
                          <div className="bracket-header">
                            {(trainingRound === 0 || trainingRound === 1) && <span className="bracket-round active">Полуфинал</span>}
                            {trainingRound === 2 && <span className="bracket-round active">Финал</span>}
                            {trainingRound === 3 && <span className="bracket-round active">Доп. раунд {trainingData?.tiebreakerPhase === 'final' ? '(финал)' : '(полуфинал)'}</span>}
                            {tournamentJoinInfo && tournamentJoinInfo.totalPlayers < 4 && (
                              <span className="bracket-waiting-hint">Заполнено {tournamentJoinInfo.totalPlayers} из 4 мест. Играйте — соперники могут присоединиться.</span>
                            )}
                            <button type="button" className="game-history-id-link bracket-header-grid-link" onClick={() => openBracket(tournamentJoinInfo!.tournamentId, 'active')} title="Открыть сетку турнира">
                              Сетка #{tournamentJoinInfo!.tournamentId}
                            </button>
                          </div>
                          {trainingRoundComplete ? (
                            <div className="training-round-result">
                              <p>
                                Вы ответили на {trainingRoundScores[trainingRoundScores.length - 1]} из {currentQuestions.length} вопросов верно.
                              </p>
                              {trainingRound === 2 && (
                                <button type="button" className="training-next-round-btn" style={{ marginBottom: 8, background: '#27ae60' }} onClick={goNextRound}>
                                  Завершить турнир
                                </button>
                              )}
                              {trainingRound === 3 && (
                                <button type="button" className="training-next-round-btn" style={{ marginBottom: 8, background: '#2980b9' }} onClick={goNextRound}>
                                  Завершить доп. раунд
                                </button>
                              )}
                              <button type="button" className="training-next-round-btn" onClick={() => { saveTrainingProgress(); setTrainingData(null); setTournamentJoinInfo(null); setTrainingRound(null); fetchGameHistory('money'); }}>
                                {trainingRound === 2 ? 'Выйти' : trainingRound === 3 ? 'Выйти' : 'Завершить полуфинал'}
                              </button>
                            </div>
                          ) : isForfeited ? (
                            <div className="training-question-block training-forfeit">
                              <p className="training-forfeit-text">Время вышло. Вы считаетесь проигравшим.</p>
                              <button type="button" className="training-next-question-btn" onClick={resetTraining}>
                                Выйти
                              </button>
                            </div>
                          ) : currentQuestion ? (
                            <div className="training-question-block" key={blinkKey}>
                              <p className="training-round-label">Вопрос {trainingQuestionIndex + 1} из {currentQuestions.length}</p>
                              <p className="training-question-text">{currentQuestion.question}</p>
                              <div className="training-timer-wrap">
                                <p className="training-timer-label">
                                  Осталось: {timeLeft} сек
                                </p>
                                <div className="training-timer-track">
                                  <div
                                    key={timerKey}
                                    className={`training-timer-fill ${timerPaused ? 'training-timer-fill--paused' : ''}`}
                                    style={{ animationDuration: `${QUESTION_TIMER_SEC}s` }}
                                  />
                                </div>
                              </div>
                              <div className="training-options">
                                {currentQuestion.options.map((opt, idx) => (
                                  <button
                                    key={idx}
                                    type="button"
                                    className={`training-option ${answered && currentQuestion.correctAnswer === idx ? 'training-option-correct training-blink-3' : ''} ${answered && !isCorrect && answerForCurrentQuestion === idx ? 'training-option-wrong' : ''}`}
                                    onClick={() => chooseTrainingAnswer(idx)}
                                    disabled={answered}
                                  >
                                    {opt}
                                  </button>
                                ))}
                              </div>
                              {answered && (
                                <button type="button" className="training-next-question-btn" onClick={goToNextQuestion}>
                                  {isLastQuestion ? 'Завершить игру' : 'Следующий вопрос'}
                                </button>
                              )}
                            </div>
                          ) : null}
                          {!trainingRoundComplete && (
                            <button type="button" className="training-reset-btn" onClick={() => { saveTrainingProgress(); setTrainingData(null); setTournamentJoinInfo(null); setTrainingRound(null); fetchGameHistory('money'); }}>
                              Выйти из турнира
                            </button>
                          )}
                        </div>
                      ) : (
                        <div className="training-start">
                          <p>
                            Вы в полуфинале {tournamentJoinInfo.semiIndex + 1}. Заполнено {tournamentJoinInfo.totalPlayers} из 4 мест. Ожидаем соперников…
                          </p>
                          <button type="button" className="game-history-id-link" style={{ marginBottom: 8 }} onClick={() => openBracket(tournamentJoinInfo!.tournamentId, 'active')} title="Открыть сетку турнира">
                            Сетка #{tournamentJoinInfo!.tournamentId}
                          </button>
                          {tournamentJoinInfo.deadline && (
                            <p className="training-deadline-label">
                              На ответы — 24 часа. До автоматического поражения: {formatTimeLeft(tournamentJoinInfo.deadline)}
                            </p>
                          )}
                          <button
                            type="button"
                            className="training-start-btn"
                            onClick={leaveTournamentQueue}
                          >
                            Покинуть турнир
                          </button>
                        </div>
                      )}
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        )}
        {((section === 'finance') || section === 'finance-topup' || section === 'finance-withdraw') && (() => {
          const searchSection = (() => { const p = new URLSearchParams(location.search); return p.get('section'); })() || 'finance';
          const isTopup = section === 'finance-topup' || searchSection === 'finance-topup';
          const isWithdraw = section === 'finance-withdraw' || searchSection === 'finance-withdraw';
          const goToFinanceSub = (sub: 'main' | 'topup' | 'withdraw') => {
            const h = sub === 'main' ? 'finance' : sub === 'topup' ? 'finance-topup' : 'finance-withdraw';
            const newSection: CabinetSection = sub === 'main' ? 'finance' : sub === 'topup' ? 'finance-topup' : 'finance-withdraw';
            navigate(`/profile?section=${encodeURIComponent(h)}`, { replace: true });
            localStorage.setItem(SECTION_STORAGE_KEY, newSection);
            setSection(newSection);
            setHashVersion((v) => v + 1);
          };
          const getCategoryLabel = (t: any) => {
            if (t?.category === 'topup' || t?.category === 'admin_credit' || t?.description?.includes?.('Пополнение')) return 'Пополнение';
            if (t?.category === 'withdraw' || t?.description?.toLowerCase?.().includes?.('вывод')) return 'Вывод средств';
            if (t?.category === 'convert' || t?.description?.includes?.('Конвертация')) return 'Конвертация';
            if (t?.category === 'referral' || t?.description?.includes?.('Реферал')) return 'Реферал';
            if (t?.category === 'win' || t?.description?.includes?.('Выигрыш')) return 'Выигрыш';
            if (t?.category === 'refund' || t?.description?.includes?.('Возврат')) return 'Возврат';
            if (t?.category === 'loss' && t?.tournamentId) return 'Списание за турнир';
            if (t?.description?.includes?.('Списание за турнир') || (t?.description?.includes?.('турнир') && Number(t?.amount) < 0)) return 'Списание за турнир';
            return Number(t?.amount) >= 0 ? 'Приход' : 'Расход';
          };
          const renderTransactionDescription = (t: { description?: string; tournamentId?: number | null; category?: string }) => {
            const desc = (t?.description ?? '').replace(/\s*\(скрипт\)\s*/g, '');
            if (t?.category === 'topup' || t?.category === 'admin_credit') return desc;
            const idMatch = desc?.match(/ID\s+(\d+)/);
            const tid = t?.tournamentId ?? (idMatch ? parseInt(idMatch[1], 10) : null);
            if (tid != null) {
              const btn = (
                <button type="button" className="transactions-tournament-id-link" onClick={() => openBracket(tid)} title="Открыть сетку турнира">
                  ID {tid}
                </button>
              );
              if (idMatch && idMatch.index != null) {
                const before = desc.slice(0, idMatch.index);
                const after = desc.slice(idMatch.index + idMatch[0].length);
                return <>{before}{btn}{after}</>;
              }
              return <>{desc} {btn}</>;
            }
            return desc;
          };
          const getAmountDisplay = (t: any) => {
            const amt = Number(t?.amount);
            const isTopup = t?.category === 'topup' || t?.description?.includes?.('Пополнение');
            const isWithdraw = t?.category === 'withdraw' || t?.description?.toLowerCase?.().includes?.('вывод');
            const isConvert = t?.category === 'convert' || t?.description?.includes?.('Конвертация');
            if (isConvert) {
              const absAmt = Math.abs(amt);
              const currency = amt > 0 ? CURRENCY : '₽';
              return `${formatNum(absAmt)} ${currency}`;
            }
            const sign = amt >= 0 ? '+' : '-';
            const currency = (isTopup || isWithdraw) ? '₽' : CURRENCY;
            return `${sign}${formatNum(Math.abs(amt))} ${currency}`;
          };
          const getAmountCellClass = (t: any) => {
            const isConvert = t?.category === 'convert' || t?.description?.includes?.('Конвертация');
            if (isConvert) return 'transactions-amount-convert';
            return Number(t?.amount) >= 0 ? 'transactions-amount-plus' : 'transactions-amount-minus';
          };
          if (isTopup) {
            const hasProvider = paymentProviders.yookassa || paymentProviders.robokassa;
            return (
              <div className="cabinet-finance">
                <button type="button" className="cabinet-finance-back" onClick={() => goToFinanceSub('main')}>← Назад</button>
                <h2>Пополнить баланс</h2>
                {hasProvider ? (
                  <form
                    className="cabinet-finance-topup"
                    onSubmit={async (e) => {
                      e.preventDefault();
                      const amount = parseInt(String(topupAmount).replace(/\D/g, ''), 10);
                      if (!amount || amount < 1 || amount > 500000) {
                        setTopupError('Введите сумму от 1 до 500 000 ₽');
                        return;
                      }
                      setTopupError('');
                      setTopupLoading(true);
                      try {
                        const res = await axios.post<{ paymentUrl: string; paymentId: number }>(
                          '/payments/create',
                          { amount, provider: topupProvider },
                          { headers: { Authorization: `Bearer ${token}` } },
                        );
                        if (res.data?.paymentUrl) window.location.href = res.data.paymentUrl;
                        else setTopupError('Не получена ссылка на оплату');
                      } catch (err: unknown) {
                        const ax = err && typeof err === 'object' && 'response' in err ? (err as { response?: { data?: { message?: string } } }).response : undefined;
                        setTopupError(ax?.data?.message || 'Не удалось создать платёж');
                      } finally {
                        setTopupLoading(false);
                      }
                    }}
                  >
                    <label>
                      <span>Сумма (₽)</span>
                      <input
                        type="text"
                        inputMode="numeric"
                        placeholder="100"
                        value={topupAmount}
                        onChange={(e) => { setTopupAmount(String(e.target.value).replace(/\D/g, '')); setTopupError(''); }}
                      />
                    </label>
                    <label>
                      <span>Способ оплаты</span>
                      <select
                        value={topupProvider}
                        onChange={(e) => setTopupProvider(e.target.value as 'yookassa' | 'robokassa')}
                      >
                        {paymentProviders.yookassa && <option value="yookassa">ЮKassa</option>}
                        {paymentProviders.robokassa && <option value="robokassa">Robokassa</option>}
                      </select>
                    </label>
                    {topupError && <p className="cabinet-finance-error">{topupError}</p>}
                    <button type="submit" className="cabinet-finance-btn" disabled={topupLoading}>
                      {topupLoading ? 'Создание платежа…' : 'Перейти к оплате'}
                    </button>
                  </form>
                ) : (
                  <p className="cabinet-finance-placeholder">Платёжные системы не настроены. Укажите данные ЮKassa или Robokassa в .env на сервере.</p>
                )}
              </div>
            );
          }
          if (isWithdraw) {
            return (
              <div className="cabinet-finance">
                <button type="button" className="cabinet-finance-back" onClick={() => goToFinanceSub('main')}>← Назад</button>
                <h2>Вывод средств</h2>
                {withdrawSuccess ? (
                  <p style={{ color: 'green', marginTop: 12 }}>Заявка отправлена. Ожидайте обработки.</p>
                ) : (
                  <>
                <p className="cabinet-finance-placeholder">Заявка на вывод обрабатывается вручную. Укажите сумму и реквизиты.</p>
                  <form
                    className="cabinet-finance-topup"
                    onSubmit={(e) => {
                      e.preventDefault();
                      const amount = parseInt(String(withdrawAmount).replace(/\D/g, ''), 10);
                      const details = withdrawDetails.trim();
                      const balanceRubles = Number(user?.balanceRubles ?? 0);
                      if (!amount || amount < 100) {
                        setWithdrawError('Минимальная сумма вывода — 100 ₽');
                        return;
                      }
                      if (amount > balanceRubles) {
                        setWithdrawError(`Недостаточно средств на рублёвом счёте. У вас ${balanceRubles} ₽`);
                        return;
                      }
                      if (!details) {
                        setWithdrawError('Укажите реквизиты для перевода (карта, счёт и т.д.)');
                        return;
                      }
                      setWithdrawError('');
                      setWithdrawLoading(true);
                      // Моментальная реакция: сразу показываем заявку в таблице и успех
                      const optimisticId = -Date.now();
                      setMyWithdrawalRequests((prev) => [{
                        id: optimisticId,
                        amount,
                        details,
                        status: 'pending',
                        createdAt: new Date().toISOString(),
                      }, ...prev]);
                      setWithdrawSuccess(true);
                      setWithdrawAmount('');
                      setWithdrawDetails('');
                      const doPost = (url: string) =>
                        axios.post<{ id: number; amount: number; details: string | null; status: string; createdAt: string }>(url, { amount, details }, {
                          headers: { Authorization: `Bearer ${token}` },
                          timeout: 15000,
                        });
                      const onSuccess = (res: { data: { id: number; amount: number; details: string | null; status: string; createdAt: string } }) => {
                        const created = res.data;
                        setUser((u: any) => u ? { ...u, balanceRubles: Math.max(0, Number(u.balanceRubles ?? 0) - amount) } : u);
                        if (created && typeof created.id === 'number') {
                          setMyWithdrawalRequests((prev) => prev.map((r) => r.id === optimisticId ? {
                            id: created.id,
                            amount: Number(created.amount),
                            details: created.details ?? null,
                            status: created.status || 'pending',
                            createdAt: typeof created.createdAt === 'string' ? created.createdAt : new Date(created.createdAt).toISOString(),
                          } : r));
                        } else {
                          fetchMyWithdrawalRequests();
                        }
                        axios.get('/users/profile', { headers: { Authorization: `Bearer ${token}` } })
                          .then((r) => {
                            if (r?.data && typeof r.data.balanceRubles === 'number') {
                              setUser((prev: any) => prev ? { ...prev, ...r.data, balanceRubles: r.data.balanceRubles } : r.data);
                            } else {
                              setUser(r.data);
                            }
                          })
                          .catch(() => {});
                        setWithdrawLoading(false);
                      };
                      const onFail = (err: unknown) => {
                        setWithdrawLoading(false);
                        setMyWithdrawalRequests((prev) => prev.filter((r) => r.id !== optimisticId));
                        setWithdrawSuccess(false);
                        const ax = err && typeof err === 'object' && 'response' in err ? (err as { response?: { data?: { message?: string }; status?: number } }).response : undefined;
                        const msg = ax?.data?.message || (ax?.status === 408 || (err as { code?: string })?.code === 'ECONNABORTED' ? 'Превышено время ожидания. Проверьте связь и попробуйте ещё раз.' : 'Не удалось создать заявку');
                        setWithdrawError(msg);
                        setWithdrawAmount(String(amount));
                        setWithdrawDetails(details);
                      };
                      doPost('/users/withdrawal-request').then(onSuccess).catch(onFail);
                    }}
                  >
                    <label>
                      <span>Сумма (₽)</span>
                      <input
                        type="text"
                        inputMode="numeric"
                        placeholder="100"
                        min={100}
                        title="Минимум 100 ₽"
                        value={withdrawAmount}
                        onChange={(e) => { setWithdrawAmount(String(e.target.value).replace(/\D/g, '')); setWithdrawError(''); }}
                      />
                      <span className="cabinet-withdraw-hint">Минимум 100 ₽</span>
                    </label>
                    <label>
                      <span>Реквизиты (карта, счёт, и т.д.) <strong>*</strong></span>
                      <input
                        type="text"
                        placeholder="Номер карты или другие реквизиты"
                        required
                        value={withdrawDetails}
                        onChange={(e) => { setWithdrawDetails(e.target.value); setWithdrawError(''); }}
                      />
                    </label>
                    {(() => {
                      const balanceRubles = Number(user?.balanceRubles ?? 0);
                      const withdrawAmountNum = parseInt(String(withdrawAmount).replace(/\D/g, ''), 10) || 0;
                      const withdrawExceedsBalance = withdrawAmountNum > 0 && withdrawAmountNum > balanceRubles;
                      return (
                        <>
                          {(withdrawExceedsBalance || withdrawError) && (
                            <p className="cabinet-finance-error">
                              {withdrawExceedsBalance
                                ? `Недостаточно средств на рублёвом счёте. У вас ${formatNum(balanceRubles)} ₽`
                                : withdrawError}
                            </p>
                          )}
                          <button
                            type="submit"
                            className="cabinet-finance-btn"
                            disabled={withdrawLoading || withdrawExceedsBalance}
                          >
                            {withdrawLoading ? 'Отправка…' : 'Отправить заявку'}
                          </button>
                        </>
                      );
                    })()}
                  </form>
                  </>
                )}
                <div className="cabinet-withdrawal-history">
                  <h3 className="cabinet-withdrawal-history-title">Мои заявки на вывод</h3>
                  <div className="cabinet-withdrawal-table-wrap">
                  <table className="cabinet-withdrawal-table">
                    <thead>
                      <tr>
                        <th>ID</th>
                        <th>Дата и время</th>
                        <th>Сумма (₽)</th>
                        <th>Статус</th>
                      </tr>
                    </thead>
                    <tbody>
                      {myWithdrawalRequests.length === 0 ? (
                        <tr>
                          <td colSpan={4} className="cabinet-withdrawal-empty-cell">Заявок пока нет</td>
                        </tr>
                      ) : (
                        myWithdrawalRequests.map((r) => (
                          <tr key={r.id}>
                            <td>{r.id > 0 ? r.id : '—'}</td>
                            <td>{formatMoscowDateTime(r.createdAt)}</td>
                            <td>{Number(r.amount)}</td>
                            <td>
                              <span className={`cabinet-withdrawal-status-tag cabinet-withdrawal-status-tag--${r.status}`}>
                                {r.status === 'pending' && 'В обработке'}
                                {r.status === 'approved' && 'Выполнена'}
                                {r.status === 'rejected' && 'Отклонена'}
                              </span>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                  </div>
                </div>
              </div>
            );
          }
          return (
            <div className="cabinet-finance">
              <h2>Финансы</h2>
              <div className="cabinet-finance-top-row">
                <div className="cabinet-finance-balance-panel">
                  <h4>Баланс</h4>
                  <div className="cabinet-finance-balance-lines">
                    <div className="cabinet-finance-balance-line">
                      <span className="cabinet-finance-balance-label">Игровой счёт ({CURRENCY})</span>
                      <span className="cabinet-finance-balance-value">{formatNum(user?.balance ?? 0)} {CURRENCY}</span>
                    </div>
                    <div className="cabinet-finance-balance-line">
                      <span className="cabinet-finance-balance-label">Рублёвый счёт</span>
                      <span className="cabinet-finance-balance-value">{formatNum(user?.balanceRubles ?? 0)} ₽</span>
                    </div>
                    <div className="cabinet-finance-balance-line cabinet-finance-balance-reserved">
                      <span className="cabinet-finance-balance-label">В активных играх</span>
                      <span className="cabinet-finance-balance-value">{formatNum(user?.reservedBalance ?? 0)} {CURRENCY}</span>
                    </div>
                    <div className="cabinet-finance-balance-line cabinet-finance-balance-total">
                      <span className="cabinet-finance-balance-label">Итого</span>
                      <span className="cabinet-finance-balance-value">
                        {formatNum((user?.balance ?? 0) + (user?.balanceRubles ?? 0) + (user?.reservedBalance ?? 0))} ₽
                      </span>
                    </div>
                  </div>
                  <div className="cabinet-finance-actions">
                    <button type="button" className="cabinet-finance-btn" onClick={() => goToFinanceSub('topup')}>
                      Пополнить
                    </button>
                    <button type="button" className="cabinet-finance-btn cabinet-finance-btn-outline" onClick={() => goToFinanceSub('withdraw')}>
                      Вывести
                    </button>
                  </div>
                </div>
                <div className="cabinet-finance-converter">
                  <h4>Конвертер</h4>
                  <p className="cabinet-finance-converter-hint">1 {CURRENCY} = 1 ₽. Введите сумму в одном поле.</p>
                  <label className="cabinet-finance-converter-field">
                    <span>Рубли (₽)</span>
                    <input
                      type="text"
                      inputMode="numeric"
                      placeholder="0"
                      value={String(rublesInput ?? '')}
                      onChange={(e) => { setRublesInput(String(e.target.value).replace(/[^\d]/g, '')); setConvertError(''); }}
                    />
                  </label>
                  <span className="cabinet-finance-converter-arrow">⇄</span>
                  <label className="cabinet-finance-converter-field">
                    <span>Legend ({CURRENCY})</span>
                    <input
                      type="text"
                      inputMode="numeric"
                      placeholder="0"
                      value={String(legendsInput ?? '')}
                      onChange={(e) => { setLegendsInput(String(e.target.value).replace(/[^\d]/g, '')); setConvertError(''); }}
                    />
                  </label>
                  {convertError && <p className="cabinet-finance-error">{convertError}</p>}
                  <button
                    type="button"
                    className="cabinet-finance-converter-btn"
                    disabled={convertLoading}
                    onClick={async () => {
                      const rubles = String(rublesInput ?? '').trim();
                      const legends = String(legendsInput ?? '').trim();
                      if (rubles && legends) {
                        setConvertError('Введите сумму только в одном поле');
                        return;
                      }
                      const amount = rubles ? parseInt(rubles, 10) : legends ? parseInt(legends, 10) : 0;
                      if (!amount || amount <= 0) {
                        setConvertError('Введите сумму для конвертации');
                        return;
                      }
                      const direction = rubles ? 'rubles_to_l' : 'l_to_rubles';
                      setConvertError('');
                      setConvertLoading(true);
                      try {
                        const res = await axios.post('/users/convert-currency', { amount, direction }, { headers: { Authorization: `Bearer ${token}` } });
                        setUser((u: any) => u ? { ...u, balance: res.data.balance, balanceRubles: res.data.balanceRubles } : u);
                        setRublesInput('');
                        setLegendsInput('');
                        const transRes = await axios.get('/users/transactions', { headers: { Authorization: `Bearer ${token}` } });
                        setTransactions(filterRejectedWithdrawalRefunds(transRes.data ?? []));
                      } catch (err: any) {
                        const msg = err?.response?.data?.message ?? err?.message ?? 'Не удалось конвертировать';
                        setConvertError(Array.isArray(msg) ? msg[0] : String(msg));
                      } finally {
                        setConvertLoading(false);
                      }
                    }}
                  >
                    {convertLoading ? '...' : 'Конвертировать'}
                  </button>
                </div>
              </div>
              <div className="transactions-section">
                <h3>История транзакций</h3>
                {transactions.length > 0 ? (
                  <>
                    <div className="transactions-filters">
                      <label className="transactions-filter-label">
                        Категория:
                        <select
                          value={transactionCategoryFilter ?? ''}
                          onChange={(e) => setTransactionCategoryFilter(e.target.value || null)}
                          className="transactions-filter-select"
                        >
                          <option value="">Все</option>
                          <option value="Пополнение">Пополнение</option>
                          <option value="Вывод средств">Вывод средств</option>
                          <option value="Конвертация">Конвертация</option>
                          <option value="Реферал">Реферал</option>
                          <option value="Выигрыш">Выигрыш</option>
                          <option value="Возврат">Возврат</option>
                          <option value="Списание за турнир">Списание за турнир</option>
                          <option value="Приход">Приход</option>
                          <option value="Расход">Расход</option>
                        </select>
                      </label>
                      <div className="transactions-filter-date-row">
                        <label className="transactions-filter-label">
                          С:
                          <input
                            type="date"
                            value={transactionDateFrom}
                            onChange={(e) => setTransactionDateFrom(e.target.value)}
                            className="transactions-filter-date"
                          />
                        </label>
                        <label className="transactions-filter-label">
                          По:
                          <input
                            type="date"
                            value={transactionDateTo}
                            onChange={(e) => setTransactionDateTo(e.target.value)}
                            className="transactions-filter-date"
                          />
                        </label>
                        <span className="transactions-filter-presets">
                          {[
                            { label: 'Сегодня', from: () => toMoscowDateStr(), to: () => toMoscowDateStr() },
                            { label: 'Вчера', from: () => { const d = parseMoscowDate(toMoscowDateStr()); d.setDate(d.getDate() - 1); return toMoscowDateStr(d); }, to: () => { const d = parseMoscowDate(toMoscowDateStr()); d.setDate(d.getDate() - 1); return toMoscowDateStr(d); } },
                            { label: 'Неделя', from: () => { const d = parseMoscowDate(toMoscowDateStr()); d.setDate(d.getDate() - 6); return toMoscowDateStr(d); }, to: () => toMoscowDateStr() },
                            { label: 'Месяц', from: () => { const d = parseMoscowDate(toMoscowDateStr()); d.setMonth(d.getMonth() - 1); return toMoscowDateStr(d); }, to: () => toMoscowDateStr() },
                          ].map(({ label, from, to }) => (
                            <button
                              key={label}
                              type="button"
                              className="transactions-filter-preset"
                              onClick={() => { setTransactionDateFrom(from()); setTransactionDateTo(to()); }}
                            >
                              {label}
                            </button>
                          ))}
                        </span>
                      </div>
                    </div>
                    <div className="transactions-table-wrap">
                    <table className="transactions-table">
                    <thead>
                      <tr>
                        <th
                          className="transactions-th-sortable"
                          onClick={() => {
                            if (transactionSortBy === 'id') setTransactionSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
                            else { setTransactionSortBy('id'); setTransactionSortDir('desc'); }
                          }}
                          title={transactionSortBy === 'id' ? `Сортировка: ${transactionSortDir === 'desc' ? '↓' : '↑'}` : 'Сортировать по ID'}
                        >
                          ID {transactionSortBy === 'id' && (transactionSortDir === 'desc' ? ' ↓' : ' ↑')}
                        </th>
                        <th
                          className="transactions-th-sortable"
                          onClick={() => {
                            if (transactionSortBy === 'date') setTransactionSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
                            else { setTransactionSortBy('date'); setTransactionSortDir('desc'); }
                          }}
                          title={transactionSortBy === 'date' ? `Сортировка: ${transactionSortDir === 'desc' ? '↓' : '↑'}` : 'Сортировать по дате'}
                        >
                          Дата {transactionSortBy === 'date' && (transactionSortDir === 'desc' ? ' ↓' : ' ↑')}
                        </th>
                        <th
                          className="transactions-th-sortable"
                          onClick={() => {
                            if (transactionSortBy === 'category') setTransactionSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
                            else { setTransactionSortBy('category'); setTransactionSortDir('asc'); }
                          }}
                          title={transactionSortBy === 'category' ? `Сортировка: ${transactionSortDir === 'desc' ? '↓' : '↑'}` : 'Сортировать по категории'}
                        >
                          Категория {transactionSortBy === 'category' && (transactionSortDir === 'desc' ? ' ↓' : ' ↑')}
                        </th>
                        <th
                          className="transactions-th-sortable"
                          onClick={() => {
                            if (transactionSortBy === 'amount') setTransactionSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
                            else { setTransactionSortBy('amount'); setTransactionSortDir('desc'); }
                          }}
                          title={transactionSortBy === 'amount' ? `Сортировка: ${transactionSortDir === 'desc' ? '↓' : '↑'}` : 'Сортировать по сумме'}
                        >
                          Сумма {transactionSortBy === 'amount' && (transactionSortDir === 'desc' ? ' ↓' : ' ↑')}
                        </th>
                        <th>Описание</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(() => {
                        const getCat = (t: any) => {
                          if (t?.category === 'topup' || t?.category === 'admin_credit' || t?.description?.includes?.('Пополнение')) return 'Пополнение';
                          if (t?.category === 'withdraw' || t?.description?.toLowerCase?.().includes?.('вывод')) return 'Вывод средств';
                          if (t?.category === 'convert' || t?.description?.includes?.('Конвертация')) return 'Конвертация';
                          if (t?.category === 'referral' || t?.description?.includes?.('Реферал')) return 'Реферал';
                          if (t?.category === 'win' || t?.description?.includes?.('Выигрыш')) return 'Выигрыш';
                          if (t?.category === 'refund' || t?.description?.includes?.('Возврат')) return 'Возврат';
                          if (t?.category === 'loss' && t?.tournamentId) return 'Списание за турнир';
                          if (t?.description?.includes?.('Списание за турнир') || (t?.description?.includes?.('турнир') && Number(t?.amount) < 0)) return 'Списание за турнир';
                          return Number(t?.amount) >= 0 ? 'Приход' : 'Расход';
                        };
                        let list = transactions;
                        if (transactionCategoryFilter) {
                          list = list.filter((t) => getCat(t) === transactionCategoryFilter);
                        }
                        if (transactionDateFrom) {
                          const fromStart = parseMoscowDate(transactionDateFrom);
                          list = list.filter((t) => new Date(t.createdAt) >= fromStart);
                        }
                        if (transactionDateTo) {
                          const toEnd = new Date(transactionDateTo + 'T23:59:59.999+03:00');
                          list = list.filter((t) => new Date(t.createdAt) <= toEnd);
                        }
                        list = [...list].sort((a, b) => {
                          let cmp = 0;
                          if (transactionSortBy === 'id') cmp = a.id - b.id;
                          else if (transactionSortBy === 'date') cmp = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
                          else if (transactionSortBy === 'amount') cmp = Number(a.amount) - Number(b.amount);
                          else if (transactionSortBy === 'category') cmp = getCat(a).localeCompare(getCat(b));
                          return transactionSortDir === 'asc' ? cmp : -cmp;
                        });
                        if (list.length === 0) {
                          return (
                            <tr>
                              <td colSpan={5} className="transactions-empty-filter">
                                {(transactionCategoryFilter || transactionDateFrom || transactionDateTo)
                                  ? 'Нет транзакций по выбранным фильтрам'
                                  : 'Транзакций нет'}
                              </td>
                            </tr>
                          );
                        }
                        return list.map((transaction) => (
                          <tr key={transaction.id}>
                            <td>{transaction.id}</td>
                            <td>{formatMoscowDateTimeFull(transaction.createdAt)}</td>
                            <td>{getCategoryLabel(transaction)}</td>
                            <td className={getAmountCellClass(transaction)}>
                              {getAmountDisplay(transaction)}
                            </td>
                            <td className="transactions-desc" title={(transaction.description ?? '').replace(/\s*\(скрипт\)\s*/g, '')}>{renderTransactionDescription(transaction)}</td>
                          </tr>
                        ));
                      })()}
                    </tbody>
                  </table>
                  </div>
                  </>
                ) : (
                  transactionsLoaded ? <p>Транзакций нет</p> : null
                )}
              </div>
            </div>
          );
        })()}
        {section === 'partner' && sectionFromUrlConfirmed && (
          <div className="cabinet-statistics">
            <h2 className="partner-section-title">Партнерская программа</h2>
            <p>Поделитесь ссылкой — новые игроки, зарегистрировавшиеся по ней, будут закреплены за вами.</p>
            <div className="partner-referral-block">
              {(referralCode || user?.id) ? (() => {
                const refValue = user?.id != null ? String(user.id) : String(referralCode);
                const link = `${window.location.origin}/register?ref=${refValue}`;
                const inviteText = `Играй и зарабатывай в Legend Games! Проверь свои знания в интеллектуальных турнирах и выигрывай реальные деньги.\n\nРегистрируйся по моей ссылке:\n${link}`;
                return (
                  <>
                    <p className="partner-referral-label">Ваша реферальная ссылка:</p>
                    <div className="partner-referral-link-display">{link}</div>
                    <div className="partner-referral-actions">
                      <button
                        type="button"
                        className="partner-referral-copy-btn"
                        onClick={async () => {
                          try {
                            await navigator.clipboard.writeText(inviteText);
                            setReferralLinkCopied(true);
                            setTimeout(() => setReferralLinkCopied(false), 2500);
                          } catch {
                            setReferralLinkCopied(false);
                          }
                        }}
                      >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                          <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                        </svg>
                        {referralLinkCopied ? 'Скопировано!' : 'Скопировать приглашение'}
                      </button>
                      {typeof navigator.share === 'function' && (
                        <button
                          type="button"
                          className="partner-referral-share-btn"
                          onClick={() => {
                            navigator.share({ title: 'Legend Games', text: inviteText }).catch(() => {});
                          }}
                        >
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                            <circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" />
                            <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" /><line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
                          </svg>
                          Поделиться
                        </button>
                      )}
                    </div>
                    <details className="partner-referral-preview">
                      <summary>Предпросмотр сообщения</summary>
                      <div className="partner-referral-preview-text">{inviteText}</div>
                    </details>
                  </>
                );
              })() : (
                <span style={{ color: '#999' }}>—</span>
              )}
            </div>
            <div className="partner-tree-title-row">
              <div className="partner-tree-nav-buttons">
                <button
                  type="button"
                  className={`partner-tree-nav-btn ${section === 'partner' ? 'active' : ''}`}
                  onClick={() => goToSection('partner')}
                >
                  Древо рефералов
                </button>
                <button
                  type="button"
                  className={`partner-tree-nav-btn ${section === 'partner-statistics' ? 'active' : ''}`}
                  onClick={() => goToSection('partner-statistics')}
                >
                  Статистика
                </button>
              </div>
              {referralTree && (
                <span className="partner-tree-total">
                  Всего: {referralTree.levels?.reduce((sum, arr) => sum + (Array.isArray(arr) ? arr.length : 0), 0) ?? 0} чел.
                </span>
              )}
            </div>
            <div className="partner-tree-lines-info">
              <p className="partner-tree-line-item">Линия 1 — приглашённые вами (2,36 % от суммы выигрыша ваших рефералов)</p>
              <p className="partner-tree-line-item">Линия 2 — приглашённые ими (0,11 % от суммы выигрыша ваших рефералов, линии 2–10)</p>
            </div>
            {referralTreeLoading && <p className="partner-tree-loading">Загрузка древа…</p>}
            {referralTreeError && <p className="partner-tree-error">{referralTreeError}</p>}
            {referralModalData && (
              <div className="partner-tree-wrap" onClick={() => partnerPlayerTooltip && setPartnerPlayerTooltip(null)}>
                {partnerPlayerTooltip && (
                  <div
                    className="bracket-player-tooltip partner-player-tooltip"
                    role="button"
                    tabIndex={0}
                    style={{
                      position: 'fixed',
                      left: partnerPlayerTooltip.rect.left,
                      top: partnerPlayerTooltip.rect.bottom + 6,
                      zIndex: 1100,
                    }}
                    onClick={(e) => { e.stopPropagation(); setPartnerPlayerTooltip(null); }}
                    onKeyDown={(e) => e.key === 'Enter' && setPartnerPlayerTooltip(null)}
                  >
                    <div className="bracket-player-tooltip-inner">
                      <div className="bracket-player-tooltip-avatar">
                        {partnerPlayerTooltip.avatarUrl ? (
                          <img src={partnerPlayerTooltip.avatarUrl} alt="" />
                        ) : (
                          <DollarIcon />
                        )}
                      </div>
                      <div className="bracket-player-tooltip-stats">
                        <div className="bracket-player-tooltip-name">{partnerPlayerTooltip.displayName}</div>
                        <div className="bracket-player-tooltip-stat"><strong>Лига:</strong> {partnerPlayerTooltip.stats.maxLeagueName ?? '—'}</div>
                        <div className="bracket-player-tooltip-stat">Сыграно раундов: {formatNum(partnerPlayerTooltip.stats.gamesPlayed ?? 0)}</div>
                        <div className="bracket-player-tooltip-stat">Сыгранных матчей: {formatNum(partnerPlayerTooltip.stats.completedMatches ?? 0)}</div>
                        <div className="bracket-player-tooltip-stat"><strong>Сумма выигрыша:</strong> {formatNum(partnerPlayerTooltip.stats.totalWinnings ?? 0)} {CURRENCY}</div>
                        <div className="bracket-player-tooltip-stat"><strong>Выиграно турниров:</strong> {formatNum(partnerPlayerTooltip.stats.wins ?? 0)}</div>
                        <div className="bracket-player-tooltip-stat"><strong>Верных ответов:</strong> {formatNum(partnerPlayerTooltip.stats.correctAnswers ?? 0)} из {formatNum(partnerPlayerTooltip.stats.totalQuestions ?? 0)}</div>
                        <div className="bracket-player-tooltip-stat"><strong>% верных ответов:</strong> {(partnerPlayerTooltip.stats.totalQuestions ?? 0) > 0 ? `${(((partnerPlayerTooltip.stats.correctAnswers ?? 0) / (partnerPlayerTooltip.stats.totalQuestions ?? 1)) * 100).toFixed(2)}%` : '—'}</div>
                      </div>
                    </div>
                  </div>
                )}
                <PartnerDetailTreeSection
                  referralModalData={referralModalData}
                  partnerDetailExpandedIds={partnerDetailExpandedIds}
                  setPartnerDetailExpandedIds={setPartnerDetailExpandedIds}
                  token={token}
                  tooltipPlayerId={partnerPlayerTooltip?.playerId ?? null}
                  onShowTooltip={(data) => setPartnerPlayerTooltip(data)}
                  onCloseTooltip={() => setPartnerPlayerTooltip(null)}
                  currentUserId={user?.id}
                  currentUserAvatar={avatar}
                />
              </div>
            )}
          </div>
        )}
        {section === 'partner-statistics' && sectionFromUrlConfirmed && (
          <div className="cabinet-statistics">
            <div className="partner-tree-title-row partner-tree-title-row--stats">
              <div className="partner-tree-nav-buttons">
                <button
                  type="button"
                  className={`partner-tree-nav-btn ${section === 'partner' ? 'active' : ''}`}
                  onClick={() => goToSection('partner')}
                >
                  Древо рефералов
                </button>
                <button
                  type="button"
                  className={`partner-tree-nav-btn ${section === 'partner-statistics' ? 'active' : ''}`}
                  onClick={() => goToSection('partner-statistics')}
                >
                  Статистика
                </button>
              </div>
            </div>
            <div className="cabinet-stats-chart cabinet-stats-chart--partner">
              <h3 className="cabinet-stats-chart-title">График по дням</h3>
              <div className="cabinet-stats-chart-controls">
                <div className="cabinet-stats-chart-filters">
                  {(['today', 'yesterday', 'week', 'month'] as const).map((preset) => {
                    const todayMoscow = parseMoscowDate(toMoscowDateStr());
                    const getRange = () => {
                      if (preset === 'today') {
                        const from = new Date(todayMoscow);
                        return { from: toMoscowDateStr(from), to: toMoscowDateStr(from) };
                      }
                      if (preset === 'yesterday') {
                        const y = new Date(todayMoscow);
                        y.setDate(y.getDate() - 1);
                        return { from: toMoscowDateStr(y), to: toMoscowDateStr(y) };
                      }
                      if (preset === 'week') {
                        const from = new Date(todayMoscow);
                        from.setDate(from.getDate() - 6);
                        return { from: toMoscowDateStr(from), to: toMoscowDateStr(todayMoscow) };
                      }
                      const from = new Date(todayMoscow);
                      from.setDate(from.getDate() - 29);
                      return { from: toMoscowDateStr(from), to: toMoscowDateStr(todayMoscow) };
                    };
                    const labels = { today: 'Сегодня', yesterday: 'Вчера', week: 'Неделя', month: 'Месяц' };
                    const range = getRange();
                    const isActive = partnerChartFrom === range.from && partnerChartTo === range.to;
                    return (
                      <button
                        key={preset}
                        type="button"
                        className={`cabinet-stats-chart-filter-btn ${isActive ? 'cabinet-stats-chart-filter-btn--active' : ''}`}
                        onClick={() => { setPartnerChartFrom(range.from); setPartnerChartTo(range.to); }}
                      >
                        {labels[preset]}
                      </button>
                    );
                  })}
                </div>
                <div className="cabinet-stats-chart-period">
                  <label>Период:</label>
                  <input
                    type="date"
                    value={partnerChartFrom}
                    onChange={(e) => setPartnerChartFrom(e.target.value)}
                    className="cabinet-stats-chart-input"
                  />
                  <span>—</span>
                  <input
                    type="date"
                    value={partnerChartTo}
                    onChange={(e) => setPartnerChartTo(e.target.value)}
                    className="cabinet-stats-chart-input"
                  />
                </div>
                <div className="cabinet-stats-chart-metric">
                  <label>Критерий:</label>
                  <select
                    value={partnerChartMetric}
                    onChange={(e) => setPartnerChartMetric(e.target.value as typeof partnerChartMetric)}
                    className="cabinet-stats-chart-select"
                  >
                    <option value="referralCount">Новых рефералов</option>
                    <option value="referralEarnings">Доход с рефералов (L)</option>
                  </select>
                </div>
              </div>
              <div className="cabinet-stats-chart-area cabinet-stats-chart-area--partner">
                {(() => {
                  const fromD = parseMoscowDate(partnerChartFrom);
                  const toD = parseMoscowDate(partnerChartTo);
                  const generateEmptyRange = () => {
                    if (fromD > toD) return [];
                    const result: { date: string; value: number }[] = [];
                    const d = new Date(fromD.getTime());
                    while (d <= toD) {
                      result.push({ date: toMoscowDateStr(d), value: 0 });
                      d.setDate(d.getDate() + 1);
                    }
                    return result;
                  };
                  const displayData = partnerChartData.length > 0 ? partnerChartData : generateEmptyRange();
                  if (displayData.length === 0) {
                    return <p className="cabinet-stats-chart-empty">Выберите период (дата «от» должна быть не позже «до»)</p>;
                  }
                  const maxVal = Math.max(1, ...displayData.map((d) => d.value));
                  const formatVal = (v: number) => partnerChartMetric === 'referralEarnings' ? `${formatNum(v)} ${CURRENCY}` : formatNum(v);
                  const niceScale = partnerChartMetric === 'referralEarnings'
                    ? [0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000]
                    : [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000];
                  const niceMax = niceScale.find((n) => n >= maxVal) ?? maxVal;
                  const gridLevels = [0, 25, 50, 75, 100];
                  const chartMinWidth = Math.max(displayData.length * 28, 280);
                  return (
                    <>
                      <div className="cabinet-stats-chart-scroll" style={{ minWidth: 0 }}>
                        <div className="cabinet-stats-chart-scroll-inner" style={{ minWidth: chartMinWidth }}>
                          <div className="cabinet-stats-chart-plot">
                            <div className="cabinet-stats-chart-grid" aria-hidden>
                              {gridLevels.map((pct, i) => (
                                <div key={i} className="cabinet-stats-chart-grid-line" style={{ bottom: `${pct}%` }} />
                              ))}
                            </div>
                            <div className="cabinet-stats-chart-yaxis">
                              {gridLevels.map((pct, i) => {
                                const rawVal = (niceMax * pct) / 100;
                                const val = niceMax < 1 ? Math.round(rawVal * 10) / 10 : Math.round(rawVal);
                                return (
                                  <div key={i} className={`cabinet-stats-chart-yaxis-tick ${pct === 0 ? 'cabinet-stats-chart-yaxis-tick--zero' : ''} ${pct === 100 ? 'cabinet-stats-chart-yaxis-tick--top' : ''}`} style={{ bottom: `${pct}%` }}>
                                    {formatVal(val)}
                                  </div>
                                );
                              })}
                            </div>
                            <div className="cabinet-stats-chart-bars">
                              {displayData.map((d) => (
                                <div key={d.date} className="cabinet-stats-chart-bar-wrap">
                                  <div className="cabinet-stats-chart-bar-container">
                                    <div
                                      className="cabinet-stats-chart-bar cabinet-stats-chart-bar--volumetric"
                                      style={{ height: `${niceMax > 0 ? (d.value / niceMax) * 100 : 0}%` }}
                                      title={`${d.date}: ${formatVal(d.value)}`}
                                    />
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                          <div className="cabinet-stats-chart-labels">
                            {displayData.map((d) => (
                              <div key={d.date} className="cabinet-stats-chart-label-wrap">
                                <span className="cabinet-stats-chart-value">{formatVal(d.value)}</span>
                                <span className="cabinet-stats-chart-label">{parseInt(d.date.slice(8), 10)}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    </>
                  );
                })()}
              </div>
            </div>
          </div>
        )}
        {section === 'news' && (
          <div className="cabinet-news">
            <h2>Новости</h2>
            <div className="cabinet-news-list">
              {apiNews.length === 0 && <p style={{ color: '#888', textAlign: 'center', padding: '20px 0' }}>Новостей пока нет</p>}
              {apiNews.map((item) => (
                <NewsItem
                  key={item.id}
                  id={item.id}
                  topic={item.topic}
                  date={new Date(item.createdAt).toLocaleDateString('ru-RU')}
                  description={<p style={{ whiteSpace: 'pre-line', margin: 0 }}>{item.body}</p>}
                  unread={!readNewsIds.includes(item.id)}
                  onRead={() => {
                    setReadNewsIds((prev) => {
                      if (prev.includes(item.id)) return prev;
                      return [...prev, item.id];
                    });
                    axios.post('/users/me/read-news', { newsId: item.id }, authHeaders).catch(() => {});
                  }}
                />
              ))}
            </div>
          </div>
        )}
        </main>
      </div>
      {/* Модалка сетки турнира */}
      {(bracketView || bracketLoading || bracketError) && (
        <div className="bracket-overlay" onClick={() => !bracketLoading && closeBracket()}>
          <div
            className="bracket-modal"
            onClick={(e) => {
              e.stopPropagation();
              const t = e.target as HTMLElement;
              if (!t.closest('.bracket-player-tooltip') && !t.closest('.bracket-player-name--clickable')) {
                setBracketPlayerTooltip(null);
              }
            }}
          >
            <div className="bracket-modal-header">
              <h3>{bracketView?.gameType === 'money' ? 'Противостояние' : 'Турнир'} #{bracketView?.tournamentId ?? '...'}{(bracketOpenSource === 'completed' || bracketView?.isCompleted || (bracketView?.tournamentId != null && gameHistory?.completed?.some((c) => c.id === bracketView.tournamentId))) ? <span className="bracket-completed-badge">Завершен</span> : (bracketView || bracketOpenSource === 'active') ? <span className="bracket-active-badge">Активен</span> : null}</h3>
              <button type="button" className="bracket-close" onClick={closeBracket} aria-label="Закрыть">
                ×
              </button>
            </div>
            {bracketLoading && !bracketView && <p className="bracket-loading">Загрузка…</p>}
            {bracketError && !bracketLoading && <p className="bracket-error">{bracketError}</p>}
            {bracketPlayerTooltip && (
              <div
                className="bracket-player-tooltip"
                role="button"
                tabIndex={0}
                style={{
                  position: 'fixed',
                  left: Math.min(bracketPlayerTooltip.rect.left, window.innerWidth - 280),
                  top: bracketPlayerTooltip.rect.bottom + 6,
                  zIndex: 1100,
                  maxWidth: 'calc(100vw - 20px)',
                }}
                onClick={() => setBracketPlayerTooltip(null)}
                onKeyDown={(e) => e.key === 'Enter' && setBracketPlayerTooltip(null)}
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
                    <div className="bracket-player-tooltip-name">{bracketPlayerTooltip.displayName}</div>
                    <div className="bracket-player-tooltip-stat"><strong>Лига:</strong> {bracketPlayerTooltip.stats.maxLeagueName ?? '—'}</div>
                    <div className="bracket-player-tooltip-stat">Сыграно раундов: {formatNum(bracketPlayerTooltip.stats.gamesPlayed ?? 0)}</div>
                    <div className="bracket-player-tooltip-stat">Сыгранных матчей: {formatNum(bracketPlayerTooltip.stats.completedMatches ?? 0)}</div>
                    <div className="bracket-player-tooltip-stat"><strong>Сумма выигрыша:</strong> {formatNum(bracketPlayerTooltip.stats.totalWinnings ?? 0)} {CURRENCY}</div>
                    <div className="bracket-player-tooltip-stat"><strong>Выиграно турниров:</strong> {formatNum(bracketPlayerTooltip.stats.wins ?? 0)}</div>
                    <div className="bracket-player-tooltip-stat"><strong>Верных ответов:</strong> {formatNum(bracketPlayerTooltip.stats.correctAnswers ?? 0)} из {formatNum(bracketPlayerTooltip.stats.totalQuestions ?? 0)}</div>
                    <div className="bracket-player-tooltip-stat"><strong>% верных ответов:</strong> {(bracketPlayerTooltip.stats.totalQuestions ?? 0) > 0 ? `${(((bracketPlayerTooltip.stats.correctAnswers ?? 0) / (bracketPlayerTooltip.stats.totalQuestions ?? 1)) * 100).toFixed(2)}%` : '—'}</div>
                  </div>
                </div>
              </div>
            )}
            {bracketView && (
              <div className={`bracket-grid ${bracketBlocksEqualized ? 'bracket-blocks-equalized' : ''}`}>
                <div className="bracket-left-col" ref={bracketLeftColRef}>
                  <div className="bracket-semi-block bracket-semi-1">
                    <h4>Полуфинал 1</h4>
                    <div className="bracket-match">
                      {[0, 1].map((i) => {
                        const p = bracketView.semi1.players[i];
                        const displayName = truncateBracketName(p ? (p.nickname?.trim() || `Игрок ${p.id}`) : 'Ожидание игрока');
                        const answered = p?.questionsAnswered ?? 0;
                        const total = answered >= 10 ? 10 : answered;
                        const correct = p?.semiScore ?? (answered <= 10 ? (p?.correctAnswersCount ?? 0) : 0);
                        const tbRound = p?.tiebreakerRound ?? 0;
                        const tbAnswered = p?.tiebreakerAnswered ?? 0;
                        const pAvatar = p && p.id === user?.id ? avatar : (p?.avatarUrl ?? null);
                        return (
                          <div key={p ? p.id : `s1-${i}`} className={`bracket-player-slot ${!p ? 'bracket-slot-empty' : ''} ${p?.isLoser ? 'bracket-slot-loser' : ''}`}>
                            <span className="bracket-player-info">
                              {p && (
                                <span className="bracket-player-avatar">
                                  {pAvatar ? (
                                    <img src={pAvatar} alt="" />
                                  ) : (
                                    <DollarIcon />
                                  )}
                                </span>
                              )}
                              {p ? (
                                <BracketPlayerName
                                  playerId={p.id}
                                  displayName={displayName}
                                  avatarUrl={pAvatar}
                                  token={token}
                                  isTooltipOpen={bracketPlayerTooltip?.playerId === p.id}
                                  onShowTooltip={({ playerId: pid, displayName: dn, avatarUrl: av, stats, rect }) => setBracketPlayerTooltip({ playerId: pid, displayName: dn, avatarUrl: av, stats, rect })}
                                  onCloseTooltip={() => setBracketPlayerTooltip(null)}
                                />
                              ) : (
                                <span className="bracket-player-name">{displayName}</span>
                              )}
                            </span>
                            <span className="bracket-player-score-wrap">
                              {p && total > 0 && (
                                <span className="bracket-player-score">{correct}/{total} ({Math.round((correct / total) * 100)}%)</span>
                              )}
                              {p && tbRound > 0 && (
                                <span className="bracket-player-tiebreaker">+ Доп.{tbRound > 1 ? ` ${tbRound}` : ''}: {tbAnswered}/10</span>
                              )}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                  <div className="bracket-semi-block bracket-semi-2">
                    <h4>Полуфинал 2</h4>
                    <div className="bracket-match">
                      {[0, 1].map((i) => {
                        const p = bracketView.semi2?.players[i];
                        const displayName = truncateBracketName(p ? (p.nickname?.trim() || `Игрок ${p.id}`) : 'Ожидание игрока');
                        const answered = p?.questionsAnswered ?? 0;
                        const total = answered >= 10 ? 10 : answered;
                        const correct = p?.semiScore ?? (answered <= 10 ? (p?.correctAnswersCount ?? 0) : 0);
                        const tbRound = p?.tiebreakerRound ?? 0;
                        const tbAnswered = p?.tiebreakerAnswered ?? 0;
                        const pAvatar = p && p.id === user?.id ? avatar : (p?.avatarUrl ?? null);
                        return (
                          <div key={p ? p.id : `s2-${i}`} className={`bracket-player-slot ${!p ? 'bracket-slot-empty' : ''} ${p?.isLoser ? 'bracket-slot-loser' : ''}`}>
                            <span className="bracket-player-info">
                              {p && (
                                <span className="bracket-player-avatar">
                                  {pAvatar ? (
                                    <img src={pAvatar} alt="" />
                                  ) : (
                                    <DollarIcon />
                                  )}
                                </span>
                              )}
                              {p ? (
                                <BracketPlayerName
                                  playerId={p.id}
                                  displayName={displayName}
                                  avatarUrl={pAvatar}
                                  token={token}
                                  isTooltipOpen={bracketPlayerTooltip?.playerId === p.id}
                                  onShowTooltip={({ playerId: pid, displayName: dn, avatarUrl: av, stats, rect }) => setBracketPlayerTooltip({ playerId: pid, displayName: dn, avatarUrl: av, stats, rect })}
                                  onCloseTooltip={() => setBracketPlayerTooltip(null)}
                                />
                              ) : (
                                <span className="bracket-player-name">{displayName}</span>
                              )}
                            </span>
                            <span className="bracket-player-score-wrap">
                              {p && total > 0 && (
                                <span className="bracket-player-score">{correct}/{total} ({Math.round((correct / total) * 100)}%)</span>
                              )}
                              {p && tbRound > 0 && (
                                <span className="bracket-player-tiebreaker">+ Доп.{tbRound > 1 ? ` ${tbRound}` : ''}: {tbAnswered}/10</span>
                              )}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
                <div className="bracket-connector">
                  <svg viewBox="0 0 256 220" preserveAspectRatio="none" className="bracket-lines">
                    <path d="M 0 51 L 178 51 L 178 110 L 256 110" fill="none" stroke="#888" strokeWidth="2" />
                    <path d="M 0 169 L 178 169 L 178 110" fill="none" stroke="#888" strokeWidth="2" />
                  </svg>
                </div>
                <div className="bracket-final-block" ref={bracketFinalBlockRef}>
                  <h4>Финал</h4>
                  <div className="bracket-match">
                    {[0, 1].map((i) => {
                      const p = bracketView.final.players[i];
                      const displayName = truncateBracketName(p ? (p.nickname?.trim() || `Игрок ${p.id}`) : 'Ожидание игрока');
                      const answered = p?.finalAnswered ?? 0;
                      const total = answered >= 10 ? 10 : answered;
                      const correct = p?.finalScore ?? p?.finalCorrect ?? 0;
                      const pAvatar = p && p.id === user?.id ? avatar : (p?.avatarUrl ?? null);
                      return (
                        <div key={p ? p.id : `f-${i}`} className={`bracket-player-slot ${!p ? 'bracket-slot-empty' : ''}`}>
                          <span className="bracket-player-info">
                            {p && (
                              <span className="bracket-player-avatar">
                                {pAvatar ? (
                                  <img src={pAvatar} alt="" />
                                ) : (
                                  <DollarIcon />
                                )}
                              </span>
                            )}
                            {p ? (
                              <BracketPlayerName
                                playerId={p.id}
                                displayName={displayName}
                                avatarUrl={pAvatar}
                                token={token}
                                isTooltipOpen={bracketPlayerTooltip?.playerId === p.id}
                                onShowTooltip={({ playerId: pid, displayName: dn, avatarUrl: av, stats, rect }) => setBracketPlayerTooltip({ playerId: pid, displayName: dn, avatarUrl: av, stats, rect })}
                                onCloseTooltip={() => setBracketPlayerTooltip(null)}
                              />
                            ) : (
                              <span className="bracket-player-name">{displayName}</span>
                            )}
                          </span>
                          {p && total > 0 && (
                            <span className="bracket-player-score">{correct}/{total} ({Math.round((correct / total) * 100)}%)</span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
      {/* Модалка просмотра вопросов турнира */}
      {questionsReviewTournamentId != null && (
        <div className="questions-review-overlay" onClick={closeQuestionsReview}>
          <div className="questions-review-modal" onClick={(e) => e.stopPropagation()}>
            <div className="questions-review-header">
              <h3>Вопросы турнира #{questionsReviewTournamentId}</h3>
              <button type="button" className="questions-review-close" onClick={closeQuestionsReview} aria-label="Закрыть">×</button>
            </div>
            {questionsReviewData && !questionsReviewLoading && (questionsReviewData.questionsAnsweredCount ?? 0) > 10 && (
              <div className="questions-review-tabs">
                <button type="button" className={`questions-review-tab ${questionsReviewRound === 'semi' ? 'active' : ''}`} onClick={() => setQuestionsReviewRound('semi')}>Полуфинал</button>
                <button type="button" className={`questions-review-tab ${questionsReviewRound === 'final' ? 'active' : ''}`} onClick={() => setQuestionsReviewRound('final')}>Финал</button>
              </div>
            )}
            {questionsReviewLoading && !questionsReviewData && <p className="questions-review-loading">Загрузка…</p>}
            {questionsReviewError && !questionsReviewLoading && <p className="questions-review-error">{questionsReviewError}</p>}
            {questionsReviewData && (() => {
                const raw = questionsReviewData.answersChosen ?? (questionsReviewData as { answers_chosen?: number[] }).answers_chosen;
                const ac = Array.isArray(raw)
                  ? raw.map((a) => {
                      const n = typeof a === 'number' && !Number.isNaN(a) ? a : (typeof a === 'string' ? Number(a) : NaN);
                      if (typeof n !== 'number' || Number.isNaN(n)) return -1;
                      return n < 0 ? -1 : Math.floor(n);
                    })
                  : [];
                const hasChoices = ac.length > 0;
                const userSemiIdx = questionsReviewData.userSemiIndex ?? 0;
                const isSemi = questionsReviewRound === 'semi';
                const n = questionsReviewData.questionsAnsweredCount;
                // Тренировка: 3 раунда — полуфинал 1 (0–9), полуфинал 2 (10–19), финал (20–29). Противостояние: полуфинал (0–9), финал (10–19).
                const threeRounds = n > 20;
                const startIndex = isSemi
                  ? (userSemiIdx === 0 ? 0 : threeRounds ? 10 : 0)
                  : (threeRounds ? 20 : 10);
                const answeredInRound = isSemi
                  ? (userSemiIdx === 0 ? Math.min(10, n) : Math.min(10, Math.max(0, n - 10)))
                  : Math.min(10, Math.max(0, n - (threeRounds ? 20 : 10)));
                const title = isSemi ? (userSemiIdx === 0 ? 'Полуфинал 1' : 'Полуфинал 2') : 'Финал';
                // Тренировка: 20 вопросов (полуфинал 0–9, финал 10–19). Ответы 10–19 соответствуют semi2 (roundIndex 1), а не questionsFinal (roundIndex 2).
                const questions = isSemi
                  ? (userSemiIdx === 0 ? questionsReviewData.questionsSemi1 : questionsReviewData.questionsSemi2)
                  : (threeRounds ? questionsReviewData.questionsFinal : questionsReviewData.questionsSemi2);
                const questionsToShow = questions.slice(0, answeredInRound);
                const countInRound = questions.length;
                const semiCorrect = questionsReviewData.semiFinalCorrectCount ?? (n <= 10 ? questionsReviewData.correctAnswersCount : 0);
                const finalCorrect = n > 10 ? Math.max(0, questionsReviewData.correctAnswersCount - semiCorrect) : 0;
                const correctInRound = isSemi ? semiCorrect : finalCorrect;
                return (
                  <div className="questions-review-body">
                    <p className="questions-review-stats">
                      {title}: вы ответили верно на <strong>{correctInRound}</strong> из <strong>{answeredInRound}</strong> вопросов{answeredInRound < countInRound ? ` (отвечено ${answeredInRound} из ${countInRound})` : ''}. Ниже — только те вопросы, на которые вы отвечали.
                    </p>
                    {questionsToShow.length === 0 ? (
                      <p className="questions-review-empty">Вы не ответили ни на один вопрос в этом раунде.</p>
                    ) : (
                      <div className="questions-review-round">
                        <h4>{title}</h4>
                        {questionsToShow.map((q, idx) => {
                          const globalIndex = startIndex + idx;
                          const rawChoice = ac[globalIndex];
                          const playerChoice = typeof rawChoice === 'number' && !Number.isNaN(rawChoice) && rawChoice >= 0 && rawChoice < (q.options?.length ?? 0) ? rawChoice : -1;
                          const correctIdx = Number(q.correctAnswer);
                          return (
                            <div key={q.id ?? globalIndex} className="questions-review-question">
                              <p className="questions-review-question-text">
                                <span className="questions-review-question-id">ID: {q.id ?? '—'}</span>
                                {' '}{idx + 1}. {q.question}
                                {playerChoice === -1 && <span className="questions-review-no-answer-badge">Нет ответа</span>}
                              </p>
                              <ul className="questions-review-options">
                                {q.options.map((opt, oi) => (
                                  <li
                                    key={oi}
                                    className={`questions-review-option-row ${oi === correctIdx ? 'questions-review-option-correct' : ''} ${oi === playerChoice ? 'questions-review-option-player' : ''}`}
                                  >
                                    <span className="questions-review-option-text">{opt}</span>
                                    <span className="questions-review-badges">
                                      {oi === correctIdx && <span className="questions-review-correct-badge" aria-label="Правильный ответ">Правильный ответ</span>}
                                      {oi === playerChoice && <span className="questions-review-player-label" aria-label="Ваш выбор">Мой ответ</span>}
                                    </span>
                                  </li>
                                ))}
                              </ul>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })()}
          </div>
        </div>
      )}
    </div>
  );
};

export default Profile;