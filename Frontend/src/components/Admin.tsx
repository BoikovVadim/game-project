import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { formatNum, CURRENCY } from './formatNum.ts';
import { formatMoscowDateTimeFull, formatMoscowDateTime } from './dateUtils.ts';
import './Admin.css';
import './Profile.css';

interface AdminProps {
  token: string;
  onLogout?: () => void;
}

type WithdrawalRequestRow = {
  id: number;
  amount: number;
  details: string | null;
  status: string;
  createdAt: string;
  processedAt?: string | null;
  userId: number;
  user?: { id: number; username: string; email?: string };
  processedByAdminUsername?: string | null;
  processedByAdminEmail?: string | null;
};

type UserRow = { id: number; username: string; email: string; balance: number; balanceRubles: number; isAdmin: boolean };

type ProjectCostHistoryRow = {
  timestamp: string | null;
  date: string;
  time: string | null;
  amountChange: number;
  afterAmount: number;
  duration: string;
  description: string;
};

type ProjectCostDashboardData = {
  currentTotal: number;
  todayTotal: number;
  updatedAt: string | null;
  history: ProjectCostHistoryRow[];
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
  const elRef = React.useRef<HTMLButtonElement | null>(null);

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

function truncateBracketName(s: string): string {
  if (!s) return '';
  return s.length > 24 ? `${s.slice(0, 24)}...` : s;
}

type TournamentColumnKey =
  | 'tournamentId'
  | 'userNickname'
  | 'userId'
  | 'phase'
  | 'stage'
  | 'roundStartedAt'
  | 'deadline'
  | 'status'
  | 'questions'
  | 'userStatus'
  | 'createdAt'
  | 'playersCount'
  | 'leagueAmount'
  | 'resultLabel'
  | 'correctAnswersInRound'
  | 'completedAt';

const DEFAULT_TOURNAMENT_COLUMNS: TournamentColumnKey[] = [
  'tournamentId',
  'userNickname',
  'userId',
  'phase',
  'stage',
  'roundStartedAt',
  'deadline',
  'status',
  'questions',
  'userStatus',
  'createdAt',
  'playersCount',
  'leagueAmount',
  'resultLabel',
  'correctAnswersInRound',
  'completedAt',
];

const TOURNAMENT_COLUMN_LABELS: Record<TournamentColumnKey, string> = {
  tournamentId: 'ID турнира',
  userNickname: 'Ник игрока',
  userId: 'ID игрока',
  phase: 'Фаза',
  stage: 'Этап',
  roundStartedAt: 'Старт раунда',
  deadline: 'Осталось до конца',
  status: 'Результат',
  questions: 'Вопросы',
  userStatus: 'Турнир',
  createdAt: 'Создан',
  playersCount: 'Игроков',
  leagueAmount: 'Ставка лиги',
  resultLabel: 'Статус',
  correctAnswersInRound: 'Верных в раунде',
  completedAt: 'Завершён',
};

const parseTournamentColumns = (raw: string | null): TournamentColumnKey[] => {
  if (!raw) return DEFAULT_TOURNAMENT_COLUMNS;
  const parsed = raw
    .split(',')
    .map((item) => item.trim())
    .filter((item): item is TournamentColumnKey => DEFAULT_TOURNAMENT_COLUMNS.includes(item as TournamentColumnKey));
  const unique = Array.from(new Set(parsed));
  if (unique.length !== DEFAULT_TOURNAMENT_COLUMNS.length) return DEFAULT_TOURNAMENT_COLUMNS;
  return unique;
};

const TOURNAMENT_COLS_STORAGE_KEY = 'adminTournamentCols';

const getStoredTournamentColumns = (): TournamentColumnKey[] => {
  if (typeof window === 'undefined') return DEFAULT_TOURNAMENT_COLUMNS;
  return parseTournamentColumns(window.localStorage.getItem(TOURNAMENT_COLS_STORAGE_KEY));
};

const resolveTournamentColumns = (raw: string | null): TournamentColumnKey[] => {
  if (raw) return parseTournamentColumns(raw);
  return getStoredTournamentColumns();
};

const Admin: React.FC<AdminProps> = ({ token }) => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const tabFromUrl = searchParams.get('tab');
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [withdrawals, setWithdrawals] = useState<WithdrawalRequestRow[]>([]);
  const [pendingWithdrawalsCount, setPendingWithdrawalsCount] = useState(0);
  const [withdrawalStatusFilter, setWithdrawalStatusFilter] = useState<string>(() => {
    const s = searchParams.get('status');
    if (s === 'pending' || s === 'approved' || s === 'rejected' || s === '') return s;
    return 'pending';
  });
  const [withdrawalSortBy, setWithdrawalSortBy] = useState<'id' | 'user' | 'amount' | 'details' | 'status' | 'admin' | 'processedAt' | 'createdAt'>('createdAt');
  const [withdrawalSortDir, setWithdrawalSortDir] = useState<'asc' | 'desc'>('desc');
  const [users, setUsers] = useState<UserRow[]>([]);
  const [userSortBy, setUserSortBy] = useState<'id' | 'username' | 'email' | 'balance' | 'balanceRubles' | 'isAdmin'>('id');
  const [userSortDir, setUserSortDir] = useState<'asc' | 'desc'>('asc');
  const [userSearch, setUserSearch] = useState('');
  const [section, setSection] = useState<'withdrawals' | 'users' | 'credit' | 'support' | 'statistics' | 'news'>(() =>
    tabFromUrl === 'users' ? 'users' : tabFromUrl === 'credit' ? 'credit' : tabFromUrl === 'support' ? 'support' : tabFromUrl === 'withdrawals' ? 'withdrawals' : tabFromUrl === 'news' ? 'news' : 'statistics'
  );
  const [menuOpen, setMenuOpen] = useState(false);

  const [newsList, setNewsList] = useState<{ id: number; topic: string; body: string; published: boolean; createdAt: string }[]>([]);
  const [newsLoading, setNewsLoading] = useState(false);
  const newsLoadedRef = React.useRef(false);
  const [newsTopic, setNewsTopic] = useState('');
  const [newsBody, setNewsBody] = useState('');
  const [newsCreating, setNewsCreating] = useState(false);
  const [newsError, setNewsError] = useState('');
  const [newsSuccess, setNewsSuccess] = useState('');
  const [newsEditId, setNewsEditId] = useState<number | null>(null);
  const [newsEditTopic, setNewsEditTopic] = useState('');
  const [newsEditBody, setNewsEditBody] = useState('');
  const [newsDeleteConfirmId, setNewsDeleteConfirmId] = useState<number | null>(null);
  const [newsPublishConfirm, setNewsPublishConfirm] = useState(false);
  const [newsGenerating, setNewsGenerating] = useState(false);
  const [usersLoading, setUsersLoading] = useState(false);
  const [creditUserId, setCreditUserId] = useState('');
  const [creditAmount, setCreditAmount] = useState('');
  const [creditLoading, setCreditLoading] = useState(false);
  const [creditError, setCreditError] = useState('');
  const [creditSuccess, setCreditSuccess] = useState('');
  const [creditHistory, setCreditHistory] = useState<{ id: number; userId: number; username: string; userEmail: string; amount: number; adminUsername: string; adminEmail: string; createdAt: string }[]>([]);
  const [creditHistoryLoaded, setCreditHistoryLoaded] = useState(false);

  const [supportTickets, setSupportTickets] = useState<any[]>([]);
  const [supportUnreadCount, setSupportUnreadCount] = useState(0);
  const [supportStatusFilter, setSupportStatusFilter] = useState<string>('open');
  const [supportOpenTicketId, setSupportOpenTicketId] = useState<number | null>(null);
  const [supportMessages, setSupportMessages] = useState<any[]>([]);
  const [supportReply, setSupportReply] = useState('');
  const [supportSending, setSupportSending] = useState(false);

  const [statsGroupBy, setStatsGroupBy] = useState<'day' | 'week' | 'month' | 'all'>('day');
  const [statsData, setStatsData] = useState<{ period: string; registrations: number; withdrawals: number; topups: number; gameIncome: number }[]>([]);
  const [statsMetrics, setStatsMetrics] = useState<Set<string>>(() => new Set(['registrations', 'topups', 'withdrawals', 'gameIncome']));

  const [statsSubTab, setStatsSubTab] = useState<'overview' | 'transactions' | 'questions' | 'tournaments' | 'project-cost'>(() => {
    const sub = searchParams.get('statsTab');
    return sub === 'transactions'
      ? 'transactions'
      : sub === 'questions'
        ? 'questions'
        : sub === 'tournaments'
          ? 'tournaments'
          : sub === 'project-cost'
            ? 'project-cost'
            : 'overview';
  });
  type QuestionStatRow = { topic: string; count: number };
  const topicNames: Record<string, string> = {
    math_logic: 'Математика и логика',
    math_addition: 'Математика: сложение',
    math_subtraction: 'Математика: вычитание',
    math_multiplication: 'Математика: умножение',
    math_division: 'Математика: деление',
    logic_sequences: 'Логика: последовательности',
    history_russia: 'История России',
    history_world: 'Всемирная история',
    science: 'Наука',
    capitals: 'Столицы',
    currencies: 'Валюты',
    countries_facts: 'Факты о странах',
    flags: 'Флаги',
    landmarks: 'Достопримечательности',
    architecture: 'Архитектура',
    wonders_of_world: 'Чудеса света',
    mountains: 'Горы',
    geography_facts: 'Географические факты',
    rivers: 'Реки',
    oceans: 'Океаны',
    deserts: 'Пустыни',
    volcanoes: 'Вулканы',
    islands: 'Острова',
    english_words: 'Английский язык',
    russian_literature: 'Русская литература',
    foreign_literature: 'Зарубежная литература',
    russian_poetry: 'Русская поэзия',
    music: 'Музыка',
    films: 'Кино',
    animals: 'Животные',
    birds: 'Птицы',
    sea_creatures: 'Морские обитатели',
    insects_reptiles: 'Насекомые и рептилии',
    dinosaurs: 'Динозавры',
    plants_flowers: 'Растения и цветы',
    trees: 'Деревья',
    cars: 'Автомобили',
    trains: 'Поезда',
    aviation: 'Авиация',
    ships: 'Корабли',
    it_programming: 'IT и программирование',
    ai_robotics: 'ИИ и робототехника',
    internet: 'Интернет',
    social_media: 'Соцсети',
    gadgets_brands: 'Гаджеты и бренды',
    religions: 'Религии',
    space: 'Космос',
    space_missions: 'Космические миссии',
    astronomy: 'Астрономия',
    psychology: 'Психология',
    cooking: 'Кулинария',
    weather: 'Погода и климат',
    minerals: 'Минералы',
    world_records: 'Мировые рекорды',
    nature: 'Природа',
    technology: 'Технологии',
    culture: 'Культура',
    geo: 'География',
    literature: 'Литература',
    music_film: 'Музыка и кино',
    cooking_extras: 'Кулинария (доп.)',
    psychology_facts: 'Психология (факты)',
    history_500: 'История (расш.)',
    culture_500: 'Культура (расш.)',
    nature_tech_500: 'Природа и техника (расш.)',
    geo_500: 'География (расш.)',
  };
  const [questionStats, setQuestionStats] = useState<QuestionStatRow[]>([]);
  const [questionStatsLoading, setQuestionStatsLoading] = useState(false);
  const questionStatsLoadedRef = React.useRef(false);
  const adminHeaderRef = React.useRef<HTMLElement | null>(null);

  type TournamentListRow = {
    tournamentId: number; status: string; createdAt: string; playersCount: number; leagueAmount: number | null;
    deadline: string | null; userStatus: string; stage?: string; resultLabel?: string; roundForQuestions: 'semi' | 'final';
    questionsAnswered: number; questionsTotal: number; correctAnswersInRound: number;
    completedAt?: string | null; roundFinished?: boolean; roundStartedAt?: string | null;
    userId: number; userNickname: string; phase: 'active' | 'history';
  };
  type BracketPlayer = {
    id: number;
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
  type BracketViewData = {
    tournamentId: number;
    gameType?: 'training' | 'money' | null;
    semi1: { players: BracketPlayer[] };
    semi2: { players: BracketPlayer[] } | null;
    final: { players: BracketPlayer[] };
    finalWinnerId?: number | null;
  };
  const [tournamentsList, setTournamentsList] = useState<TournamentListRow[]>([]);
  const [tournamentsListLoading, setTournamentsListLoading] = useState(false);
  const [tournamentsListError, setTournamentsListError] = useState<string | null>(null);
  const tournamentsListLoadedRef = React.useRef(false);
  const [tournamentIdFilter, setTournamentIdFilter] = useState<string>(() => searchParams.get('tournamentId') ?? '');
  const [tournamentColumns, setTournamentColumns] = useState<TournamentColumnKey[]>(
    () => resolveTournamentColumns(searchParams.get('tournamentCols')),
  );
  const [draggedTournamentColumn, setDraggedTournamentColumn] = useState<TournamentColumnKey | null>(null);
  const [dragOverTournamentColumn, setDragOverTournamentColumn] = useState<TournamentColumnKey | null>(null);
  const [bracketView, setBracketView] = useState<BracketViewData | null>(null);
  const [bracketLoading, setBracketLoading] = useState(false);
  const [bracketError, setBracketError] = useState('');
  const [bracketOpenSource, setBracketOpenSource] = useState<'active' | 'completed' | null>(null);
  const [bracketPlayerTooltip, setBracketPlayerTooltip] = useState<{
    playerId: number;
    displayName: string;
    avatarUrl: string | null;
    stats: PlayerStats;
    rect: DOMRect;
  } | null>(null);
  const bracketLeftColRef = React.useRef<HTMLDivElement>(null);
  const bracketFinalBlockRef = React.useRef<HTMLDivElement>(null);
  const [bracketBlocksEqualized, setBracketBlocksEqualized] = useState(false);
  const bracketLoadedTournamentIdRef = React.useRef<string | null>(null);
  const [questionsReviewTournamentId, setQuestionsReviewTournamentId] = useState<number | null>(null);
  const [questionsReviewTabIdx, setQuestionsReviewTabIdx] = useState(0);
  const [questionsReviewData, setQuestionsReviewData] = useState<{
    questionsSemi1: { id: number; question: string; options: string[]; correctAnswer: number }[];
    questionsSemi2: { id: number; question: string; options: string[]; correctAnswer: number }[];
    questionsFinal: { id: number; question: string; options: string[]; correctAnswer: number }[];
    questionsAnsweredCount: number;
    correctAnswersCount: number;
    semiFinalCorrectCount?: number | null;
    semiTiebreakerCorrectSum?: number;
    answersChosen: number[];
    userSemiIndex?: number;
    semiTiebreakerAllQuestions?: { id: number; question: string; options: string[]; correctAnswer: number }[][];
    semiTiebreakerRoundsCorrect?: number[];
    finalTiebreakerAllQuestions?: { id: number; question: string; options: string[]; correctAnswer: number }[][];
    finalTiebreakerRoundsCorrect?: number[];
    opponentAnswersByRound?: number[][];
    opponentInfoByRound?: { id: number; nickname: string; avatarUrl?: string | null }[];
  } | null>(null);
  const [questionsReviewLoading, setQuestionsReviewLoading] = useState(false);
  const [questionsReviewError, setQuestionsReviewError] = useState('');
  const [oppTooltip, setOppTooltip] = useState<{ loading: boolean; data: null | PlayerStats; visible: boolean; avatarUrl?: string | null }>({ loading: false, data: null, visible: false });
  const questionsLoadedTournamentRef = React.useRef<string | null>(null);
  const [qsSortBy, setQsSortBy] = useState<'topic' | 'count'>('count');
  const [qsSortDir, setQsSortDir] = useState<'asc' | 'desc'>('desc');
  type TxRow = { id: number; userId: number; username: string; email: string; amount: number; description: string; category: string; createdAt: string };
  const [txList, setTxList] = useState<TxRow[]>([]);
  const [txLoading, setTxLoading] = useState(false);
  const txLoadedRef = React.useRef(false);
  const [txCategoryFilter, setTxCategoryFilter] = useState<'' | 'topup' | 'withdraw' | 'win' | 'other'>('');
  const [txSortBy, setTxSortBy] = useState<'id' | 'userId' | 'username' | 'email' | 'category' | 'amount' | 'createdAt'>('id');
  const [txSortDir, setTxSortDir] = useState<'asc' | 'desc'>('desc');
  const [projectCostData, setProjectCostData] = useState<ProjectCostDashboardData | null>(null);
  const [projectCostLoading, setProjectCostLoading] = useState(false);
  const projectCostLoadedRef = React.useRef(false);

  // Восстановить вкладку и фильтр статуса из URL при загрузке/обновлении
  useEffect(() => {
    const tab = searchParams.get('tab');
    const status = searchParams.get('status');
    const groupBy = searchParams.get('statsGroupBy');
    if (tab === 'users') setSection('users');
    else if (tab === 'credit') setSection('credit');
    else if (tab === 'support') setSection('support');
    else if (tab === 'statistics') setSection('statistics');
    else if (tab === 'withdrawals') setSection('withdrawals');
    else if (tab === 'news') setSection('news');
    if (status === 'pending' || status === 'approved' || status === 'rejected' || status === '') {
      setWithdrawalStatusFilter(status);
    }
    if (groupBy === 'day' || groupBy === 'week' || groupBy === 'month' || groupBy === 'all') {
      setStatsGroupBy(groupBy);
    }
    const sTab = searchParams.get('statsTab');
    if (sTab === 'transactions') setStatsSubTab('transactions');
    else if (sTab === 'questions') setStatsSubTab('questions');
    else if (sTab === 'tournaments') setStatsSubTab('tournaments');
    else if (sTab === 'project-cost') setStatsSubTab('project-cost');
    else if (sTab === 'overview' || !sTab) setStatsSubTab((prev) => sTab === 'overview' ? 'overview' : prev);
    const tid = searchParams.get('tournamentId');
    if (tid !== null) setTournamentIdFilter(tid ?? '');
    const tournamentColsParam = searchParams.get('tournamentCols');
    const resolvedTournamentColumns = resolveTournamentColumns(tournamentColsParam);
    setTournamentColumns(resolvedTournamentColumns);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(TOURNAMENT_COLS_STORAGE_KEY, resolvedTournamentColumns.join(','));
    }
    if (!tournamentColsParam) {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        next.set('tournamentCols', resolvedTournamentColumns.join(','));
        return next;
      }, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  const setSectionAndUrl = (next: 'withdrawals' | 'users' | 'credit' | 'support' | 'statistics' | 'news') => {
    setSection(next);
    setSearchParams((prev) => {
      const nextParams = new URLSearchParams(prev);
      if (next === 'users') {
        nextParams.set('tab', 'users');
        nextParams.delete('status');
      } else if (next === 'credit') {
        nextParams.set('tab', 'credit');
        nextParams.delete('status');
      } else if (next === 'support') {
        nextParams.set('tab', 'support');
        nextParams.delete('status');
      } else if (next === 'statistics') {
        nextParams.set('tab', 'statistics');
        nextParams.set('statsGroupBy', statsGroupBy);
        nextParams.set('statsTab', statsSubTab);
        nextParams.delete('status');
      } else if (next === 'news') {
        nextParams.set('tab', 'news');
        nextParams.delete('status');
      } else {
        nextParams.delete('tab');
        nextParams.set('status', withdrawalStatusFilter);
      }
      return nextParams;
    }, { replace: true });
  };
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [actionSuccessMsg, setActionSuccessMsg] = useState('');
  const [approvedTransfer, setApprovedTransfer] = useState<{ id: number; amount: number; details: string | null; username: string; email: string } | null>(null);
  const headers = React.useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);

  const formatTimeLeft = (deadline: string | null): string => {
    if (!deadline) return '—';
    const end = new Date(deadline).getTime();
    const now = Date.now();
    if (end <= now) return '—';
    const ms = end - now;
    const h = Math.floor(ms / 3600000);
    const m = Math.floor((ms % 3600000) / 60000);
    if (h > 0) return `${h} ч ${m} мин`;
    return `${m} мин`;
  };

  const formatRubles = (amount: number): string => `${Number(amount || 0).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₽`;

  const getTournamentStatusLabel = (status: string) => {
    switch (status) {
      case 'waiting': return 'Ожидание';
      case 'active': return 'Активен';
      case 'finished': return 'Завершён';
      default: return status || '—';
    }
  };

  const getWithdrawalStatusLabel = (status: string) => {
    switch (status) {
      case 'pending': return 'Ожидает решения';
      case 'approved': return 'Одобрена';
      case 'rejected': return 'Отклонена';
      default: return status;
    }
  };

  const getWithdrawalSortValue = React.useCallback((w: WithdrawalRequestRow, key: typeof withdrawalSortBy): string | number => {
    switch (key) {
      case 'id': return w.id;
      case 'user': return w.user ? `${w.user.username} ${w.user.email || ''}`.toLowerCase() : '';
      case 'amount': return Number(w.amount);
      case 'details': return (w.details || '').toLowerCase();
      case 'status': return w.status;
      case 'admin': return (w.processedByAdminUsername || '').toLowerCase();
      case 'processedAt': return w.processedAt ? new Date(w.processedAt).getTime() : 0;
      case 'createdAt': return new Date(w.createdAt || 0).getTime();
      default: return '';
    }
  }, []);

  const sortedWithdrawals = React.useMemo(() => {
    const list = [...withdrawals];
    const dir = withdrawalSortDir === 'asc' ? 1 : -1;
    list.sort((a, b) => {
      const va = getWithdrawalSortValue(a, withdrawalSortBy);
      const vb = getWithdrawalSortValue(b, withdrawalSortBy);
      if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * dir;
      return String(va).localeCompare(String(vb), 'ru') * dir;
    });
    return list;
  }, [withdrawals, withdrawalSortBy, withdrawalSortDir, getWithdrawalSortValue]);

  const handleWithdrawalSort = (key: typeof withdrawalSortBy) => {
    if (withdrawalSortBy === key) {
      setWithdrawalSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setWithdrawalSortBy(key);
      setWithdrawalSortDir('desc');
    }
  };

  const SortableTh = ({ sortKey, children }: { sortKey: typeof withdrawalSortBy; children: React.ReactNode }) => (
    <th className="admin-table-th-sortable" onClick={() => handleWithdrawalSort(sortKey)}>
      {children}
      {withdrawalSortBy === sortKey && <span className="admin-table-sort-icon" aria-hidden>{withdrawalSortDir === 'asc' ? ' ↑' : ' ↓'}</span>}
    </th>
  );

  const sortedUsers = React.useMemo(() => {
    const isSearchingById = userSearch.trim() && /^\d+$/.test(userSearch.trim());
    if (isSearchingById) return users;
    const list = [...users];
    const dir = userSortDir === 'asc' ? 1 : -1;
    list.sort((a, b) => {
      let va: string | number; let vb: string | number;
      switch (userSortBy) {
        case 'id': va = a.id; vb = b.id; return (va - vb) * dir;
        case 'username': va = (a.username || '').toLowerCase(); vb = (b.username || '').toLowerCase(); return String(va).localeCompare(String(vb), 'ru') * dir;
        case 'email': va = (a.email || '').toLowerCase(); vb = (b.email || '').toLowerCase(); return String(va).localeCompare(String(vb), 'ru') * dir;
        case 'balance': va = Number(a.balance); vb = Number(b.balance); return (va - vb) * dir;
        case 'balanceRubles': va = Number(a.balanceRubles); vb = Number(b.balanceRubles); return (va - vb) * dir;
        case 'isAdmin': va = a.isAdmin ? 1 : 0; vb = b.isAdmin ? 1 : 0; return (va - vb) * dir;
        default: return 0;
      }
    });
    return list;
  }, [users, userSortBy, userSortDir, userSearch]);

  const handleUserSort = (key: typeof userSortBy) => {
    if (userSortBy === key) {
      setUserSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setUserSortBy(key);
      setUserSortDir('asc');
    }
  };

  const UserSortableTh = ({ sortKey, children }: { sortKey: typeof userSortBy; children: React.ReactNode }) => (
    <th className="admin-table-th-sortable" onClick={() => handleUserSort(sortKey)}>
      {children}
      {userSortBy === sortKey && <span className="admin-table-sort-icon" aria-hidden>{userSortDir === 'asc' ? ' ↑' : ' ↓'}</span>}
    </th>
  );

  useEffect(() => {
    axios.get('/users/profile', { headers })
      .then((res) => {
        const idAdmin = res.data?.id === 1;
        const isAdmin = idAdmin || res.data?.isAdmin === true || res.data?.isAdmin === 1 || res.data?.isAdmin === '1' || !!res.data?.isAdmin;
        setIsAdmin(!!isAdmin);
      })
      .catch(() => setIsAdmin(false));
  }, [token, headers]);

  const fetchWithdrawals = React.useCallback(() => {
    if (!token) return;
    const status = withdrawalStatusFilter ? String(withdrawalStatusFilter) : undefined;
    axios.get<WithdrawalRequestRow[]>(`/admin/withdrawal-requests${status ? `?status=${status}` : ''}`, { headers })
      .then((res) => {
        const list = Array.isArray(res.data) ? res.data : [];
        setWithdrawals(list);
        if (!status) setPendingWithdrawalsCount(list.filter((r) => r.status === 'pending').length);
        else if (status === 'pending') setPendingWithdrawalsCount(list.length);
      })
      .catch(() => setWithdrawals([]));
  }, [token, withdrawalStatusFilter, headers]);

  useEffect(() => {
    if (!isAdmin || !token) return;
    if (section === 'withdrawals') {
      fetchWithdrawals();
      const interval = setInterval(fetchWithdrawals, 2000);
      return () => clearInterval(interval);
    }
  }, [isAdmin, token, section, fetchWithdrawals]);

  useEffect(() => {
    if (!isAdmin || !token) return;
    if (section === 'withdrawals') return;
    const loadPending = () => {
      axios.get<WithdrawalRequestRow[]>(`/admin/withdrawal-requests?status=pending`, { headers })
        .then((res) => setPendingWithdrawalsCount(Array.isArray(res.data) ? res.data.length : 0))
        .catch(() => setPendingWithdrawalsCount(0));
    };
    loadPending();
    const interval = setInterval(loadPending, 5000);
    return () => clearInterval(interval);
  }, [isAdmin, token, section, headers]);

  useEffect(() => {
    if (!isAdmin || !token || section !== 'users') return;
    const params = new URLSearchParams();
    params.set('limit', '500');
    if (userSearch.trim()) params.set('search', userSearch.trim());
    const query = params.toString() ? `?${params.toString()}` : '';
    setError('');
    if (users.length === 0) setUsersLoading(true);
    axios.get<UserRow[]>(`/admin/users${query}`, { headers })
      .then((res) => {
        const data = res.data;
        const list = Array.isArray(data) ? data : (data && Array.isArray((data as any).data) ? (data as any).data : (data && Array.isArray((data as any).users) ? (data as any).users : []));
        const sorted = userSearch.trim() ? list : [...list].sort((a, b) => (a.id ?? 0) - (b.id ?? 0));
        setUsers(sorted);
      })
      .catch((err) => {
        setUsers([]);
        setError(err?.response?.data?.message || err?.message || 'Не удалось загрузить список пользователей');
      })
      .finally(() => setUsersLoading(false));
  }, [isAdmin, token, section, userSearch, headers]);

  const fetchCreditHistory = React.useCallback(() => {
    if (!token) return;
    axios.get<{ id: number; userId: number; username: string; userEmail: string; amount: number; adminUsername: string; adminEmail: string; createdAt: string }[]>(
      '/admin/credit-history', { headers },
    )
      .then((res) => setCreditHistory(Array.isArray(res.data) ? res.data : []))
      .catch(() => setCreditHistory([]))
      .finally(() => setCreditHistoryLoaded(true));
  }, [token, headers]);

  useEffect(() => {
    if (!isAdmin || !token || section !== 'credit') return;
    if (!creditHistoryLoaded) fetchCreditHistory();
  }, [isAdmin, token, section, creditHistoryLoaded, fetchCreditHistory]);

  const fetchSupportTickets = React.useCallback(() => {
    if (!token) return;
    const q = supportStatusFilter ? `?status=${supportStatusFilter}` : '';
    axios.get(`/support/admin/tickets${q}`, { headers })
      .then((r) => setSupportTickets(Array.isArray(r.data) ? r.data : []))
      .catch(() => {});
  }, [token, headers, supportStatusFilter]);

  const fetchSupportUnread = React.useCallback(() => {
    if (!token) return;
    axios.get<{ count: number }>('/support/admin/unread-count', { headers })
      .then((r) => setSupportUnreadCount(r.data.count ?? 0))
      .catch(() => {});
  }, [token, headers]);

  useEffect(() => {
    if (!isAdmin || !token) return;
    fetchSupportUnread();
    const iv = setInterval(fetchSupportUnread, 5000);
    return () => clearInterval(iv);
  }, [isAdmin, token, fetchSupportUnread]);

  useEffect(() => {
    if (!isAdmin || !token || section !== 'support') return;
    fetchSupportTickets();
    const iv = setInterval(fetchSupportTickets, 5000);
    return () => clearInterval(iv);
  }, [isAdmin, token, section, fetchSupportTickets]);

  const openSupportTicket = async (ticketId: number) => {
    setSupportOpenTicketId(ticketId);
    setSupportMessages([]);
    try {
      const r = await axios.get(`/support/admin/tickets/${ticketId}/messages`, { headers });
      setSupportMessages(Array.isArray(r.data) ? r.data : []);
      fetchSupportTickets();
      fetchSupportUnread();
    } catch {}
  };

  const sendSupportReply = async () => {
    if (!supportOpenTicketId || !supportReply.trim() || supportSending) return;
    setSupportSending(true);
    try {
      await axios.post(`/support/admin/tickets/${supportOpenTicketId}/messages`, { text: supportReply.trim() }, { headers });
      setSupportReply('');
      const r = await axios.get(`/support/admin/tickets/${supportOpenTicketId}/messages`, { headers });
      setSupportMessages(Array.isArray(r.data) ? r.data : []);
      fetchSupportTickets();
    } catch {}
    setSupportSending(false);
  };

  const closeSupportTicket = async () => {
    if (!supportOpenTicketId) return;
    try {
      await axios.post(`/support/admin/tickets/${supportOpenTicketId}/close`, {}, { headers });
      fetchSupportTickets();
      setSupportOpenTicketId(null);
    } catch {}
  };

  const reopenSupportTicket = async () => {
    if (!supportOpenTicketId) return;
    try {
      await axios.post(`/support/admin/tickets/${supportOpenTicketId}/reopen`, {}, { headers });
      fetchSupportTickets();
    } catch {}
  };

  const fetchStats = React.useCallback(() => {
    if (!token) return;
    axios.get<{ data: { period: string; registrations: number; withdrawals: number; topups: number; gameIncome: number }[] }>(
      `/admin/stats?groupBy=${statsGroupBy}`,
      { headers },
    )
      .then((r) => setStatsData(r.data.data || []))
      .catch(() => setStatsData([]));
  }, [token, headers, statsGroupBy]);

  useEffect(() => {
    if (!isAdmin || !token || section !== 'statistics') return;
    fetchStats();
  }, [isAdmin, token, section, fetchStats]);

  const fetchTransactions = React.useCallback(() => {
    if (!token) return;
    if (!txLoadedRef.current) setTxLoading(true);
    const catParam = txCategoryFilter ? `?category=${txCategoryFilter}` : '';
    axios.get<TxRow[]>(`/admin/transactions${catParam}`, { headers })
      .then((r) => setTxList(Array.isArray(r.data) ? r.data : []))
      .catch(() => setTxList([]))
      .finally(() => { setTxLoading(false); txLoadedRef.current = true; });
  }, [token, headers, txCategoryFilter]);

  useEffect(() => {
    if (!isAdmin || !token || section !== 'statistics' || statsSubTab !== 'transactions') return;
    fetchTransactions();
  }, [isAdmin, token, section, statsSubTab, fetchTransactions]);

  const fetchQuestionStats = React.useCallback(() => {
    if (!token) return;
    if (!questionStatsLoadedRef.current) setQuestionStatsLoading(true);
    axios.get<QuestionStatRow[]>('/admin/question-stats', { headers })
      .then((r) => setQuestionStats(Array.isArray(r.data) ? r.data : []))
      .catch(() => setQuestionStats([]))
      .finally(() => { setQuestionStatsLoading(false); questionStatsLoadedRef.current = true; });
  }, [token, headers]);

  useEffect(() => {
    if (!isAdmin || !token || section !== 'statistics' || statsSubTab !== 'questions') return;
    fetchQuestionStats();
  }, [isAdmin, token, section, statsSubTab, fetchQuestionStats]);

  const fetchTournamentsList = React.useCallback(() => {
    if (!token) return;
    if (!tournamentsListLoadedRef.current) setTournamentsListLoading(true);
    setTournamentsListError(null);
    axios.get<TournamentListRow[]>('/admin/tournaments-list', { headers })
      .then((r) => { setTournamentsList(Array.isArray(r.data) ? r.data : []); setTournamentsListError(null); })
      .catch((e) => { setTournamentsList([]); setTournamentsListError(e?.response?.data?.message || e?.message || 'Ошибка загрузки списка турниров'); })
      .finally(() => { setTournamentsListLoading(false); tournamentsListLoadedRef.current = true; });
  }, [token, headers]);

  useEffect(() => {
    if (!isAdmin || !token || section !== 'statistics' || statsSubTab !== 'tournaments') return;
    fetchTournamentsList();
  }, [isAdmin, token, section, statsSubTab, fetchTournamentsList]);

  const fetchProjectCost = React.useCallback(() => {
    if (!token) return;
    if (!projectCostLoadedRef.current) setProjectCostLoading(true);
    axios.get<ProjectCostDashboardData>('/admin/project-cost', { headers })
      .then((r) => setProjectCostData(r.data ?? { currentTotal: 0, todayTotal: 0, updatedAt: null, history: [] }))
      .catch(() => setProjectCostData({ currentTotal: 0, todayTotal: 0, updatedAt: null, history: [] }))
      .finally(() => {
        setProjectCostLoading(false);
        projectCostLoadedRef.current = true;
      });
  }, [token, headers]);

  useEffect(() => {
    if (!isAdmin || !token || section !== 'statistics' || statsSubTab !== 'project-cost') return;
    fetchProjectCost();
  }, [isAdmin, token, section, statsSubTab, fetchProjectCost]);

  useEffect(() => {
    if (!isAdmin || !token || section !== 'statistics' || statsSubTab !== 'project-cost') return;
    const iv = window.setInterval(() => {
      fetchProjectCost();
    }, 30000);
    return () => window.clearInterval(iv);
  }, [isAdmin, token, section, statsSubTab, fetchProjectCost]);

  const updateTournamentColumns = React.useCallback((nextColumns: TournamentColumnKey[]) => {
    setTournamentColumns(nextColumns);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(TOURNAMENT_COLS_STORAGE_KEY, nextColumns.join(','));
    }
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('tournamentCols', nextColumns.join(','));
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  const reorderTournamentColumns = React.useCallback((sourceColumn: TournamentColumnKey, targetColumn: TournamentColumnKey) => {
    if (sourceColumn === targetColumn) return;
    const sourceIndex = tournamentColumns.indexOf(sourceColumn);
    const targetIndex = tournamentColumns.indexOf(targetColumn);
    if (sourceIndex < 0 || targetIndex < 0) return;
    const next = [...tournamentColumns];
    next.splice(sourceIndex, 1);
    next.splice(targetIndex, 0, sourceColumn);
    updateTournamentColumns(next);
  }, [tournamentColumns, updateTournamentColumns]);

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
      const maxW = Math.max(leftCol.offsetWidth, finalBlock.offsetWidth, 200);
      leftCol.style.width = `${maxW}px`;
      finalBlock.style.width = `${maxW}px`;
      setBracketBlocksEqualized(true);
    };
    rafId = requestAnimationFrame(() => {
      requestAnimationFrame(run);
    });
    return () => cancelAnimationFrame(rafId);
  }, [bracketView]);

  const openBracketModal = React.useCallback((tournamentId: number, phase: 'active' | 'history', userId: number) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('tournamentModal', String(tournamentId));
      next.set('tournamentSource', phase === 'history' ? 'completed' : 'active');
      next.set('tournamentUserId', String(userId));
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  const closeBracket = React.useCallback(() => {
    setBracketView(null);
    setBracketError('');
    setBracketPlayerTooltip(null);
    setBracketOpenSource(null);
    bracketLoadedTournamentIdRef.current = null;
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete('tournamentModal');
      next.delete('tournamentSource');
      next.delete('tournamentUserId');
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  useEffect(() => {
    const rawId = searchParams.get('tournamentModal');
    const id = rawId && /^\d+$/.test(rawId) ? Number(rawId) : null;
    const source = searchParams.get('tournamentSource');
    const rawUserId = searchParams.get('tournamentUserId');
    const viewerUserId = rawUserId && /^\d+$/.test(rawUserId) ? Number(rawUserId) : null;
    const normalizedSource = source === 'completed' ? 'completed' : source === 'active' ? 'active' : null;
    if (!id || !token || !viewerUserId) {
      setBracketView(null);
      setBracketError('');
      setBracketLoading(false);
      setBracketOpenSource(normalizedSource);
      bracketLoadedTournamentIdRef.current = null;
      return;
    }
    const bracketKey = `${id}:${viewerUserId}`;
    if (bracketLoadedTournamentIdRef.current === bracketKey && (bracketView || bracketError)) {
      setBracketOpenSource(normalizedSource);
      return;
    }
    bracketLoadedTournamentIdRef.current = bracketKey;
    setBracketLoading(true);
    setBracketError('');
    setBracketPlayerTooltip(null);
    setBracketOpenSource(normalizedSource);
    axios.get<BracketViewData>(`/tournaments/admin/${id}/bracket?userId=${viewerUserId}`, { headers })
      .then((res) => {
        setBracketView(res.data);
        setBracketError('');
      })
      .catch((e: unknown) => {
        const err = e && typeof e === 'object' && 'response' in e ? (e as { response?: { data?: { message?: string | string[] } } }).response : undefined;
        const msg = err?.data?.message;
        const text = Array.isArray(msg) ? msg[0] : typeof msg === 'string' ? msg : (e instanceof Error ? e.message : 'Не удалось загрузить сетку');
        setBracketView(null);
        setBracketError(text || 'Не удалось загрузить сетку');
      })
      .finally(() => setBracketLoading(false));
  }, [searchParams, token, headers, bracketView, bracketError]);

  const openQuestionsReview = React.useCallback((tournamentId: number, roundForQuestions: 'semi' | 'final', userId: number) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('questionsModal', String(tournamentId));
      next.set('questionsRound', roundForQuestions);
      next.set('questionsUserId', String(userId));
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  const closeQuestionsReview = React.useCallback(() => {
    setQuestionsReviewTournamentId(null);
    setQuestionsReviewTabIdx(0);
    setQuestionsReviewData(null);
    setQuestionsReviewError('');
    setOppTooltip({ loading: false, data: null, visible: false });
    questionsLoadedTournamentRef.current = null;
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete('questionsModal');
      next.delete('questionsRound');
      next.delete('questionsUserId');
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  useEffect(() => {
    const rawId = searchParams.get('questionsModal');
    const id = rawId && /^\d+$/.test(rawId) ? Number(rawId) : null;
    const round = searchParams.get('questionsRound') === 'final' ? 'final' : 'semi';
    const rawUserId = searchParams.get('questionsUserId');
    const viewerUserId = rawUserId && /^\d+$/.test(rawUserId) ? Number(rawUserId) : null;
    if (!id || !token || !viewerUserId) {
      setQuestionsReviewTournamentId(null);
      setQuestionsReviewData(null);
      setQuestionsReviewLoading(false);
      setQuestionsReviewError('');
      questionsLoadedTournamentRef.current = null;
      return;
    }
    const key = `${id}:${viewerUserId}:${round}`;
    if (questionsLoadedTournamentRef.current === key && (questionsReviewData || questionsReviewError)) {
      setQuestionsReviewTournamentId(id);
      return;
    }
    questionsLoadedTournamentRef.current = key;
    setQuestionsReviewTournamentId(id);
    setQuestionsReviewTabIdx(0);
    setQuestionsReviewData(null);
    setQuestionsReviewError('');
    setQuestionsReviewLoading(true);
    axios.get<{
      questionsSemi1: { id: number; question: string; options: string[]; correctAnswer: number }[];
      questionsSemi2: { id: number; question: string; options: string[]; correctAnswer: number }[];
      questionsFinal: { id: number; question: string; options: string[]; correctAnswer: number }[];
      questionsAnsweredCount: number;
      correctAnswersCount: number;
      semiFinalCorrectCount?: number | null;
      semiTiebreakerCorrectSum?: number;
      answersChosen?: number[];
      userSemiIndex?: number;
      semiTiebreakerAllQuestions?: { id: number; question: string; options: string[]; correctAnswer: number }[][];
      semiTiebreakerRoundsCorrect?: number[];
      finalTiebreakerAllQuestions?: { id: number; question: string; options: string[]; correctAnswer: number }[][];
      finalTiebreakerRoundsCorrect?: number[];
      opponentAnswersByRound?: number[][];
      opponentInfoByRound?: { id: number; nickname: string; avatarUrl?: string | null }[];
      answers_chosen?: number[];
    }>(`/tournaments/admin/${id}/training-state?userId=${viewerUserId}`, { headers })
      .then(({ data }) => {
        const answersChosenRaw = data.answersChosen ?? data.answers_chosen;
        setQuestionsReviewData({
          questionsSemi1: data.questionsSemi1 ?? [],
          questionsSemi2: data.questionsSemi2 ?? [],
          questionsFinal: data.questionsFinal ?? [],
          questionsAnsweredCount: data.questionsAnsweredCount ?? 0,
          correctAnswersCount: data.correctAnswersCount ?? 0,
          semiFinalCorrectCount: data.semiFinalCorrectCount ?? null,
          semiTiebreakerCorrectSum: data.semiTiebreakerCorrectSum ?? 0,
          answersChosen: Array.isArray(answersChosenRaw) ? answersChosenRaw : [],
          userSemiIndex: data.userSemiIndex ?? 0,
          semiTiebreakerAllQuestions: data.semiTiebreakerAllQuestions ?? [],
          semiTiebreakerRoundsCorrect: data.semiTiebreakerRoundsCorrect ?? [],
          finalTiebreakerAllQuestions: data.finalTiebreakerAllQuestions ?? [],
          finalTiebreakerRoundsCorrect: data.finalTiebreakerRoundsCorrect ?? [],
          opponentAnswersByRound: data.opponentAnswersByRound ?? [],
          opponentInfoByRound: data.opponentInfoByRound ?? [],
        });
      })
      .catch((e: unknown) => {
        const msg = axios.isAxiosError(e) && e.response?.data?.message ? String(e.response.data.message) : 'Не удалось загрузить вопросы';
        setQuestionsReviewError(msg);
      })
      .finally(() => setQuestionsReviewLoading(false));
  }, [searchParams, token, headers, questionsReviewData, questionsReviewError]);

  const loadOppStats = React.useCallback((userId: number, avatarUrl?: string | null) => {
    if (oppTooltip.data && oppTooltip.visible) {
      setOppTooltip((prev) => ({ ...prev, visible: false }));
      return;
    }
    setOppTooltip({ loading: true, data: null, visible: true, avatarUrl });
    axios.get<PlayerStats>(`/users/${userId}/public-stats`, { headers })
      .then((res) => setOppTooltip({ loading: false, data: res.data, visible: true, avatarUrl }))
      .catch(() => setOppTooltip({ loading: false, data: null, visible: false }));
  }, [headers, oppTooltip.data, oppTooltip.visible]);

  const renderTournamentCell = React.useCallback((row: TournamentListRow, column: TournamentColumnKey) => {
    switch (column) {
      case 'tournamentId':
        return (
          <td className="admin-tournament-col-id" style={{ textAlign: 'center' }}>
            <button type="button" className="admin-tournament-cell-link" onClick={() => openBracketModal(row.tournamentId, row.phase, row.userId)}>
              {row.tournamentId}
            </button>
          </td>
        );
      case 'userNickname':
        return <td className="admin-td-left">{row.userNickname}</td>;
      case 'userId':
        return <td style={{ textAlign: 'center' }}>{row.userId}</td>;
      case 'phase':
        return <td style={{ textAlign: 'center' }}>{row.phase === 'active' ? 'Активный' : 'История'}</td>;
      case 'stage':
        return <td style={{ textAlign: 'center' }}>{row.stage ?? '—'}</td>;
      case 'roundStartedAt':
        return <td style={{ textAlign: 'center' }}>{row.roundStartedAt ? formatMoscowDateTime(row.roundStartedAt) : '—'}</td>;
      case 'deadline':
        return <td style={{ textAlign: 'center' }}>{formatTimeLeft(row.deadline)}</td>;
      case 'status':
        return <td style={{ textAlign: 'center' }}>{getTournamentStatusLabel(row.status)}</td>;
      case 'questions':
        return (
          <td style={{ textAlign: 'center' }}>
            <button
              type="button"
              className="admin-tournament-cell-link"
              onClick={() => openQuestionsReview(row.tournamentId, row.roundForQuestions, row.userId)}
              title="Всего / отвечено / правильно"
            >
              {`${row.questionsTotal}/${row.questionsAnswered}${row.correctAnswersInRound != null ? `/${row.correctAnswersInRound}` : ''}`}
            </button>
          </td>
        );
      case 'userStatus':
        return <td style={{ textAlign: 'center' }}>{row.userStatus === 'passed' ? 'Пройден' : 'Не пройден'}</td>;
      case 'createdAt':
        return <td style={{ textAlign: 'center' }}>{row.createdAt ? formatMoscowDateTime(row.createdAt) : '—'}</td>;
      case 'playersCount':
        return <td style={{ textAlign: 'center' }}>{row.playersCount}</td>;
      case 'leagueAmount':
        return <td style={{ textAlign: 'center' }}>{row.leagueAmount != null ? row.leagueAmount : '—'}</td>;
      case 'resultLabel':
        return <td style={{ textAlign: 'center' }}>{row.resultLabel ?? '—'}</td>;
      case 'correctAnswersInRound':
        return <td style={{ textAlign: 'center' }}>{row.correctAnswersInRound}</td>;
      case 'completedAt':
        return <td style={{ textAlign: 'center' }}>{row.completedAt ? formatMoscowDateTime(row.completedAt) : '—'}</td>;
      default:
        return <td>—</td>;
    }
  }, [openBracketModal, openQuestionsReview]);

  const sortedQuestionStats = React.useMemo(() => {
    const list = [...questionStats];
    const dir = qsSortDir === 'asc' ? 1 : -1;
    list.sort((a, b) => {
      if (qsSortBy === 'count') return (a.count - b.count) * dir;
      return a.topic.localeCompare(b.topic, 'ru') * dir;
    });
    return list;
  }, [questionStats, qsSortBy, qsSortDir]);

  const sortedTxList = React.useMemo(() => {
    const list = [...txList];
    const dir = txSortDir === 'asc' ? 1 : -1;
    list.sort((a, b) => {
      let va: string | number; let vb: string | number;
      switch (txSortBy) {
        case 'id': return (a.id - b.id) * dir;
        case 'userId': return (a.userId - b.userId) * dir;
        case 'amount': return (Number(a.amount) - Number(b.amount)) * dir;
        case 'createdAt':
          va = a.createdAt ? new Date(a.createdAt).getTime() : 0;
          vb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
          return ((va as number) - (vb as number)) * dir;
        case 'username': return (a.username || '').localeCompare(b.username || '', 'ru') * dir;
        case 'email': return (a.email || '').localeCompare(b.email || '', 'ru') * dir;
        case 'category': return (a.category || '').localeCompare(b.category || '', 'ru') * dir;
        default: return 0;
      }
    });
    return list;
  }, [txList, txSortBy, txSortDir]);

  const handleTxSort = (key: typeof txSortBy) => {
    if (txSortBy === key) {
      setTxSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setTxSortBy(key);
      setTxSortDir('desc');
    }
  };

  const TxSortableTh = ({ sortKey, children }: { sortKey: typeof txSortBy; children: React.ReactNode }) => (
    <th className="admin-table-th-sortable" onClick={() => handleTxSort(sortKey)}>
      {children}
      {txSortBy === sortKey && <span className="admin-table-sort-icon" aria-hidden>{txSortDir === 'asc' ? ' ↑' : ' ↓'}</span>}
    </th>
  );

  const fetchNews = React.useCallback(() => {
    if (!token) return;
    if (!newsLoadedRef.current) setNewsLoading(true);
    axios.get<{ id: number; topic: string; body: string; published: boolean; createdAt: string }[]>(
      '/news/admin', { headers },
    )
      .then((r) => setNewsList(Array.isArray(r.data) ? r.data : []))
      .catch(() => setNewsList([]))
      .finally(() => { setNewsLoading(false); newsLoadedRef.current = true; });
  }, [token, headers]);

  useEffect(() => {
    if (!isAdmin || !token || section !== 'news') return;
    fetchNews();
  }, [isAdmin, token, section, fetchNews]);

  const handleGenerateNews = async () => {
    setNewsGenerating(true);
    setNewsError('');
    try {
      const res = await axios.post<{ topic: string; body: string }>('/news/generate', {}, { headers });
      setNewsTopic(res.data.topic || '');
      setNewsBody(res.data.body || '');
    } catch (err: any) {
      const msg = err?.response?.data?.message || err?.message || 'Ошибка при генерации';
      setNewsError(typeof msg === 'string' ? msg : 'Ошибка при генерации');
    } finally {
      setNewsGenerating(false);
    }
  };

  const handleCreateNews = async () => {
    setNewsCreating(true);
    setNewsSuccess('');
    try {
      await axios.post('/news', { topic: newsTopic.trim(), body: newsBody.trim() }, { headers });
      setNewsSuccess('Новость опубликована');
      setNewsTopic('');
      setNewsBody('');
      fetchNews();
      setTimeout(() => setNewsSuccess(''), 3000);
    } catch {
      setNewsError('Ошибка при создании новости');
    } finally {
      setNewsCreating(false);
    }
  };

  const handleDeleteNews = async (id: number) => {
    try {
      await axios.delete(`/news/${id}`, { headers });
      setNewsDeleteConfirmId(null);
      fetchNews();
    } catch {
      setNewsError('Ошибка при удалении');
      setNewsDeleteConfirmId(null);
    }
  };

  const handleTogglePublish = async (id: number, published: boolean) => {
    try {
      await axios.put(`/news/${id}`, { published: !published }, { headers });
      fetchNews();
    } catch {
      setNewsError('Ошибка при обновлении');
    }
  };

  const handleSaveEdit = async (id: number) => {
    if (!newsEditTopic.trim() || !newsEditBody.trim()) return;
    try {
      await axios.put(`/news/${id}`, { topic: newsEditTopic.trim(), body: newsEditBody.trim() }, { headers });
      setNewsEditId(null);
      fetchNews();
    } catch {
      setNewsError('Ошибка при сохранении');
    }
  };

  const handleCreditBalance = async () => {
    const uid = parseInt(creditUserId.trim(), 10);
    const amt = parseFloat(creditAmount.trim());
    if (!uid || uid <= 0) { setCreditError('Введите корректный ID пользователя'); return; }
    if (!amt || amt <= 0) { setCreditError('Введите корректную сумму (> 0)'); return; }
    setCreditLoading(true);
    setCreditError('');
    setCreditSuccess('');
    try {
      const res = await axios.post<{ success: boolean; newBalanceRubles: number }>(
        '/admin/credit-balance',
        { userId: uid, amount: amt },
        { headers },
      );
      setCreditSuccess(`Начислено ${amt} ₽ пользователю ID ${uid}. Новый баланс рублей: ${res.data.newBalanceRubles} ₽`);
      setCreditUserId('');
      setCreditAmount('');
      fetchCreditHistory();
    } catch (e: any) {
      setCreditError(e?.response?.data?.message || e?.message || 'Не удалось начислить');
    } finally {
      setCreditLoading(false);
    }
  };

  const handleApprove = async (id: number) => {
    setLoading(true);
    setError('');
    setActionSuccessMsg('');
    setApprovedTransfer(null);
    try {
      await axios.post(`/admin/withdrawal-requests/${id}/approve`, {}, { headers });
      const req = withdrawals.find((w) => w.id === id);
      setApprovedTransfer({
        id,
        amount: req?.amount ?? 0,
        details: req?.details ?? null,
        username: req?.user?.username ?? `#${req?.userId ?? '?'}`,
        email: req?.user?.email ?? '',
      });
      setPendingWithdrawalsCount((c) => Math.max(0, c - 1));
      await fetchWithdrawals();
    } catch (e: any) {
      setError(e?.response?.data?.message || 'Ошибка одобрения');
    } finally {
      setLoading(false);
    }
  };

  const handleReject = async (id: number) => {
    setLoading(true);
    setError('');
    setActionSuccessMsg('');
    try {
      await axios.post(`/admin/withdrawal-requests/${id}/reject`, {}, { headers });
      setActionSuccessMsg(`Заявка #${id} отклонена. Решение сохранено.`);
      setTimeout(() => setActionSuccessMsg(''), 8000);
      setPendingWithdrawalsCount((c) => Math.max(0, c - 1));
      await fetchWithdrawals();
    } catch (e: any) {
      setError(e?.response?.data?.message || 'Ошибка отклонения');
    } finally {
      setLoading(false);
    }
  };

  const handleSetAdmin = async (userId: number, value: boolean) => {
    const user = users.find((u) => u.id === userId);
    const name = user ? `${user.username} (ID ${user.id})` : `ID ${userId}`;
    const msg = value
      ? `Вы уверены, что хотите сделать ${name} администратором?`
      : `Вы уверены, что хотите снять права администратора у ${name}?`;
    if (!window.confirm(msg)) return;
    setError('');
    try {
      await axios.post(`/admin/users/${userId}/set-admin`, { isAdmin: value }, { headers });
      setUsers((prev) => prev.map((u) => u.id === userId ? { ...u, isAdmin: value } : u));
    } catch (e: any) {
      setError(e?.response?.data?.message || 'Ошибка');
    }
  };

  const handleImpersonate = async (userId: number) => {
    setError('');
    try {
      const res = await axios.post<{ access_token: string }>('/admin/impersonate', { userId }, { headers });
      const newToken = res.data?.access_token;
      if (newToken) {
        localStorage.setItem('adminToken', token);
        localStorage.setItem('token', newToken);
        window.dispatchEvent(new CustomEvent('token-refresh', { detail: newToken }));
        navigate('/profile');
        window.location.reload();
      }
    } catch (e: any) {
      setError(e?.response?.data?.message || 'Не удалось войти под пользователем');
    }
  };

  if (isAdmin === null) return <div className="admin-loading" />;
  if (isAdmin === false) {
    return (
      <div className="admin-forbidden">
        <p>Доступ запрещён. Требуются права администратора.</p>
        <Link to="/profile">Вернуться в кабинет</Link>
      </div>
    );
  }

  return (
    <div className="admin-panel">
      <header ref={adminHeaderRef} className="admin-panel-header cabinet-header">
        <div className="cabinet-header-left">
          <span className="admin-header-title">Админ-панель</span>
        </div>
        <div className="cabinet-header-center">
          <div className="admin-menu-wrap">
            <button type="button" className="admin-menu-trigger" onClick={() => setMenuOpen((v) => !v)}>
              <svg width="14" height="14" viewBox="0 0 18 18" fill="none">
                <rect x="1" y="1" width="7" height="7" rx="1.5" fill="currentColor" />
                <rect x="10" y="1" width="7" height="7" rx="1.5" fill="currentColor" />
                <rect x="1" y="10" width="7" height="7" rx="1.5" fill="currentColor" />
                <rect x="10" y="10" width="7" height="7" rx="1.5" fill="currentColor" />
              </svg>
              <span className="admin-menu-label">Меню</span>
              <svg className={`admin-menu-chevron ${menuOpen ? 'open' : ''}`} width="10" height="6" viewBox="0 0 10 6" fill="none"><path d="M1 1l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
              {(pendingWithdrawalsCount > 0 || supportUnreadCount > 0) && (
                <span className="admin-menu-dot" />
              )}
            </button>
            {menuOpen && (
              <>
                <div className="admin-menu-backdrop" onClick={() => setMenuOpen(false)} />
                <div className="admin-menu-dropdown">
                  <button type="button" className={section === 'statistics' ? 'active' : ''} onClick={() => { setSectionAndUrl('statistics'); setMenuOpen(false); }}>
                    Статистика
                  </button>
                  <button type="button" className={section === 'users' ? 'active' : ''} onClick={() => { setSectionAndUrl('users'); setMenuOpen(false); }}>
                    Пользователи
                  </button>
                  <button type="button" className={section === 'withdrawals' ? 'active' : ''} onClick={() => { setSectionAndUrl('withdrawals'); setMenuOpen(false); }}>
                    Заявки на вывод
                    {pendingWithdrawalsCount > 0 && (
                      <span className="admin-tab-badge">{pendingWithdrawalsCount}</span>
                    )}
                  </button>
                  <button type="button" className={section === 'credit' ? 'active' : ''} onClick={() => { setSectionAndUrl('credit'); setMenuOpen(false); }}>
                    Начисление
                  </button>
                  <button type="button" className={section === 'support' ? 'active' : ''} onClick={() => { setSectionAndUrl('support'); setMenuOpen(false); }}>
                    Тех. поддержка
                    {supportUnreadCount > 0 && (
                      <span className="admin-tab-badge">{supportUnreadCount}</span>
                    )}
                  </button>
                  <button type="button" className={section === 'news' ? 'active' : ''} onClick={() => { setSectionAndUrl('news'); setMenuOpen(false); }}>
                    Новости
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
        <div className="cabinet-header-right">
          <Link to="/profile" className="admin-header-cabinet-link">Вернуться в кабинет</Link>
        </div>
      </header>
      <div className="admin-work-area">
      {error && <p className="admin-error">{error}</p>}
      {actionSuccessMsg && <p className="admin-success admin-action-saved">{actionSuccessMsg}</p>}
      {section === 'withdrawals' && approvedTransfer && (
        <div className="admin-transfer-card">
          <h3>Переведите средства игроку</h3>
          <div className="admin-transfer-card-details">
            <div className="admin-transfer-card-row">
              <span className="admin-transfer-card-label">Заявка</span>
              <span className="admin-transfer-card-value">#{approvedTransfer.id}</span>
            </div>
            <div className="admin-transfer-card-row">
              <span className="admin-transfer-card-label">Игрок</span>
              <span className="admin-transfer-card-value">{approvedTransfer.username}{approvedTransfer.email ? ` (${approvedTransfer.email})` : ''}</span>
            </div>
            <div className="admin-transfer-card-row">
              <span className="admin-transfer-card-label">Сумма</span>
              <span className="admin-transfer-card-value admin-transfer-card-amount">{approvedTransfer.amount} ₽</span>
            </div>
            <div className="admin-transfer-card-row">
              <span className="admin-transfer-card-label">Реквизиты</span>
              <span className="admin-transfer-card-value">{approvedTransfer.details || '—'}</span>
            </div>
          </div>
          <button
            type="button"
            className="admin-transfer-card-btn"
            onClick={() => {
              setApprovedTransfer(null);
              setWithdrawalStatusFilter('pending');
              setSearchParams((prev) => {
                const nextParams = new URLSearchParams(prev);
                nextParams.set('status', 'pending');
                return nextParams;
              }, { replace: true });
            }}
          >
            Перевод исполнен
          </button>
        </div>
      )}
      {section === 'withdrawals' && !approvedTransfer && (
        <section className="admin-section admin-section-withdrawals">
          <label>
            Статус:{' '}
            <select
              value={withdrawalStatusFilter}
              onChange={(e) => {
                const v = e.target.value;
                setWithdrawalStatusFilter(v);
                setSearchParams((prev) => {
                  const nextParams = new URLSearchParams(prev);
                  // Всегда пишем статус в URL (в т.ч. '' для «Все»), чтобы при обновлении страницы выбор сохранялся
                  nextParams.set('status', v);
                  return nextParams;
                }, { replace: true });
              }}
            >
              <option value="">Все</option>
              <option value="pending">Ожидают</option>
              <option value="approved">Одобрены</option>
              <option value="rejected">Отклонены</option>
            </select>
          </label>
          <div className="admin-table-wrap admin-table-wrap--withdrawals">
          <table className="admin-table admin-table--withdrawals">
            <thead>
              <tr>
                <SortableTh sortKey="id">ID</SortableTh>
                <SortableTh sortKey="user">Пользователь</SortableTh>
                <SortableTh sortKey="amount">Сумма</SortableTh>
                <SortableTh sortKey="details">Реквизиты</SortableTh>
                <SortableTh sortKey="status">Статус</SortableTh>
                <SortableTh sortKey="admin">Админ</SortableTh>
                <SortableTh sortKey="processedAt">Обработано</SortableTh>
                <SortableTh sortKey="createdAt">Дата заявки</SortableTh>
                <th>Действия</th>
              </tr>
            </thead>
            <tbody>
              {sortedWithdrawals.map((w) => (
                <tr key={w.id}>
                  <td>{w.id}</td>
                  <td className="admin-td-left">{w.user ? `${w.user.username} (${w.user.email || '—'})` : `#${w.userId}`}</td>
                  <td>{w.amount} ₽</td>
                  <td className="admin-td-left">{w.details || '—'}</td>
                  <td>
                    <span className={`admin-withdrawal-status admin-withdrawal-status--${w.status}`}>
                      {getWithdrawalStatusLabel(w.status)}
                    </span>
                  </td>
                  <td className="admin-td-left">
                    {w.processedByAdminUsername != null || w.processedByAdminEmail != null
                      ? [w.processedByAdminUsername || '', w.processedByAdminEmail ? `(${w.processedByAdminEmail})` : ''].filter(Boolean).join(' ')
                      : '—'}
                  </td>
                  <td>{w.processedAt ? formatMoscowDateTimeFull(w.processedAt) : '—'}</td>
                  <td>{w.createdAt ? formatMoscowDateTimeFull(w.createdAt) : '—'}</td>
                  <td>
                    {w.status === 'pending' && (
                      <>
                        <button type="button" className="admin-btn-approve" onClick={() => handleApprove(w.id)} disabled={loading}>Одобрить</button>
                        <button type="button" className="admin-btn-reject" onClick={() => handleReject(w.id)} disabled={loading}>Отклонить</button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
          {withdrawals.length === 0 && <p>Заявок нет</p>}
        </section>
      )}
      {section === 'users' && (
        <section className="admin-section admin-section-users">
          <label>
            Поиск: <input type="text" value={userSearch} onChange={(e) => setUserSearch(e.target.value)} placeholder="ID, логин или email" />
          </label>
          {usersLoading && <p className="admin-loading">Загрузка списка…</p>}
          {!usersLoading && (
            <>
              <div className="admin-table-wrap">
              <table className="admin-table">
                <thead>
                  <tr>
                    <UserSortableTh sortKey="id">ID</UserSortableTh>
                    <UserSortableTh sortKey="username">Логин</UserSortableTh>
                    <UserSortableTh sortKey="email">Email</UserSortableTh>
                    <UserSortableTh sortKey="balance">Баланс L</UserSortableTh>
                    <UserSortableTh sortKey="balanceRubles">Баланс ₽</UserSortableTh>
                    <th>Действия</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedUsers.map((u) => (
                    <tr key={u.id}>
                      <td>{u.id}</td>
                      <td className="admin-td-left">{u.username}{u.isAdmin ? ' (админ)' : ''}</td>
                      <td className="admin-td-left">{u.email}</td>
                      <td>{u.balance}</td>
                      <td>{u.balanceRubles} ₽</td>
                      <td className="admin-table-actions">
                        <div className="admin-table-actions-inner">
                          <button type="button" onClick={() => handleImpersonate(u.id)}>Войти как пользователь</button>
                          {u.id !== 1 && !u.isAdmin && (
                            <button type="button" className="admin-btn-make-admin" onClick={() => handleSetAdmin(u.id, true)}>Сделать админом</button>
                          )}
                          {u.id !== 1 && u.isAdmin && (
                            <button type="button" className="admin-btn-remove-admin" onClick={() => handleSetAdmin(u.id, false)}>Снять админа</button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
              {users.length === 0 && !error && <p>Пользователей не найдено</p>}
            </>
          )}
        </section>
      )}
      {section === 'credit' && (
        <section className="admin-section admin-section-credit">
          <div className="admin-credit-form">
            <h3>Начисление</h3>
            {creditError && <p className="admin-error">{creditError}</p>}
            {creditSuccess && <p className="admin-success">{creditSuccess}</p>}
            <div className="admin-credit-fields">
              <label>
                ID игрока
                <input
                  type="number"
                  min="1"
                  placeholder="Например: 5"
                  value={creditUserId}
                  onChange={(e) => setCreditUserId(e.target.value)}
                />
              </label>
              <label>
                Сумма (₽)
                <input
                  type="number"
                  min="0.01"
                  step="0.01"
                  placeholder="100"
                  value={creditAmount}
                  onChange={(e) => setCreditAmount(e.target.value)}
                />
              </label>
              <button
                type="button"
                className="admin-credit-submit"
                disabled={creditLoading}
                onClick={handleCreditBalance}
              >
                {creditLoading ? 'Начисляю...' : 'Начислить'}
              </button>
            </div>
          </div>

          <h3 style={{ marginTop: 32 }}>История начислений</h3>
          {!creditHistoryLoaded ? (
            <p>Загрузка...</p>
          ) : creditHistory.length === 0 ? (
            <p>Начислений пока нет</p>
          ) : (
            <div className="admin-table-wrap">
              <table className="admin-table admin-table--credit">
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>Игрок (ID)</th>
                    <th>Игрок</th>
                    <th>Сумма (₽)</th>
                    <th>Админ</th>
                    <th>Дата</th>
                  </tr>
                </thead>
                <tbody>
                  {creditHistory.map((ch) => (
                    <tr key={ch.id}>
                      <td>{ch.id}</td>
                      <td>{ch.userId}</td>
                      <td className="admin-credit-cell-name admin-td-left">
                        <span>{ch.username || '—'}</span>
                        {ch.userEmail && <span className="admin-credit-cell-email">{ch.userEmail}</span>}
                      </td>
                      <td>+{Number(ch.amount).toFixed(2)} ₽</td>
                      <td className="admin-credit-cell-name admin-td-left">
                        <span>{ch.adminUsername || '—'}</span>
                        {ch.adminEmail && <span className="admin-credit-cell-email">{ch.adminEmail}</span>}
                      </td>
                      <td>{ch.createdAt ? formatMoscowDateTimeFull(ch.createdAt) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
      {section === 'support' && (
        <section className="admin-section">
          {supportOpenTicketId ? (() => {
            const ticket = supportTickets.find((t: any) => t.id === supportOpenTicketId);
            return (
            <div className="admin-support-dialog">
              <div className="admin-support-dialog-header">
                <button type="button" className="admin-support-back" onClick={() => { setSupportOpenTicketId(null); fetchSupportTickets(); }}>
                  ← К тикетам
                </button>
                <span className="admin-support-dialog-title">Тикет #{supportOpenTicketId} — {ticket?.nickname || ticket?.username || 'Игрок'}</span>
                <span className={`admin-support-ticket-status admin-support-ticket-status--${ticket?.status || 'open'}`}>
                  {ticket?.status === 'closed' ? 'Закрыт' : 'Открыт'}
                </span>
                {ticket?.status === 'open' ? (
                  <button type="button" className="admin-support-close-btn" onClick={closeSupportTicket}>Закрыть тикет</button>
                ) : (
                  <button type="button" className="admin-support-reopen-btn" onClick={reopenSupportTicket}>Переоткрыть</button>
                )}
              </div>
              <div className="admin-support-messages">
                {supportMessages.length === 0 && <div className="admin-support-empty">Нет сообщений</div>}
                {(() => { let lastD = ''; return supportMessages.map((m: any) => {
                  const d = m.createdAt ? new Date(m.createdAt) : null;
                  const dk = d ? `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}` : '';
                  const showDate = dk !== lastD;
                  if (showDate) lastD = dk;
                  return (
                    <React.Fragment key={m.id}>
                      {showDate && d && <div className="admin-support-date-sep">{d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })}</div>}
                      <div className={`admin-support-msg ${m.senderRole === 'user' ? 'admin-support-msg--user' : 'admin-support-msg--admin'}`}>
                        <div className="admin-support-msg-col">
                          <div className="admin-support-msg-sender">{m.senderRole === 'user' ? (ticket?.nickname || ticket?.username || 'Игрок') : 'Поддержка'}</div>
                          <div className="admin-support-msg-bubble">
                            <div className="admin-support-msg-body">
                              <div className="admin-support-msg-text">{m.text}</div>
                              <span className="admin-support-msg-time">{d ? d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) : ''}</span>
                            </div>
                          </div>
                        </div>
                      </div>
                    </React.Fragment>
                  );
                }); })()}
              </div>
              <div className="admin-support-reply-wrap">
                <textarea
                  className="admin-support-reply-input"
                  placeholder="Ответить..."
                  value={supportReply}
                  onChange={(e) => setSupportReply(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendSupportReply(); } }}
                  rows={2}
                />
                <button type="button" className="admin-support-reply-btn" disabled={!supportReply.trim() || supportSending} onClick={sendSupportReply}>
                  Отправить
                </button>
              </div>
            </div>
            );
          })() : (
            <div>
              <div className="admin-support-filter-row">
                <h3>Обращения</h3>
                <select className="admin-support-filter-select" value={supportStatusFilter} onChange={(e) => setSupportStatusFilter(e.target.value)}>
                  <option value="">Все</option>
                  <option value="open">Открытые</option>
                  <option value="closed">Закрытые</option>
                </select>
              </div>
              {supportTickets.length === 0 ? (
                <p>Обращений пока нет</p>
              ) : (
                <div className="admin-table-wrap">
                  <table className="admin-table">
                    <thead>
                      <tr>
                        <th>#</th>
                        <th>Игрок</th>
                        <th>Email</th>
                        <th>Статус</th>
                        <th>Последнее сообщение</th>
                        <th>Дата</th>
                        <th>Непрочитано</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {supportTickets.map((t: any) => (
                        <tr key={t.id} className={Number(t.unreadCount) > 0 ? 'admin-support-row-unread' : ''}>
                          <td>{t.id}</td>
                          <td className="admin-td-left">{t.nickname || t.username || '—'}</td>
                          <td className="admin-td-left">{t.email || '—'}</td>
                          <td>
                            <span className={`admin-support-ticket-status admin-support-ticket-status--${t.status}`}>
                              {t.status === 'open' ? 'Открыт' : 'Закрыт'}
                            </span>
                          </td>
                          <td className="admin-support-last-text">{t.lastText?.slice(0, 60)}{t.lastText?.length > 60 ? '…' : ''}</td>
                          <td>{t.lastMessageAt ? new Date(t.lastMessageAt).toLocaleString('ru-RU') : '—'}</td>
                          <td>{Number(t.unreadCount) > 0 ? <span className="admin-tab-badge">{t.unreadCount}</span> : '—'}</td>
                          <td><button type="button" className="admin-support-open-btn" onClick={() => openSupportTicket(t.id)}>Открыть</button></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </section>
      )}
      {section === 'statistics' && (
        <section className="admin-section">
          <div className="admin-stats-subtabs">
            <button type="button" className={`admin-stats-subtab${statsSubTab === 'overview' ? ' active' : ''}`} onClick={() => { setStatsSubTab('overview'); setSearchParams((p) => { const n = new URLSearchParams(p); n.set('statsTab', 'overview'); return n; }, { replace: true }); }}>Обзор</button>
            <button type="button" className={`admin-stats-subtab${statsSubTab === 'transactions' ? ' active' : ''}`} onClick={() => { setStatsSubTab('transactions'); setSearchParams((p) => { const n = new URLSearchParams(p); n.set('statsTab', 'transactions'); return n; }, { replace: true }); }}>Транзакции</button>
            <button type="button" className={`admin-stats-subtab${statsSubTab === 'questions' ? ' active' : ''}`} onClick={() => { setStatsSubTab('questions'); setSearchParams((p) => { const n = new URLSearchParams(p); n.set('statsTab', 'questions'); return n; }, { replace: true }); }}>Вопросы</button>
            <button type="button" className={`admin-stats-subtab${statsSubTab === 'tournaments' ? ' active' : ''}`} onClick={() => { setStatsSubTab('tournaments'); setSearchParams((p) => { const n = new URLSearchParams(p); n.set('statsTab', 'tournaments'); return n; }, { replace: true }); }}>Турниры</button>
            <button type="button" className={`admin-stats-subtab${statsSubTab === 'project-cost' ? ' active' : ''}`} onClick={() => { setStatsSubTab('project-cost'); setSearchParams((p) => { const n = new URLSearchParams(p); n.set('statsTab', 'project-cost'); return n; }, { replace: true }); }}>Стоимость проекта</button>
          </div>
          {statsSubTab === 'overview' && (() => {
            const totals = statsData.reduce((acc, d) => ({
              registrations: acc.registrations + d.registrations,
              withdrawals: acc.withdrawals + d.withdrawals,
              topups: acc.topups + d.topups,
              gameIncome: acc.gameIncome + d.gameIncome,
            }), { registrations: 0, withdrawals: 0, topups: 0, gameIncome: 0 });
            const fmt = (n: number) => n.toLocaleString('ru-RU');
            return (
            <div className="admin-stats-section">
              <div className="admin-stats-controls">
                <label>
                  Период:
                  <select
                    value={statsGroupBy}
                    onChange={(e) => {
                      const v = e.target.value as 'day' | 'week' | 'month' | 'all';
                      setStatsGroupBy(v);
                      setSearchParams((prev) => {
                        const p = new URLSearchParams(prev);
                        p.set('statsGroupBy', v);
                        return p;
                      }, { replace: true });
                    }}
                  >
                    <option value="day">По дням</option>
                    <option value="week">По неделям</option>
                    <option value="month">По месяцам</option>
                    <option value="all">За всё время</option>
                  </select>
                </label>
              </div>
              {(() => {
                const metrics: { key: string; label: string; color: string; yAxisId: string }[] = [
                  { key: 'registrations', label: 'Регистрации', color: '#8884d8', yAxisId: 'left' },
                  { key: 'topups', label: 'Пополнения (₽)', color: '#82ca9d', yAxisId: 'right' },
                  { key: 'withdrawals', label: 'Выводы (₽)', color: '#ff7c7c', yAxisId: 'right' },
                  { key: 'gameIncome', label: 'Доход игры (₽)', color: '#ffc658', yAxisId: 'right' },
                ];
                const toggleMetric = (key: string) => {
                  setStatsMetrics((prev) => {
                    const next = new Set(prev);
                    if (next.has(key)) next.delete(key);
                    else next.add(key);
                    return next;
                  });
                };
                const active = metrics.filter((m) => statsMetrics.has(m.key));
                const needLeftAxis = active.some((m) => m.yAxisId === 'left');
                const needRightAxis = active.some((m) => m.yAxisId === 'right');
                return (
                  <>
                    <div className="admin-stats-kpi">
                      <div className="admin-stats-kpi-card" style={{ borderColor: '#8884d8' }}>
                        <div className="admin-stats-kpi-value">{fmt(totals.registrations)}</div>
                        <div className="admin-stats-kpi-label">Регистрации</div>
                      </div>
                      <div className="admin-stats-kpi-card" style={{ borderColor: '#82ca9d' }}>
                        <div className="admin-stats-kpi-value">{fmt(totals.topups)} ₽</div>
                        <div className="admin-stats-kpi-label">Пополнения</div>
                      </div>
                      <div className="admin-stats-kpi-card" style={{ borderColor: '#ff7c7c' }}>
                        <div className="admin-stats-kpi-value">{fmt(totals.withdrawals)} ₽</div>
                        <div className="admin-stats-kpi-label">Выводы</div>
                      </div>
                      <div className="admin-stats-kpi-card" style={{ borderColor: '#ffc658' }}>
                        <div className="admin-stats-kpi-value">{fmt(totals.gameIncome)} ₽</div>
                        <div className="admin-stats-kpi-label">Доход игры</div>
                      </div>
                    </div>
                    <div className="admin-stats-metrics-toggle">
                      {metrics.map((m) => (
                        <button
                          key={m.key}
                          type="button"
                          className={`admin-stats-metric-btn ${statsMetrics.has(m.key) ? 'active' : ''}`}
                          style={{ '--metric-color': m.color } as React.CSSProperties}
                          onClick={() => toggleMetric(m.key)}
                        >
                          <span className="admin-stats-metric-dot" />
                          {m.label}
                        </button>
                      ))}
                      <button
                        type="button"
                        className="admin-stats-metric-reset"
                        onClick={() => setStatsMetrics((prev) => prev.size === metrics.length ? new Set() : new Set(metrics.map((m) => m.key)))}
                      >
                        {statsMetrics.size === metrics.length ? 'Сбросить все' : 'Выбрать все'}
                      </button>
                    </div>
                    {statsData.length === 0 ? (
                      <p className="admin-stats-empty">Нет данных за выбранный период</p>
                    ) : active.length === 0 ? (
                      <p className="admin-stats-empty">Выберите хотя бы одну метрику</p>
                    ) : (
                      <>
                        <div className="admin-stats-chart">
                          <ResponsiveContainer width="100%" height={400}>
                            <LineChart data={statsData} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
                              <CartesianGrid strokeDasharray="3 3" />
                              <XAxis dataKey="period" />
                              {needLeftAxis && <YAxis yAxisId="left" />}
                              {needRightAxis && <YAxis yAxisId="right" orientation="right" />}
                              {!needLeftAxis && !needRightAxis && <YAxis yAxisId="left" />}
                              <Tooltip formatter={(value: number, name: string) => [typeof value === 'number' ? value.toLocaleString('ru-RU') : value, name]} />
                              <Legend />
                              {active.map((m) => (
                                <Line
                                  key={m.key}
                                  yAxisId={m.yAxisId}
                                  type="monotone"
                                  dataKey={m.key}
                                  name={m.label}
                                  stroke={m.color}
                                  strokeWidth={2}
                                  dot={{ r: 4 }}
                                  activeDot={{ r: 6 }}
                                />
                              ))}
                            </LineChart>
                          </ResponsiveContainer>
                        </div>
                        <div className="admin-table-wrap">
                          <table className="admin-table">
                            <thead>
                              <tr>
                                <th>Период</th>
                                <th>Регистрации</th>
                                <th>Пополнения (₽)</th>
                                <th>Выводы (₽)</th>
                                <th>Доход игры (₽)</th>
                              </tr>
                            </thead>
                            <tbody>
                              <tr className="admin-stats-totals-row">
                                <td><strong>Итого</strong></td>
                                <td><strong>{fmt(totals.registrations)}</strong></td>
                                <td><strong>{fmt(totals.topups)} ₽</strong></td>
                                <td><strong>{fmt(totals.withdrawals)} ₽</strong></td>
                                <td><strong>{fmt(totals.gameIncome)} ₽</strong></td>
                              </tr>
                              {[...statsData].reverse().map((d) => (
                                <tr key={d.period}>
                                  <td>{d.period}</td>
                                  <td>{fmt(d.registrations)}</td>
                                  <td>{fmt(d.topups)}</td>
                                  <td>{fmt(d.withdrawals)}</td>
                                  <td>{fmt(d.gameIncome)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </>
                    )}
                  </>
                );
              })()}
            </div>
            );
          })()}
          {statsSubTab === 'transactions' && (
            <div className="admin-stats-section">
              <div className="admin-stats-controls">
                <label>
                  Тип:
                  <select value={txCategoryFilter} onChange={(e) => { setTxCategoryFilter(e.target.value as '' | 'topup' | 'withdraw' | 'win' | 'other'); txLoadedRef.current = false; }}>
                    <option value="">Все</option>
                    <option value="topup">Пополнение</option>
                    <option value="withdraw">Вывод</option>
                    <option value="win">Выигрыш</option>
                    <option value="other">Прочее</option>
                  </select>
                </label>
              </div>
              {txLoading && !txLoadedRef.current ? (
                <p>Загрузка...</p>
              ) : txList.length === 0 ? (
                <p className="admin-stats-empty">Транзакций не найдено</p>
              ) : (
                <div className="admin-table-wrap">
                  <table className="admin-table admin-table--transactions">
                    <thead>
                      <tr>
                        <TxSortableTh sortKey="id">ID</TxSortableTh>
                        <TxSortableTh sortKey="userId">Игрок (ID)</TxSortableTh>
                        <TxSortableTh sortKey="username">Игрок</TxSortableTh>
                        <TxSortableTh sortKey="email">Email</TxSortableTh>
                        <TxSortableTh sortKey="category">Тип</TxSortableTh>
                        <TxSortableTh sortKey="amount">Сумма</TxSortableTh>
                        <th>Описание</th>
                        <TxSortableTh sortKey="createdAt">Дата</TxSortableTh>
                      </tr>
                    </thead>
                    <tbody>
                      {sortedTxList.map((tx) => (
                        <tr key={tx.id}>
                          <td>{tx.id}</td>
                          <td>{tx.userId}</td>
                          <td className="admin-td-left">{tx.username || '—'}</td>
                          <td className="admin-td-left">{tx.email || '—'}</td>
                          <td>
                            {(() => {
                              const isOtherTopup = tx.category === 'other' && /пополнение/i.test(tx.description);
                              const badge = isOtherTopup ? 'topup' : tx.category;
                              const label = badge === 'topup' ? 'Пополнение' : badge === 'withdraw' ? 'Вывод' : badge === 'win' ? 'Выигрыш' : badge === 'other' ? 'Прочее' : badge;
                              return <span className={`admin-tx-badge admin-tx-badge--${badge}`}>{label}</span>;
                            })()}
                          </td>
                          <td style={{ color: tx.amount >= 0 ? '#1a7f37' : '#cf222e', fontWeight: 600 }}>
                            {tx.amount >= 0 ? '+' : ''}{Number(tx.amount).toFixed(2)} ₽
                          </td>
                          <td className="admin-td-left">{tx.description || '—'}</td>
                          <td>{tx.createdAt ? formatMoscowDateTimeFull(tx.createdAt) : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
          {statsSubTab === 'tournaments' && (
            <div className="admin-stats-section">
              <div className="admin-stats-controls admin-stats-controls--tournaments" style={{ marginBottom: 8 }}>
                <label>
                  Поиск по ID турнира:{' '}
                  <input
                    type="text"
                    inputMode="numeric"
                    placeholder="Введите ID турнира"
                    value={tournamentIdFilter}
                    onChange={(e) => {
                      const v = e.target.value.trim();
                      setTournamentIdFilter(v);
                      setSearchParams((p) => {
                        const n = new URLSearchParams(p);
                        if (v) n.set('tournamentId', v); else n.delete('tournamentId');
                        return n;
                      }, { replace: true });
                    }}
                    style={{ width: 160 }}
                  />
                </label>
              </div>
              {tournamentsListLoading && !tournamentsListLoadedRef.current ? (
                <p>Загрузка...</p>
              ) : tournamentsListError ? (
                <p className="admin-error">{tournamentsListError}</p>
              ) : (() => {
                const filtered = tournamentIdFilter
                  ? tournamentsList.filter((r) => String(r.tournamentId) === tournamentIdFilter)
                  : tournamentsList;
                if (filtered.length === 0) {
                  return <p className="admin-stats-empty">{tournamentIdFilter ? 'Нет записей по этому ID турнира' : 'Нет данных о турнирах'}</p>;
                }
                return (
                  <div className="admin-table-wrap admin-table-wrap--tournaments">
                      <table className="admin-table admin-table--tournaments">
                        <thead>
                          <tr>
                            {tournamentColumns.map((column) => (
                              <th
                                key={column}
                                className={[
                                  dragOverTournamentColumn === column ? 'admin-tournament-th-drop-target' : '',
                                  column === 'tournamentId' ? 'admin-tournament-col-id' : '',
                                ].filter(Boolean).join(' ') || undefined}
                                onDragOver={(e) => {
                                  if (!draggedTournamentColumn || draggedTournamentColumn === column) return;
                                  e.preventDefault();
                                  e.dataTransfer.dropEffect = 'move';
                                  if (dragOverTournamentColumn !== column) {
                                    setDragOverTournamentColumn(column);
                                  }
                                }}
                                onDragLeave={() => {
                                  if (dragOverTournamentColumn === column) {
                                    setDragOverTournamentColumn(null);
                                  }
                                }}
                                onDrop={(e) => {
                                  e.preventDefault();
                                  if (!draggedTournamentColumn || draggedTournamentColumn === column) return;
                                  reorderTournamentColumns(draggedTournamentColumn, column);
                                  setDraggedTournamentColumn(null);
                                  setDragOverTournamentColumn(null);
                                }}
                              >
                                <div className="admin-tournament-th-inner">
                                  <button
                                    type="button"
                                    className="admin-tournament-th-drag"
                                    draggable
                                    onDragStart={(e) => {
                                      setDraggedTournamentColumn(column);
                                      setDragOverTournamentColumn(column);
                                      e.dataTransfer.effectAllowed = 'move';
                                      e.dataTransfer.setData('text/plain', column);
                                    }}
                                    onDragEnd={() => {
                                      setDraggedTournamentColumn(null);
                                      setDragOverTournamentColumn(null);
                                    }}
                                    aria-label={`Перетащить столбец «${TOURNAMENT_COLUMN_LABELS[column]}»`}
                                    title="Зажмите название и перетащите столбец"
                                  >
                                    {TOURNAMENT_COLUMN_LABELS[column]}
                                  </button>
                                </div>
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {filtered.map((row, idx) => (
                            <tr key={`${row.tournamentId}-${row.userId}-${idx}`}>
                              {tournamentColumns.map((column) => (
                                <React.Fragment key={column}>
                                  {renderTournamentCell(row, column)}
                                </React.Fragment>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                  </div>
                );
              })()}
            </div>
          )}
          {statsSubTab === 'project-cost' && (
            <div className="admin-stats-section">
              {projectCostLoading && !projectCostLoadedRef.current ? (
                <p>Загрузка...</p>
              ) : (() => {
                const dashboard = projectCostData ?? { currentTotal: 0, todayTotal: 0, updatedAt: null, history: [] };
                const latestChange = dashboard.history[0]?.amountChange ?? 0;
                return (
                  <>
                    <div className="admin-cost-hero">
                      <div className="admin-cost-hero-label">Стоимость проекта</div>
                      <div className="admin-cost-hero-value">{formatRubles(dashboard.currentTotal)}</div>
                    </div>

                    <div className="admin-stats-kpi admin-cost-kpi">
                      <div className="admin-stats-kpi-card admin-cost-kpi-card" style={{ borderColor: '#0f766e' }}>
                        <div className="admin-stats-kpi-value">{formatRubles(dashboard.todayTotal)}</div>
                        <div className="admin-stats-kpi-label">За сегодня</div>
                      </div>
                      <div className="admin-stats-kpi-card admin-cost-kpi-card" style={{ borderColor: '#1d4ed8' }}>
                        <div className="admin-stats-kpi-value">+{formatRubles(latestChange).replace(' ₽', '')} ₽</div>
                        <div className="admin-stats-kpi-label">Последнее изменение</div>
                      </div>
                      <div className="admin-stats-kpi-card admin-cost-kpi-card" style={{ borderColor: '#7c3aed' }}>
                        <div className="admin-stats-kpi-value">{dashboard.history.length.toLocaleString('ru-RU')}</div>
                        <div className="admin-stats-kpi-label">Записей в истории</div>
                      </div>
                    </div>

                    <div className="admin-cost-updated-inline">
                      Обновлено автоматически: {dashboard.updatedAt ? formatMoscowDateTimeFull(dashboard.updatedAt) : '—'}
                    </div>

                    {dashboard.history.length === 0 ? (
                      <p className="admin-stats-empty">История стоимости пока пуста</p>
                    ) : (
                      <div className="admin-table-wrap">
                        <table className="admin-table admin-table--project-cost">
                          <thead>
                            <tr>
                              <th>Дата</th>
                              <th>Время</th>
                              <th>Изменение</th>
                              <th>Стало после изменения</th>
                              <th>Время выполнения</th>
                              <th>Описание задачи</th>
                            </tr>
                          </thead>
                          <tbody>
                            {dashboard.history.map((row, idx) => (
                              <tr key={`${row.date}-${row.time ?? 'na'}-${idx}`}>
                                <td>{row.date}</td>
                                <td>{row.time ?? '—'}</td>
                                <td className="admin-cost-change">+{formatRubles(row.amountChange)}</td>
                                <td className="admin-cost-after">{formatRubles(row.afterAmount)}</td>
                                <td>{row.duration}</td>
                                <td className="admin-td-left admin-cost-description">{row.description}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </>
                );
              })()}
            </div>
          )}
          {statsSubTab === 'questions' && (
            <div className="admin-stats-section">
              {questionStatsLoading && !questionStatsLoadedRef.current ? (
                <p>Загрузка...</p>
              ) : questionStats.length === 0 ? (
                <p className="admin-stats-empty">Нет данных о вопросах</p>
              ) : (() => {
                const totalQuestions = questionStats.reduce((s, r) => s + r.count, 0);
                const toggleSort = (col: 'topic' | 'count') => {
                  if (qsSortBy === col) setQsSortDir((d) => d === 'asc' ? 'desc' : 'asc');
                  else { setQsSortBy(col); setQsSortDir(col === 'count' ? 'desc' : 'asc'); }
                };
                const arrow = (col: 'topic' | 'count') => qsSortBy === col ? (qsSortDir === 'asc' ? ' ▲' : ' ▼') : '';
                return (
                  <>
                    <div className="admin-stats-kpi" style={{ marginBottom: 16 }}>
                      <div className="admin-stats-kpi-card" style={{ borderColor: '#8884d8' }}>
                        <div className="admin-stats-kpi-value">{totalQuestions.toLocaleString('ru-RU')}</div>
                        <div className="admin-stats-kpi-label">Всего вопросов</div>
                      </div>
                      <div className="admin-stats-kpi-card" style={{ borderColor: '#82ca9d' }}>
                        <div className="admin-stats-kpi-value">{questionStats.length}</div>
                        <div className="admin-stats-kpi-label">Категорий</div>
                      </div>
                    </div>
                    <div className="admin-table-wrap">
                      <table className="admin-table">
                        <thead>
                          <tr>
                            <th style={{ width: 50, textAlign: 'center' }}>№</th>
                            <th style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => toggleSort('topic')}>
                              Категория{arrow('topic')}
                            </th>
                            <th style={{ cursor: 'pointer', userSelect: 'none', textAlign: 'center' }} onClick={() => toggleSort('count')}>
                              Вопросов{arrow('count')}
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {sortedQuestionStats.map((row, i) => (
                            <tr key={row.topic}>
                              <td style={{ textAlign: 'center' }}>{i + 1}</td>
                              <td className="admin-td-left">{topicNames[row.topic] || row.topic}</td>
                              <td style={{ textAlign: 'center', fontWeight: 600 }}>{row.count.toLocaleString('ru-RU')}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </>
                );
              })()}
            </div>
          )}
        </section>
      )}
      {section === 'news' && (
        <section className="admin-section admin-news-section">
          <h2>Управление новостями</h2>
          <div className="admin-news-form">
            <h3>Создать новость</h3>
            {newsError && <p className="admin-error">{newsError}</p>}
            {newsSuccess && <p className="admin-success">{newsSuccess}</p>}
            <input
              type="text"
              placeholder="Заголовок"
              value={newsTopic}
              onChange={(e) => setNewsTopic(e.target.value)}
              className="admin-news-input"
            />
            <textarea
              placeholder="Текст новости (поддерживается перенос строк)"
              value={newsBody}
              onChange={(e) => setNewsBody(e.target.value)}
              className="admin-news-textarea"
              rows={6}
            />
            <div className="admin-news-form-actions">
              <button
                type="button"
                className="admin-news-generate-btn"
                disabled={newsGenerating}
                onClick={handleGenerateNews}
              >
                {newsGenerating ? (
                  <>
                    <span className="admin-news-spinner" />
                    Генерация...
                  </>
                ) : (
                  <>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/></svg>
                    Сгенерировать
                  </>
                )}
              </button>
              <button
                type="button"
                className="admin-news-publish-btn"
                disabled={newsCreating}
                onClick={() => {
                  if (!newsTopic.trim()) { setNewsError('Введите заголовок'); return; }
                  if (!newsBody.trim()) { setNewsError('Введите текст новости'); return; }
                  setNewsError('');
                  setNewsPublishConfirm(true);
                }}
              >
                {newsCreating ? 'Публикация...' : 'Опубликовать'}
              </button>
            </div>
          </div>
          <div className="admin-news-list-section">
            <h3>Все новости ({newsList.length})</h3>
            {newsLoading && newsList.length === 0 && <p>Загрузка...</p>}
            {!newsLoading && newsList.length === 0 && <p className="admin-stats-empty">Новостей пока нет</p>}
            {newsList.map((item) => (
              <div key={item.id} className={`admin-news-card ${!item.published ? 'unpublished' : ''}`}>
                {newsEditId === item.id ? (
                  <div className="admin-news-edit">
                    <input
                      type="text"
                      value={newsEditTopic}
                      onChange={(e) => setNewsEditTopic(e.target.value)}
                      className="admin-news-input"
                    />
                    <textarea
                      value={newsEditBody}
                      onChange={(e) => setNewsEditBody(e.target.value)}
                      className="admin-news-textarea"
                      rows={5}
                    />
                    <div className="admin-news-edit-actions">
                      <button type="button" onClick={() => handleSaveEdit(item.id)} className="admin-news-save-btn">Сохранить</button>
                      <button type="button" onClick={() => setNewsEditId(null)} className="admin-news-cancel-btn">Отмена</button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="admin-news-card-header">
                      <strong>{item.topic}</strong>
                      <span className="admin-news-card-date">
                        {new Date(item.createdAt).toLocaleDateString('ru-RU')}
                      </span>
                      {!item.published && <span className="admin-news-draft-badge">Скрыта</span>}
                    </div>
                    <p className="admin-news-card-body">{item.body}</p>
                    <div className="admin-news-card-actions">
                      <button type="button" onClick={() => { setNewsEditId(item.id); setNewsEditTopic(item.topic); setNewsEditBody(item.body); }}>Редактировать</button>
                      <button type="button" onClick={() => handleTogglePublish(item.id, item.published)}>
                        {item.published ? 'Скрыть' : 'Опубликовать'}
                      </button>
                      <button type="button" className="admin-news-delete-btn" onClick={() => setNewsDeleteConfirmId(item.id)}>Удалить</button>
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>
        </section>
      )}
      {newsPublishConfirm && (
        <div className="admin-modal-overlay" onClick={() => setNewsPublishConfirm(false)}>
          <div className="admin-modal" onClick={(e) => e.stopPropagation()}>
            <p className="admin-modal-text">Опубликовать новость?</p>
            <div className="admin-modal-actions">
              <button type="button" className="admin-modal-cancel" onClick={() => setNewsPublishConfirm(false)}>Отмена</button>
              <button type="button" className="admin-modal-confirm admin-modal-confirm--publish" onClick={() => { setNewsPublishConfirm(false); handleCreateNews(); }}>Опубликовать</button>
            </div>
          </div>
        </div>
      )}
      {newsDeleteConfirmId !== null && (
        <div className="admin-modal-overlay" onClick={() => setNewsDeleteConfirmId(null)}>
          <div className="admin-modal" onClick={(e) => e.stopPropagation()}>
            <p className="admin-modal-text">Вы уверены, что хотите удалить эту новость?</p>
            <div className="admin-modal-actions">
              <button type="button" className="admin-modal-cancel" onClick={() => setNewsDeleteConfirmId(null)}>Отмена</button>
              <button type="button" className="admin-modal-confirm" onClick={() => handleDeleteNews(newsDeleteConfirmId)}>Удалить</button>
            </div>
          </div>
        </div>
      )}
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
              <h3>
                {bracketView?.gameType === 'money' ? 'Противостояние' : 'Турнир'} #{bracketView?.tournamentId ?? '...'}
                {bracketOpenSource === 'completed' ? <span className="bracket-completed-badge">Завершен</span> : bracketOpenSource === 'active' ? <span className="bracket-active-badge">Активен</span> : null}
              </h3>
              <button type="button" className="bracket-close" onClick={closeBracket} aria-label="Закрыть">×</button>
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
                    {bracketPlayerTooltip.avatarUrl ? <img src={bracketPlayerTooltip.avatarUrl} alt="" /> : <DollarIcon />}
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
                        const opp = bracketView.semi1.players[1 - i];
                        const isReal = p != null && p.id > 0;
                        const isWinner = isReal && !p.isLoser && opp?.isLoser === true;
                        const displayName = truncateBracketName(isReal ? (p.nickname?.trim() || `Игрок ${p.id}`) : 'Ожидание соперника');
                        const answered = p?.questionsAnswered ?? 0;
                        const total = answered >= 10 ? 10 : answered;
                        const correct = p?.semiScore ?? (answered <= 10 ? (p?.correctAnswersCount ?? 0) : 0);
                        const pAvatar = isReal ? (p.avatarUrl ?? null) : null;
                        return (
                          <div key={isReal ? p.id : `s1-${i}`} className={`bracket-player-slot ${!isReal ? 'bracket-slot-empty' : ''} ${isReal && p.isLoser ? 'bracket-slot-loser' : ''}`}>
                            <span className="bracket-player-info">
                              {isReal && <span className="bracket-player-avatar">{pAvatar ? <img src={pAvatar} alt="" /> : <DollarIcon />}</span>}
                              {isWinner && <span className="bracket-winner-label">Победитель</span>}
                              {isReal ? (
                                <BracketPlayerName
                                  playerId={p.id}
                                  displayName={displayName}
                                  avatarUrl={pAvatar}
                                  token={token}
                                  isTooltipOpen={bracketPlayerTooltip?.playerId === p.id}
                                  onShowTooltip={({ playerId, displayName: dn, avatarUrl, stats, rect }) => setBracketPlayerTooltip({ playerId, displayName: dn, avatarUrl, stats, rect })}
                                  onCloseTooltip={() => setBracketPlayerTooltip(null)}
                                />
                              ) : (
                                <span className="bracket-player-name">{displayName}</span>
                              )}
                              {isReal && total > 0 && <span className="bracket-player-score">{correct}/{total} ({Math.round((correct / total) * 100)}%)</span>}
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
                        const opp = bracketView.semi2?.players[1 - i];
                        const isReal = p != null && p.id > 0;
                        const isWinner = isReal && !p.isLoser && opp?.isLoser === true;
                        const displayName = truncateBracketName(isReal ? (p.nickname?.trim() || `Игрок ${p.id}`) : 'Ожидание соперника');
                        const answered = p?.questionsAnswered ?? 0;
                        const total = answered >= 10 ? 10 : answered;
                        const correct = p?.semiScore ?? (answered <= 10 ? (p?.correctAnswersCount ?? 0) : 0);
                        const pAvatar = isReal ? (p.avatarUrl ?? null) : null;
                        return (
                          <div key={isReal ? p.id : `s2-${i}`} className={`bracket-player-slot ${!isReal ? 'bracket-slot-empty' : ''} ${isReal && p.isLoser ? 'bracket-slot-loser' : ''}`}>
                            <span className="bracket-player-info">
                              {isReal && <span className="bracket-player-avatar">{pAvatar ? <img src={pAvatar} alt="" /> : <DollarIcon />}</span>}
                              {isWinner && <span className="bracket-winner-label">Победитель</span>}
                              {isReal ? (
                                <BracketPlayerName
                                  playerId={p.id}
                                  displayName={displayName}
                                  avatarUrl={pAvatar}
                                  token={token}
                                  isTooltipOpen={bracketPlayerTooltip?.playerId === p.id}
                                  onShowTooltip={({ playerId, displayName: dn, avatarUrl, stats, rect }) => setBracketPlayerTooltip({ playerId, displayName: dn, avatarUrl, stats, rect })}
                                  onCloseTooltip={() => setBracketPlayerTooltip(null)}
                                />
                              ) : (
                                <span className="bracket-player-name">{displayName}</span>
                              )}
                              {isReal && total > 0 && <span className="bracket-player-score">{correct}/{total} ({Math.round((correct / total) * 100)}%)</span>}
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
                    {(() => {
                      const fp = bracketView.final.players;
                      const finalWinnerId = bracketView.finalWinnerId ?? null;
                      const bothFinished = finalWinnerId != null;
                      return [0, 1].map((i) => {
                        const p = fp[i];
                        const isReal = p != null && p.id > 0;
                        const isWinner = isReal && finalWinnerId === p.id;
                        const isLoser = bothFinished && isReal && finalWinnerId != null && finalWinnerId !== p.id;
                        const displayName = truncateBracketName(isReal ? (p.nickname?.trim() || `Игрок ${p.id}`) : 'Ожидание соперника');
                        const answered = p?.finalAnswered ?? 0;
                        const total = answered >= 10 ? 10 : answered;
                        const correct = p?.finalScore ?? p?.finalCorrect ?? 0;
                        const pAvatar = isReal ? (p.avatarUrl ?? null) : null;
                        return (
                          <div key={isReal ? p.id : `f-${i}`} className={`bracket-player-slot ${!isReal ? 'bracket-slot-empty' : ''} ${isLoser ? 'bracket-slot-loser' : ''}`}>
                            <span className="bracket-player-info">
                              {isReal && <span className="bracket-player-avatar">{pAvatar ? <img src={pAvatar} alt="" /> : <DollarIcon />}</span>}
                              {isWinner && <span className="bracket-winner-label">Победитель</span>}
                              {isReal ? (
                                <BracketPlayerName
                                  playerId={p.id}
                                  displayName={displayName}
                                  avatarUrl={pAvatar}
                                  token={token}
                                  isTooltipOpen={bracketPlayerTooltip?.playerId === p.id}
                                  onShowTooltip={({ playerId, displayName: dn, avatarUrl, stats, rect }) => setBracketPlayerTooltip({ playerId, displayName: dn, avatarUrl, stats, rect })}
                                  onCloseTooltip={() => setBracketPlayerTooltip(null)}
                                />
                              ) : (
                                <span className="bracket-player-name">{displayName}</span>
                              )}
                              {isReal && <span className="bracket-player-score">{correct}/{total > 0 ? total : 10} ({total > 0 ? Math.round((correct / total) * 100) : 0}%)</span>}
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
      )}
      {questionsReviewTournamentId != null && (
        <div className="questions-review-overlay" onClick={closeQuestionsReview}>
          <div className="questions-review-modal" onClick={(e) => e.stopPropagation()}>
            <div className="questions-review-header">
              <h3>Вопросы турнира #{questionsReviewTournamentId}</h3>
              <button type="button" className="questions-review-close" onClick={closeQuestionsReview} aria-label="Закрыть">×</button>
            </div>
            {questionsReviewLoading && !questionsReviewData && <p className="questions-review-loading">Загрузка…</p>}
            {questionsReviewError && !questionsReviewLoading && <p className="questions-review-error">{questionsReviewError}</p>}
            {questionsReviewData && (() => {
              const raw = questionsReviewData.answersChosen ?? (questionsReviewData as { answers_chosen?: number[] }).answers_chosen;
              const ac = Array.isArray(raw)
                ? raw.map((a: unknown) => {
                    const n = typeof a === 'number' && !Number.isNaN(a) ? a : (typeof a === 'string' ? Number(a) : NaN);
                    if (typeof n !== 'number' || Number.isNaN(n)) return -1;
                    return n < 0 ? -1 : Math.floor(n);
                  })
                : [];
              const oppRounds = questionsReviewData.opponentAnswersByRound ?? [];
              const oppInfoRounds = questionsReviewData.opponentInfoByRound ?? [];
              const userSemiIdx = questionsReviewData.userSemiIndex ?? 0;
              const n = questionsReviewData.questionsAnsweredCount;
              const semiQuestions = userSemiIdx === 0 ? questionsReviewData.questionsSemi1 : questionsReviewData.questionsSemi2;
              const semiCorrect = questionsReviewData.semiFinalCorrectCount ?? (n <= 10 ? questionsReviewData.correctAnswersCount : 0);
              const semiTBAll = questionsReviewData.semiTiebreakerAllQuestions ?? [];
              const semiTBCorrects = questionsReviewData.semiTiebreakerRoundsCorrect ?? [];
              const finalQuestions = questionsReviewData.questionsFinal ?? [];
              const finalTBAll = questionsReviewData.finalTiebreakerAllQuestions ?? [];
              const finalTBCorrects = questionsReviewData.finalTiebreakerRoundsCorrect ?? [];
              const semiTBSum = semiTBCorrects.reduce((a: number, b: number) => a + b, 0);
              const finalTBSum = finalTBCorrects.reduce((a: number, b: number) => a + b, 0);

              type ReviewTab = { label: string; questions: typeof semiQuestions; startIdx: number; correctCount: number; oppRoundIdx: number };
              const tabs: ReviewTab[] = [];
              let oppIdx = 0;

              tabs.push({ label: userSemiIdx === 0 ? 'Полуфинал 1' : 'Полуфинал 2', questions: semiQuestions, startIdx: 0, correctCount: semiCorrect, oppRoundIdx: oppIdx++ });

              let cursor = 10;
              for (let r = 0; r < semiTBAll.length; r++) {
                if (n <= cursor) break;
                tabs.push({ label: semiTBAll.length === 1 ? 'Доп. раунд (ПФ)' : `Доп. раунд ${r + 1} (ПФ)`, questions: semiTBAll[r], startIdx: cursor, correctCount: semiTBCorrects[r] ?? 0, oppRoundIdx: oppIdx++ });
                cursor += 10;
              }

              if (finalQuestions.length > 0 && n > cursor) {
                const finalBaseCorrect = Math.max(0, questionsReviewData.correctAnswersCount - semiCorrect - semiTBSum - finalTBSum);
                tabs.push({ label: 'Финал', questions: finalQuestions, startIdx: cursor, correctCount: finalBaseCorrect, oppRoundIdx: oppIdx++ });
                cursor += 10;

                for (let r = 0; r < finalTBAll.length; r++) {
                  if (n <= cursor) break;
                  tabs.push({ label: finalTBAll.length === 1 ? 'Доп. раунд (Ф)' : `Доп. раунд ${r + 1} (Ф)`, questions: finalTBAll[r], startIdx: cursor, correctCount: finalTBCorrects[r] ?? 0, oppRoundIdx: oppIdx++ });
                  cursor += 10;
                }
              }

              const activeTab = tabs[questionsReviewTabIdx] ?? tabs[0];
              if (!activeTab) return null;
              const answeredInRound = Math.min(activeTab.questions.length, Math.max(0, n - activeTab.startIdx));
              const questionsToShow = activeTab.questions.slice(0, answeredInRound);
              const oppAC = oppRounds[activeTab.oppRoundIdx] ?? [];
              const oppInfo = oppInfoRounds[activeTab.oppRoundIdx] ?? null;

              return (
                <>
                  <div className="qr-legend">
                    <span className="qr-legend-item"><span className="qr-check qr-check--correct">✓</span> Правильный ответ</span>
                    <span className="qr-legend-item"><span className="qr-check qr-check--mine">✓</span> Мой ответ</span>
                    <span className="qr-legend-item"><span className="qr-check qr-check--opp">✓</span> Ответ соперника</span>
                    <span className="qr-legend-item"><span className="qr-cross">✗</span> Нет ответа</span>
                  </div>
                  {tabs.length > 1 && (
                    <div className="questions-review-tabs">
                      {tabs.map((tab, ti) => (
                        <button key={ti} type="button" className={`questions-review-tab ${ti === questionsReviewTabIdx ? 'active' : ''}`} onClick={() => setQuestionsReviewTabIdx(ti)}>{tab.label}</button>
                      ))}
                    </div>
                  )}
                  <div className="questions-review-body">
                    {oppInfo && oppInfo.id > 0 && (
                      <p className="qr-opponent-line">
                        Соперник:{' '}
                        <span className="qr-opponent-name-wrap">
                          <button type="button" className="qr-opponent-link" onClick={() => loadOppStats(oppInfo.id, oppInfo.avatarUrl)}>{oppInfo.nickname}</button>
                          {oppTooltip.visible && (
                            <div className="bracket-player-tooltip qr-opponent-tooltip" onClick={() => setOppTooltip((p) => ({ ...p, visible: false }))} role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && setOppTooltip((p) => ({ ...p, visible: false }))}>
                              {oppTooltip.loading ? (
                                <div className="bracket-player-tooltip-inner"><span className="qr-opponent-tooltip-loading">Загрузка…</span></div>
                              ) : oppTooltip.data ? (
                                <div className="bracket-player-tooltip-inner">
                                  <div className="bracket-player-tooltip-avatar">
                                    {oppTooltip.avatarUrl ? <img src={oppTooltip.avatarUrl} alt="" /> : <DollarIcon />}
                                  </div>
                                  <div className="bracket-player-tooltip-stats">
                                    <div className="bracket-player-tooltip-name">{oppInfo.nickname}</div>
                                    <div className="bracket-player-tooltip-stat"><strong>Лига:</strong> {oppTooltip.data.maxLeagueName ?? '—'}</div>
                                    <div className="bracket-player-tooltip-stat">Сыграно раундов: {formatNum(oppTooltip.data.gamesPlayed ?? 0)}</div>
                                    <div className="bracket-player-tooltip-stat">Сыгранных матчей: {formatNum(oppTooltip.data.completedMatches ?? 0)}</div>
                                    <div className="bracket-player-tooltip-stat"><strong>Сумма выигрыша:</strong> {formatNum(oppTooltip.data.totalWinnings ?? 0)} {CURRENCY}</div>
                                    <div className="bracket-player-tooltip-stat"><strong>Выиграно турниров:</strong> {formatNum(oppTooltip.data.wins ?? 0)}</div>
                                    <div className="bracket-player-tooltip-stat"><strong>Верных ответов:</strong> {formatNum(oppTooltip.data.correctAnswers ?? 0)} из {formatNum(oppTooltip.data.totalQuestions ?? 0)}</div>
                                    <div className="bracket-player-tooltip-stat"><strong>% верных ответов:</strong> {(oppTooltip.data.totalQuestions ?? 0) > 0 ? `${(((oppTooltip.data.correctAnswers ?? 0) / (oppTooltip.data.totalQuestions ?? 1)) * 100).toFixed(2)}%` : '—'}</div>
                                  </div>
                                </div>
                              ) : (
                                <div className="bracket-player-tooltip-inner"><span className="qr-opponent-tooltip-loading">Нет данных</span></div>
                              )}
                            </div>
                          )}
                        </span>
                      </p>
                    )}
                    <p className="questions-review-stats">
                      {activeTab.label}: верно <strong>{activeTab.correctCount}</strong> из <strong>{answeredInRound}</strong> вопросов{answeredInRound < activeTab.questions.length ? ` (отвечено ${answeredInRound} из ${activeTab.questions.length})` : ''}.
                    </p>
                    {questionsToShow.length === 0 ? (
                      <p className="questions-review-empty">Игрок не ответил ни на один вопрос в этом раунде.</p>
                    ) : (
                      <div className="questions-review-round">
                        <h4>{activeTab.label}</h4>
                        {questionsToShow.map((q, idx) => {
                          const rawChoice = ac[activeTab.startIdx + idx];
                          const playerChoice = typeof rawChoice === 'number' && !Number.isNaN(rawChoice) && rawChoice >= 0 && rawChoice < (q.options?.length ?? 0) ? rawChoice : -1;
                          const oppRaw = oppAC[idx];
                          const oppChoice = typeof oppRaw === 'number' && !Number.isNaN(oppRaw) && oppRaw >= 0 && oppRaw < (q.options?.length ?? 0) ? oppRaw : -1;
                          const correctIdx = Number(q.correctAnswer);
                          const noMyAnswer = playerChoice === -1;
                          const noOppAnswer = oppChoice === -1;
                          return (
                            <div key={q.id ?? idx} className="questions-review-question">
                              <p className="questions-review-question-text">
                                <span className="questions-review-question-id">ID: {q.id ?? '—'}</span>
                                {' '}{idx + 1}. {q.question}
                              </p>
                              <table className="qr-table">
                                <thead>
                                  <tr>
                                    <th>Ответ</th>
                                    <th className="qr-th-icon qr-th-correct" title="Правильный ответ">✓</th>
                                    <th className="qr-th-icon qr-th-mine" title="Ответ игрока">{noMyAnswer ? <span className="qr-cross">✗</span> : '✓'}</th>
                                    <th className="qr-th-icon qr-th-opp" title="Ответ соперника">{noOppAnswer ? <span className="qr-cross">✗</span> : '✓'}</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {q.options.map((opt, oi) => (
                                    <tr key={oi}>
                                      <td className="qr-td-text">{opt}</td>
                                      <td className="qr-td-icon">{oi === correctIdx && <span className="qr-check qr-check--correct">✓</span>}</td>
                                      <td className="qr-td-icon">{oi === playerChoice && <span className="qr-check qr-check--mine">✓</span>}</td>
                                      <td className="qr-td-icon">{oi === oppChoice && <span className="qr-check qr-check--opp">✓</span>}</td>
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
      )}
      </div>
    </div>
  );
};

export default Admin;
