import React, { useState, useEffect } from "react";
import axios from "axios";
import { Link } from "react-router-dom";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import {
  fetchTournamentBracket,
  fetchTournamentQuestions,
} from "../features/tournaments/api.ts";
import type {
  BracketPlayerTooltipData,
  BracketViewData,
  OppTooltipState,
  QuestionsReviewData,
} from "../features/tournaments/contracts.ts";
import type { PlayerStats } from "../features/users/contracts.ts";
import { useAdminImpersonation } from "../features/admin/useAdminImpersonation.ts";
import { useAdminQueryState } from "../hooks/useAdminQueryState.ts";
import { formatMoscowDateTimeFull, formatMoscowDateTime } from "./dateUtils.ts";
import {
  TournamentBracketModal,
  TournamentQuestionsModal,
} from "./TournamentModals.tsx";
import "./Admin.css";
import "./Profile.css";

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

type UserRow = {
  id: number;
  username: string;
  email: string;
  balance: number;
  balanceRubles: number;
  isAdmin: boolean;
};

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
  totalDurationMinutes: number;
  totalDurationLabel: string;
  history: ProjectCostHistoryRow[];
};

type ImpersonateConfirmState = {
  userId: number;
  username: string;
  source: "tournaments" | "users";
};

type TournamentColumnKey =
  | "tournamentId"
  | "userNickname"
  | "userId"
  | "phase"
  | "stage"
  | "roundStartedAt"
  | "deadline"
  | "status"
  | "questions"
  | "userStatus"
  | "createdAt"
  | "playersCount"
  | "leagueAmount"
  | "gameType"
  | "resultLabel"
  | "correctAnswersInRound"
  | "completedAt";

const DEFAULT_TOURNAMENT_COLUMNS: TournamentColumnKey[] = [
  "tournamentId",
  "userNickname",
  "userId",
  "phase",
  "stage",
  "roundStartedAt",
  "deadline",
  "status",
  "questions",
  "userStatus",
  "createdAt",
  "playersCount",
  "leagueAmount",
  "gameType",
  "resultLabel",
  "correctAnswersInRound",
  "completedAt",
];

const TOURNAMENT_COLUMN_LABELS: Record<TournamentColumnKey, string> = {
  tournamentId: "ID турнира",
  userNickname: "Ник игрока",
  userId: "ID игрока",
  phase: "Фаза",
  stage: "Этап",
  roundStartedAt: "Старт раунда",
  deadline: "Осталось до конца",
  status: "Результат",
  questions: "Вопросы",
  userStatus: "Турнир",
  createdAt: "Создан",
  playersCount: "Игроков",
  leagueAmount: "Ставка лиги",
  gameType: "Режим",
  resultLabel: "Статус",
  correctAnswersInRound: "Верных в раунде",
  completedAt: "Завершён",
};

const parseTournamentColumns = (raw: string | null): TournamentColumnKey[] => {
  if (!raw) return DEFAULT_TOURNAMENT_COLUMNS;
  const parsed = raw
    .split(",")
    .map((item) => item.trim())
    .filter((item): item is TournamentColumnKey =>
      DEFAULT_TOURNAMENT_COLUMNS.includes(item as TournamentColumnKey),
    );
  const unique = Array.from(new Set(parsed));
  return [
    ...unique,
    ...DEFAULT_TOURNAMENT_COLUMNS.filter((item) => !unique.includes(item)),
  ];
};

const TOURNAMENT_COLS_STORAGE_KEY = "adminTournamentCols";

const getStoredTournamentColumns = (): TournamentColumnKey[] => {
  if (typeof window === "undefined") return DEFAULT_TOURNAMENT_COLUMNS;
  return parseTournamentColumns(
    window.localStorage.getItem(TOURNAMENT_COLS_STORAGE_KEY),
  );
};

const resolveTournamentColumns = (
  raw: string | null,
): TournamentColumnKey[] => {
  if (raw) return parseTournamentColumns(raw);
  return getStoredTournamentColumns();
};

const Admin: React.FC<AdminProps> = ({ token }) => {
  const {
    searchParams,
    setSearchParams,
    state: adminQueryState,
    patchQuery,
  } = useAdminQueryState();
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [withdrawals, setWithdrawals] = useState<WithdrawalRequestRow[]>([]);
  const [pendingWithdrawalsCount, setPendingWithdrawalsCount] = useState(0);
  const [withdrawalStatusFilter, setWithdrawalStatusFilter] = useState<string>(
    () => {
      return adminQueryState.withdrawalStatus;
    },
  );
  const [withdrawalSortBy, setWithdrawalSortBy] = useState<
    | "id"
    | "user"
    | "amount"
    | "details"
    | "status"
    | "admin"
    | "processedAt"
    | "createdAt"
  >("createdAt");
  const [withdrawalSortDir, setWithdrawalSortDir] = useState<"asc" | "desc">(
    "desc",
  );
  const [users, setUsers] = useState<UserRow[]>([]);
  const [userSortBy, setUserSortBy] = useState<
    "id" | "username" | "email" | "balance" | "balanceRubles" | "isAdmin"
  >("id");
  const [userSortDir, setUserSortDir] = useState<"asc" | "desc">("asc");
  const [userSearch, setUserSearch] = useState(
    () => adminQueryState.userSearch,
  );
  const [section, setSection] = useState<
    "withdrawals" | "users" | "credit" | "support" | "statistics" | "news"
  >(() => adminQueryState.section);
  const [menuOpen, setMenuOpen] = useState(false);

  const [newsList, setNewsList] = useState<
    {
      id: number;
      topic: string;
      body: string;
      published: boolean;
      createdAt: string;
    }[]
  >([]);
  const [newsLoading, setNewsLoading] = useState(false);
  const newsLoadedRef = React.useRef(false);
  const [newsTopic, setNewsTopic] = useState("");
  const [newsBody, setNewsBody] = useState("");
  const [newsCreating, setNewsCreating] = useState(false);
  const [newsError, setNewsError] = useState("");
  const [newsSuccess, setNewsSuccess] = useState("");
  const [newsEditId, setNewsEditId] = useState<number | null>(null);
  const [newsEditTopic, setNewsEditTopic] = useState("");
  const [newsEditBody, setNewsEditBody] = useState("");
  const [newsDeleteConfirmId, setNewsDeleteConfirmId] = useState<number | null>(
    null,
  );
  const [newsPublishConfirm, setNewsPublishConfirm] = useState(false);
  const [newsGenerating, setNewsGenerating] = useState(false);
  const [impersonateConfirm, setImpersonateConfirm] =
    useState<ImpersonateConfirmState | null>(null);
  const [usersLoading, setUsersLoading] = useState(false);
  const [creditUserId, setCreditUserId] = useState("");
  const [creditAmount, setCreditAmount] = useState("");
  const [creditLoading, setCreditLoading] = useState(false);
  const [creditError, setCreditError] = useState("");
  const [creditSuccess, setCreditSuccess] = useState("");
  const [creditHistory, setCreditHistory] = useState<
    {
      id: number;
      userId: number;
      username: string;
      userEmail: string;
      amount: number;
      adminUsername: string;
      adminEmail: string;
      createdAt: string;
    }[]
  >([]);
  const [creditHistoryLoaded, setCreditHistoryLoaded] = useState(false);

  const [supportTickets, setSupportTickets] = useState<any[]>([]);
  const [supportUnreadCount, setSupportUnreadCount] = useState(0);
  const [supportStatusFilter, setSupportStatusFilter] = useState<string>(
    () => adminQueryState.supportStatus,
  );
  const [supportOpenTicketId, setSupportOpenTicketId] = useState<number | null>(
    () => {
      return adminQueryState.supportTicket;
    },
  );
  const [supportMessages, setSupportMessages] = useState<any[]>([]);
  const [supportReply, setSupportReply] = useState("");
  const [supportSending, setSupportSending] = useState(false);

  const [statsGroupBy, setStatsGroupBy] = useState<
    "day" | "week" | "month" | "all"
  >("day");
  const [statsData, setStatsData] = useState<
    {
      period: string;
      registrations: number;
      withdrawals: number;
      topups: number;
      gameIncome: number;
    }[]
  >([]);
  const [statsMetrics, setStatsMetrics] = useState<Set<string>>(
    () => new Set(["registrations", "topups", "withdrawals", "gameIncome"]),
  );

  const [statsSubTab, setStatsSubTab] = useState<
    "overview" | "transactions" | "questions" | "tournaments" | "project-cost"
  >(() => {
    return adminQueryState.statsTab;
  });
  type QuestionStatRow = { topic: string; count: number };
  const topicNames: Record<string, string> = {
    math_logic: "Математика и логика",
    math_addition: "Математика: сложение",
    math_subtraction: "Математика: вычитание",
    math_multiplication: "Математика: умножение",
    math_division: "Математика: деление",
    logic_sequences: "Логика: последовательности",
    history_russia: "История России",
    history_world: "Всемирная история",
    science: "Наука",
    capitals: "Столицы",
    currencies: "Валюты",
    countries_facts: "Факты о странах",
    flags: "Флаги",
    landmarks: "Достопримечательности",
    architecture: "Архитектура",
    wonders_of_world: "Чудеса света",
    mountains: "Горы",
    geography_facts: "Географические факты",
    rivers: "Реки",
    oceans: "Океаны",
    deserts: "Пустыни",
    volcanoes: "Вулканы",
    islands: "Острова",
    english_words: "Английский язык",
    russian_literature: "Русская литература",
    foreign_literature: "Зарубежная литература",
    russian_poetry: "Русская поэзия",
    music: "Музыка",
    films: "Кино",
    animals: "Животные",
    birds: "Птицы",
    sea_creatures: "Морские обитатели",
    insects_reptiles: "Насекомые и рептилии",
    dinosaurs: "Динозавры",
    plants_flowers: "Растения и цветы",
    trees: "Деревья",
    cars: "Автомобили",
    trains: "Поезда",
    aviation: "Авиация",
    ships: "Корабли",
    it_programming: "IT и программирование",
    ai_robotics: "ИИ и робототехника",
    internet: "Интернет",
    social_media: "Соцсети",
    gadgets_brands: "Гаджеты и бренды",
    religions: "Религии",
    space: "Космос",
    space_missions: "Космические миссии",
    astronomy: "Астрономия",
    psychology: "Психология",
    cooking: "Кулинария",
    weather: "Погода и климат",
    minerals: "Минералы",
    world_records: "Мировые рекорды",
    nature: "Природа",
    technology: "Технологии",
    culture: "Культура",
    geo: "География",
    literature: "Литература",
    music_film: "Музыка и кино",
    cooking_extras: "Кулинария (доп.)",
    psychology_facts: "Психология (факты)",
    history_500: "История (расш.)",
    culture_500: "Культура (расш.)",
    nature_tech_500: "Природа и техника (расш.)",
    geo_500: "География (расш.)",
  };
  const [questionStats, setQuestionStats] = useState<QuestionStatRow[]>([]);
  const [questionStatsLoading, setQuestionStatsLoading] = useState(false);
  const questionStatsLoadedRef = React.useRef(false);
  const adminHeaderRef = React.useRef<HTMLElement | null>(null);

  type TournamentListRow = {
    tournamentId: number;
    status: string;
    createdAt: string;
    playersCount: number;
    leagueAmount: number | null;
    deadline: string | null;
    userStatus: string;
    stage?: string;
    resultLabel?: string;
    roundForQuestions: "semi" | "final";
    questionsAnswered: number;
    questionsTotal: number;
    correctAnswersInRound: number;
    completedAt?: string | null;
    roundFinished?: boolean;
    roundStartedAt?: string | null;
    userId: number;
    userNickname: string;
    phase: "active" | "history";
    gameType?: "training" | "money" | null;
  };
  const [tournamentsList, setTournamentsList] = useState<TournamentListRow[]>(
    [],
  );
  const [tournamentsListLoading, setTournamentsListLoading] = useState(false);
  const [tournamentsListError, setTournamentsListError] = useState<
    string | null
  >(null);
  const tournamentsListLoadedRef = React.useRef(false);
  const [tournamentIdFilter, setTournamentIdFilter] = useState<string>(
    () => adminQueryState.tournamentId,
  );
  const [tournamentColumns, setTournamentColumns] = useState<
    TournamentColumnKey[]
  >(() => resolveTournamentColumns(searchParams.get("tournamentCols")));
  const [draggedTournamentColumn, setDraggedTournamentColumn] =
    useState<TournamentColumnKey | null>(null);
  const [dragOverTournamentColumn, setDragOverTournamentColumn] =
    useState<TournamentColumnKey | null>(null);
  const [bracketView, setBracketView] = useState<BracketViewData | null>(null);
  const [bracketLoading, setBracketLoading] = useState(false);
  const [bracketError, setBracketError] = useState("");
  const [bracketPlayerTooltip, setBracketPlayerTooltip] =
    useState<BracketPlayerTooltipData | null>(null);
  const bracketLeftColRef = React.useRef<HTMLDivElement>(null);
  const bracketFinalBlockRef = React.useRef<HTMLDivElement>(null);
  const [bracketBlocksEqualized, setBracketBlocksEqualized] = useState(false);
  const bracketLoadedTournamentIdRef = React.useRef<string | null>(null);
  const [questionsReviewTournamentId, setQuestionsReviewTournamentId] =
    useState<number | null>(null);
  const [questionsReviewRound, setQuestionsReviewRound] = useState<
    "semi" | "final"
  >("semi");
  const [questionsReviewTabIdx, setQuestionsReviewTabIdx] = useState(-1);
  const [questionsReviewData, setQuestionsReviewData] =
    useState<QuestionsReviewData | null>(null);
  const [questionsReviewLoading, setQuestionsReviewLoading] = useState(false);
  const [questionsReviewError, setQuestionsReviewError] = useState("");
  const [oppTooltip, setOppTooltip] = useState<OppTooltipState>({
    loading: false,
    data: null,
    visible: false,
  });
  const questionsLoadedTournamentRef = React.useRef<string | null>(null);
  const [qsSortBy, setQsSortBy] = useState<"topic" | "count">("count");
  const [qsSortDir, setQsSortDir] = useState<"asc" | "desc">("desc");
  type TxRow = {
    id: number;
    userId: number;
    username: string;
    email: string;
    amount: number;
    description: string;
    category: string;
    createdAt: string;
  };
  const [txList, setTxList] = useState<TxRow[]>([]);
  const [txLoading, setTxLoading] = useState(false);
  const txLoadedRef = React.useRef(false);
  const [txCategoryFilter, setTxCategoryFilter] = useState<
    "" | "topup" | "withdraw" | "win" | "other"
  >(() => {
    return adminQueryState.txCategory;
  });
  const [txSortBy, setTxSortBy] = useState<
    "id" | "userId" | "username" | "email" | "category" | "amount" | "createdAt"
  >("id");
  const [txSortDir, setTxSortDir] = useState<"asc" | "desc">("desc");
  const [projectCostData, setProjectCostData] =
    useState<ProjectCostDashboardData | null>(null);
  const [projectCostLoading, setProjectCostLoading] = useState(false);
  const projectCostLoadedRef = React.useRef(false);

  // Восстановить вкладку и фильтр статуса из URL при загрузке/обновлении
  useEffect(() => {
    setSection(adminQueryState.section);
    setWithdrawalStatusFilter(adminQueryState.withdrawalStatus);
    if (
      adminQueryState.statsGroupBy === "day" ||
      adminQueryState.statsGroupBy === "week" ||
      adminQueryState.statsGroupBy === "month" ||
      adminQueryState.statsGroupBy === "all"
    ) {
      setStatsGroupBy(adminQueryState.statsGroupBy);
    }
    setStatsSubTab(adminQueryState.statsTab);
    setUserSearch(adminQueryState.userSearch);
    setSupportStatusFilter(adminQueryState.supportStatus);
    setSupportOpenTicketId(adminQueryState.supportTicket);
    setTournamentIdFilter(adminQueryState.tournamentId);
    setTxCategoryFilter(adminQueryState.txCategory);
    const resolvedTournamentColumns = resolveTournamentColumns(
      adminQueryState.tournamentCols,
    );
    setTournamentColumns(resolvedTournamentColumns);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(
        TOURNAMENT_COLS_STORAGE_KEY,
        resolvedTournamentColumns.join(","),
      );
    }
    if (!adminQueryState.tournamentCols) {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.set("tournamentCols", resolvedTournamentColumns.join(","));
          return next;
        },
        { replace: true },
      );
    }
  }, [adminQueryState, setSearchParams]);

  const setSectionAndUrl = (
    next:
      | "withdrawals"
      | "users"
      | "credit"
      | "support"
      | "statistics"
      | "news",
  ) => {
    setSection(next);
    patchQuery({
      tab: next,
      status: next === "withdrawals" ? withdrawalStatusFilter : null,
      statsGroupBy: next === "statistics" ? statsGroupBy : null,
      statsTab: next === "statistics" ? statsSubTab : null,
    });
  };

  useEffect(() => {
    if (section !== "withdrawals") return;
    patchQuery({
      tab: "withdrawals",
      status: withdrawalStatusFilter,
    });
  }, [section, withdrawalStatusFilter, patchQuery]);

  useEffect(() => {
    if (section !== "users") return;
    patchQuery({ userSearch: userSearch.trim() || null });
  }, [section, userSearch, patchQuery]);

  useEffect(() => {
    if (section !== "support") return;
    patchQuery({
      supportStatus: supportStatusFilter || "open",
      supportTicket: supportOpenTicketId ? String(supportOpenTicketId) : null,
    });
  }, [section, supportStatusFilter, supportOpenTicketId, patchQuery]);

  useEffect(() => {
    if (section !== "statistics" || statsSubTab !== "transactions") return;
    patchQuery({ txCategory: txCategoryFilter || null });
  }, [section, statsSubTab, txCategoryFilter, patchQuery]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const handleImpersonate = useAdminImpersonation({ token, setError });
  const [actionSuccessMsg, setActionSuccessMsg] = useState("");
  const [approvedTransfer, setApprovedTransfer] = useState<{
    id: number;
    amount: number;
    details: string | null;
    username: string;
    email: string;
  } | null>(null);
  const headers = React.useMemo(
    () => ({ Authorization: `Bearer ${token}` }),
    [token],
  );

  const formatTimeLeft = (deadline: string | null): string => {
    if (!deadline) return "—";
    const end = new Date(deadline).getTime();
    const now = Date.now();
    if (end <= now) return "—";
    const ms = end - now;
    const h = Math.floor(ms / 3600000);
    const m = Math.floor((ms % 3600000) / 60000);
    if (h > 0) return `${h} ч ${m} мин`;
    return `${m} мин`;
  };

  const formatRubles = (amount: number): string =>
    `${Number(amount || 0).toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₽`;

  const getTournamentStatusLabel = (status: string) => {
    switch (status) {
      case "waiting":
        return "Ожидание";
      case "active":
        return "Активен";
      case "finished":
        return "Завершён";
      default:
        return status || "—";
    }
  };

  const getWithdrawalStatusLabel = (status: string) => {
    switch (status) {
      case "pending":
        return "Ожидает решения";
      case "approved":
        return "Одобрена";
      case "rejected":
        return "Отклонена";
      default:
        return status;
    }
  };

  const getWithdrawalSortValue = React.useCallback(
    (
      w: WithdrawalRequestRow,
      key: typeof withdrawalSortBy,
    ): string | number => {
      switch (key) {
        case "id":
          return w.id;
        case "user":
          return w.user
            ? `${w.user.username} ${w.user.email || ""}`.toLowerCase()
            : "";
        case "amount":
          return Number(w.amount);
        case "details":
          return (w.details || "").toLowerCase();
        case "status":
          return w.status;
        case "admin":
          return (w.processedByAdminUsername || "").toLowerCase();
        case "processedAt":
          return w.processedAt ? new Date(w.processedAt).getTime() : 0;
        case "createdAt":
          return new Date(w.createdAt || 0).getTime();
        default:
          return "";
      }
    },
    [],
  );

  const sortedWithdrawals = React.useMemo(() => {
    const list = [...withdrawals];
    const dir = withdrawalSortDir === "asc" ? 1 : -1;
    list.sort((a, b) => {
      const va = getWithdrawalSortValue(a, withdrawalSortBy);
      const vb = getWithdrawalSortValue(b, withdrawalSortBy);
      if (typeof va === "number" && typeof vb === "number")
        return (va - vb) * dir;
      return String(va).localeCompare(String(vb), "ru") * dir;
    });
    return list;
  }, [
    withdrawals,
    withdrawalSortBy,
    withdrawalSortDir,
    getWithdrawalSortValue,
  ]);

  const handleWithdrawalSort = (key: typeof withdrawalSortBy) => {
    if (withdrawalSortBy === key) {
      setWithdrawalSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setWithdrawalSortBy(key);
      setWithdrawalSortDir("desc");
    }
  };

  const SortableTh = ({
    sortKey,
    children,
  }: {
    sortKey: typeof withdrawalSortBy;
    children: React.ReactNode;
  }) => (
    <th
      className="admin-table-th-sortable"
      onClick={() => handleWithdrawalSort(sortKey)}
    >
      {children}
      {withdrawalSortBy === sortKey && (
        <span className="admin-table-sort-icon" aria-hidden>
          {withdrawalSortDir === "asc" ? " ↑" : " ↓"}
        </span>
      )}
    </th>
  );

  const sortedUsers = React.useMemo(() => {
    const isSearchingById =
      userSearch.trim() && /^\d+$/.test(userSearch.trim());
    if (isSearchingById) return users;
    const list = [...users];
    const dir = userSortDir === "asc" ? 1 : -1;
    list.sort((a, b) => {
      let va: string | number;
      let vb: string | number;
      switch (userSortBy) {
        case "id":
          va = a.id;
          vb = b.id;
          return (va - vb) * dir;
        case "username":
          va = (a.username || "").toLowerCase();
          vb = (b.username || "").toLowerCase();
          return String(va).localeCompare(String(vb), "ru") * dir;
        case "email":
          va = (a.email || "").toLowerCase();
          vb = (b.email || "").toLowerCase();
          return String(va).localeCompare(String(vb), "ru") * dir;
        case "balance":
          va = Number(a.balance);
          vb = Number(b.balance);
          return (va - vb) * dir;
        case "balanceRubles":
          va = Number(a.balanceRubles);
          vb = Number(b.balanceRubles);
          return (va - vb) * dir;
        case "isAdmin":
          va = a.isAdmin ? 1 : 0;
          vb = b.isAdmin ? 1 : 0;
          return (va - vb) * dir;
        default:
          return 0;
      }
    });
    return list;
  }, [users, userSortBy, userSortDir, userSearch]);

  const handleUserSort = (key: typeof userSortBy) => {
    if (userSortBy === key) {
      setUserSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setUserSortBy(key);
      setUserSortDir("asc");
    }
  };

  const UserSortableTh = ({
    sortKey,
    children,
  }: {
    sortKey: typeof userSortBy;
    children: React.ReactNode;
  }) => (
    <th
      className="admin-table-th-sortable"
      onClick={() => handleUserSort(sortKey)}
    >
      {children}
      {userSortBy === sortKey && (
        <span className="admin-table-sort-icon" aria-hidden>
          {userSortDir === "asc" ? " ↑" : " ↓"}
        </span>
      )}
    </th>
  );

  useEffect(() => {
    axios
      .get("/users/profile", { headers })
      .then((res) => {
        const idAdmin = res.data?.id === 1;
        const isAdmin =
          idAdmin ||
          res.data?.isAdmin === true ||
          res.data?.isAdmin === 1 ||
          res.data?.isAdmin === "1" ||
          !!res.data?.isAdmin;
        setIsAdmin(!!isAdmin);
      })
      .catch(() => setIsAdmin(false));
  }, [token, headers]);

  const fetchWithdrawals = React.useCallback(() => {
    if (!token) return;
    const status = withdrawalStatusFilter
      ? String(withdrawalStatusFilter)
      : undefined;
    axios
      .get<WithdrawalRequestRow[]>(
        `/admin/withdrawal-requests${status ? `?status=${status}` : ""}`,
        { headers },
      )
      .then((res) => {
        const list = Array.isArray(res.data) ? res.data : [];
        setWithdrawals(list);
        if (!status)
          setPendingWithdrawalsCount(
            list.filter((r) => r.status === "pending").length,
          );
        else if (status === "pending") setPendingWithdrawalsCount(list.length);
      })
      .catch(() => setWithdrawals([]));
  }, [token, withdrawalStatusFilter, headers]);

  useEffect(() => {
    if (!isAdmin || !token) return;
    if (section === "withdrawals") {
      fetchWithdrawals();
      const interval = setInterval(fetchWithdrawals, 2000);
      return () => clearInterval(interval);
    }
  }, [isAdmin, token, section, fetchWithdrawals]);

  useEffect(() => {
    if (!isAdmin || !token) return;
    if (section === "withdrawals") return;
    const loadPending = () => {
      axios
        .get<WithdrawalRequestRow[]>(
          `/admin/withdrawal-requests?status=pending`,
          { headers },
        )
        .then((res) =>
          setPendingWithdrawalsCount(
            Array.isArray(res.data) ? res.data.length : 0,
          ),
        )
        .catch(() => setPendingWithdrawalsCount(0));
    };
    loadPending();
    const interval = setInterval(loadPending, 5000);
    return () => clearInterval(interval);
  }, [isAdmin, token, section, headers]);

  useEffect(() => {
    if (!isAdmin || !token || section !== "users") return;
    const params = new URLSearchParams();
    params.set("limit", "500");
    if (userSearch.trim()) params.set("search", userSearch.trim());
    const query = params.toString() ? `?${params.toString()}` : "";
    setError("");
    setUsersLoading(true);
    axios
      .get<UserRow[]>(`/admin/users${query}`, { headers })
      .then((res) => {
        const data = res.data;
        const list = Array.isArray(data)
          ? data
          : data && Array.isArray((data as any).data)
            ? (data as any).data
            : data && Array.isArray((data as any).users)
              ? (data as any).users
              : [];
        const sorted = userSearch.trim()
          ? list
          : [...list].sort((a, b) => (a.id ?? 0) - (b.id ?? 0));
        setUsers(sorted);
      })
      .catch((err) => {
        setUsers([]);
        setError(
          err?.response?.data?.message ||
            err?.message ||
            "Не удалось загрузить список пользователей",
        );
      })
      .finally(() => setUsersLoading(false));
  }, [isAdmin, token, section, userSearch, headers]);

  const fetchCreditHistory = React.useCallback(() => {
    if (!token) return;
    axios
      .get<
        {
          id: number;
          userId: number;
          username: string;
          userEmail: string;
          amount: number;
          adminUsername: string;
          adminEmail: string;
          createdAt: string;
        }[]
      >("/admin/credit-history", { headers })
      .then((res) => setCreditHistory(Array.isArray(res.data) ? res.data : []))
      .catch(() => setCreditHistory([]))
      .finally(() => setCreditHistoryLoaded(true));
  }, [token, headers]);

  useEffect(() => {
    if (!isAdmin || !token || section !== "credit") return;
    if (!creditHistoryLoaded) fetchCreditHistory();
  }, [isAdmin, token, section, creditHistoryLoaded, fetchCreditHistory]);

  const fetchSupportTickets = React.useCallback(() => {
    if (!token) return;
    const q = supportStatusFilter ? `?status=${supportStatusFilter}` : "";
    axios
      .get(`/support/admin/tickets${q}`, { headers })
      .then((r) => setSupportTickets(Array.isArray(r.data) ? r.data : []))
      .catch(() => {});
  }, [token, headers, supportStatusFilter]);

  const fetchSupportUnread = React.useCallback(() => {
    if (!token) return;
    axios
      .get<{ count: number }>("/support/admin/unread-count", { headers })
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
    if (!isAdmin || !token || section !== "support") return;
    fetchSupportTickets();
    const iv = setInterval(fetchSupportTickets, 5000);
    return () => clearInterval(iv);
  }, [isAdmin, token, section, fetchSupportTickets]);

  const supportMessagesRequestIdRef = React.useRef(0);
  const openSupportTicket = React.useCallback(
    async (ticketId: number) => {
      setSupportOpenTicketId(ticketId);
      setSupportMessages([]);
      const requestId = ++supportMessagesRequestIdRef.current;
      try {
        const r = await axios.get(
          `/support/admin/tickets/${ticketId}/messages`,
          { headers },
        );
        if (supportMessagesRequestIdRef.current !== requestId) return;
        setSupportMessages(Array.isArray(r.data) ? r.data : []);
        await axios.post(
          `/support/admin/tickets/${ticketId}/read`,
          {},
          { headers },
        );
        fetchSupportTickets();
        fetchSupportUnread();
      } catch {}
    },
    [headers, fetchSupportTickets, fetchSupportUnread],
  );

  useEffect(() => {
    if (!isAdmin || !token || section !== "support" || !supportOpenTicketId)
      return;
    if (supportMessages.length > 0) return;
    void openSupportTicket(supportOpenTicketId);
  }, [
    isAdmin,
    token,
    section,
    supportOpenTicketId,
    supportMessages.length,
    openSupportTicket,
  ]);

  const sendSupportReply = async () => {
    if (!supportOpenTicketId || !supportReply.trim() || supportSending) return;
    setSupportSending(true);
    const requestId = ++supportMessagesRequestIdRef.current;
    try {
      await axios.post(
        `/support/admin/tickets/${supportOpenTicketId}/messages`,
        { text: supportReply.trim() },
        { headers },
      );
      setSupportReply("");
      const r = await axios.get(
        `/support/admin/tickets/${supportOpenTicketId}/messages`,
        { headers },
      );
      if (supportMessagesRequestIdRef.current !== requestId) return;
      setSupportMessages(Array.isArray(r.data) ? r.data : []);
      await axios.post(
        `/support/admin/tickets/${supportOpenTicketId}/read`,
        {},
        { headers },
      );
      fetchSupportTickets();
    } catch {}
    setSupportSending(false);
  };

  const closeSupportTicket = async () => {
    if (!supportOpenTicketId) return;
    try {
      await axios.post(
        `/support/admin/tickets/${supportOpenTicketId}/close`,
        {},
        { headers },
      );
      fetchSupportTickets();
      setSupportOpenTicketId(null);
      setSupportMessages([]);
    } catch {}
  };

  const reopenSupportTicket = async () => {
    if (!supportOpenTicketId) return;
    try {
      await axios.post(
        `/support/admin/tickets/${supportOpenTicketId}/reopen`,
        {},
        { headers },
      );
      fetchSupportTickets();
    } catch {}
  };

  const fetchStats = React.useCallback(() => {
    if (!token) return;
    axios
      .get<{
        data: {
          period: string;
          registrations: number;
          withdrawals: number;
          topups: number;
          gameIncome: number;
        }[];
      }>(`/admin/stats?groupBy=${statsGroupBy}`, { headers })
      .then((r) => setStatsData(r.data.data || []))
      .catch(() => setStatsData([]));
  }, [token, headers, statsGroupBy]);

  useEffect(() => {
    if (!isAdmin || !token || section !== "statistics") return;
    fetchStats();
  }, [isAdmin, token, section, fetchStats]);

  const fetchTransactions = React.useCallback(() => {
    if (!token) return;
    if (!txLoadedRef.current) setTxLoading(true);
    const catParam = txCategoryFilter ? `?category=${txCategoryFilter}` : "";
    axios
      .get<TxRow[]>(`/admin/transactions${catParam}`, { headers })
      .then((r) => setTxList(Array.isArray(r.data) ? r.data : []))
      .catch(() => setTxList([]))
      .finally(() => {
        setTxLoading(false);
        txLoadedRef.current = true;
      });
  }, [token, headers, txCategoryFilter]);

  useEffect(() => {
    if (
      !isAdmin ||
      !token ||
      section !== "statistics" ||
      statsSubTab !== "transactions"
    )
      return;
    fetchTransactions();
  }, [isAdmin, token, section, statsSubTab, fetchTransactions]);

  const fetchQuestionStats = React.useCallback(() => {
    if (!token) return;
    if (!questionStatsLoadedRef.current) setQuestionStatsLoading(true);
    axios
      .get<QuestionStatRow[]>("/admin/question-stats", { headers })
      .then((r) => setQuestionStats(Array.isArray(r.data) ? r.data : []))
      .catch(() => setQuestionStats([]))
      .finally(() => {
        setQuestionStatsLoading(false);
        questionStatsLoadedRef.current = true;
      });
  }, [token, headers]);

  useEffect(() => {
    if (
      !isAdmin ||
      !token ||
      section !== "statistics" ||
      statsSubTab !== "questions"
    )
      return;
    fetchQuestionStats();
  }, [isAdmin, token, section, statsSubTab, fetchQuestionStats]);

  const fetchTournamentsList = React.useCallback(() => {
    if (!token) return;
    if (!tournamentsListLoadedRef.current) setTournamentsListLoading(true);
    setTournamentsListError(null);
    axios
      .get<TournamentListRow[]>("/admin/tournaments-list", { headers })
      .then((r) => {
        setTournamentsList(Array.isArray(r.data) ? r.data : []);
        setTournamentsListError(null);
      })
      .catch((e) => {
        setTournamentsList([]);
        setTournamentsListError(
          e?.response?.data?.message ||
            e?.message ||
            "Ошибка загрузки списка турниров",
        );
      })
      .finally(() => {
        setTournamentsListLoading(false);
        tournamentsListLoadedRef.current = true;
      });
  }, [token, headers]);

  useEffect(() => {
    if (
      !isAdmin ||
      !token ||
      section !== "statistics" ||
      statsSubTab !== "tournaments"
    )
      return;
    fetchTournamentsList();
  }, [isAdmin, token, section, statsSubTab, fetchTournamentsList]);

  const fetchProjectCost = React.useCallback(() => {
    if (!token) return;
    if (!projectCostLoadedRef.current) setProjectCostLoading(true);
    axios
      .get<ProjectCostDashboardData>("/admin/project-cost", { headers })
      .then((r) =>
        setProjectCostData(
          r.data ?? {
            currentTotal: 0,
            todayTotal: 0,
            updatedAt: null,
            totalDurationMinutes: 0,
            totalDurationLabel: "0 мин",
            history: [],
          },
        ),
      )
      .catch(() =>
        setProjectCostData({
          currentTotal: 0,
          todayTotal: 0,
          updatedAt: null,
          totalDurationMinutes: 0,
          totalDurationLabel: "0 мин",
          history: [],
        }),
      )
      .finally(() => {
        setProjectCostLoading(false);
        projectCostLoadedRef.current = true;
      });
  }, [token, headers]);

  useEffect(() => {
    if (
      !isAdmin ||
      !token ||
      section !== "statistics" ||
      statsSubTab !== "project-cost"
    )
      return;
    fetchProjectCost();
  }, [isAdmin, token, section, statsSubTab, fetchProjectCost]);

  useEffect(() => {
    if (
      !isAdmin ||
      !token ||
      section !== "statistics" ||
      statsSubTab !== "project-cost"
    )
      return;
    const iv = window.setInterval(() => {
      fetchProjectCost();
    }, 30000);
    return () => window.clearInterval(iv);
  }, [isAdmin, token, section, statsSubTab, fetchProjectCost]);

  const updateTournamentColumns = React.useCallback(
    (nextColumns: TournamentColumnKey[]) => {
      setTournamentColumns(nextColumns);
      if (typeof window !== "undefined") {
        window.localStorage.setItem(
          TOURNAMENT_COLS_STORAGE_KEY,
          nextColumns.join(","),
        );
      }
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.set("tournamentCols", nextColumns.join(","));
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  const reorderTournamentColumns = React.useCallback(
    (sourceColumn: TournamentColumnKey, targetColumn: TournamentColumnKey) => {
      if (sourceColumn === targetColumn) return;
      const sourceIndex = tournamentColumns.indexOf(sourceColumn);
      const targetIndex = tournamentColumns.indexOf(targetColumn);
      if (sourceIndex < 0 || targetIndex < 0) return;
      const next = [...tournamentColumns];
      next.splice(sourceIndex, 1);
      next.splice(targetIndex, 0, sourceColumn);
      updateTournamentColumns(next);
    },
    [tournamentColumns, updateTournamentColumns],
  );

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

  const openBracketModal = React.useCallback(
    (tournamentId: number, phase: "active" | "history", userId: number) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.set("tournamentModal", String(tournamentId));
          next.set(
            "tournamentSource",
            phase === "history" ? "completed" : "active",
          );
          next.set("tournamentUserId", String(userId));
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  const closeBracket = React.useCallback(() => {
    setBracketView(null);
    setBracketError("");
    setBracketPlayerTooltip(null);
    bracketLoadedTournamentIdRef.current = null;
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete("tournamentModal");
        next.delete("tournamentSource");
        next.delete("tournamentUserId");
        return next;
      },
      { replace: true },
    );
  }, [setSearchParams]);

  useEffect(() => {
    const rawId = searchParams.get("tournamentModal");
    const id = rawId && /^\d+$/.test(rawId) ? Number(rawId) : null;
    const rawUserId = searchParams.get("tournamentUserId");
    const viewerUserId =
      rawUserId && /^\d+$/.test(rawUserId) ? Number(rawUserId) : null;
    if (!id || !token || !viewerUserId) {
      setBracketView(null);
      setBracketError("");
      setBracketLoading(false);
      bracketLoadedTournamentIdRef.current = null;
      return;
    }
    const bracketKey = `${id}:${viewerUserId}`;
    if (
      bracketLoadedTournamentIdRef.current === bracketKey &&
      (bracketView || bracketError)
    ) {
      return;
    }
    bracketLoadedTournamentIdRef.current = bracketKey;
    setBracketLoading(true);
    setBracketError("");
    setBracketPlayerTooltip(null);
    fetchTournamentBracket(token, id, viewerUserId)
      .then((data) => {
        setBracketView(data);
        setBracketError("");
      })
      .catch((e: unknown) => {
        const err =
          e && typeof e === "object" && "response" in e
            ? (e as { response?: { data?: { message?: string | string[] } } })
                .response
            : undefined;
        const msg = err?.data?.message;
        const text = Array.isArray(msg)
          ? msg[0]
          : typeof msg === "string"
            ? msg
            : e instanceof Error
              ? e.message
              : "Не удалось загрузить сетку";
        setBracketView(null);
        setBracketError(text || "Не удалось загрузить сетку");
      })
      .finally(() => setBracketLoading(false));
  }, [searchParams, token, headers, bracketView, bracketError]);

  const openQuestionsReview = React.useCallback(
    (
      tournamentId: number,
      roundForQuestions: "semi" | "final",
      userId: number,
    ) => {
      setQuestionsReviewRound(roundForQuestions);
      setQuestionsReviewTabIdx(-1);
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.set("questionsModal", String(tournamentId));
          next.set("questionsRound", roundForQuestions);
          next.set("questionsUserId", String(userId));
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  const closeQuestionsReview = React.useCallback(() => {
    setQuestionsReviewTournamentId(null);
    setQuestionsReviewTabIdx(0);
    setQuestionsReviewData(null);
    setQuestionsReviewError("");
    setOppTooltip({ loading: false, data: null, visible: false });
    questionsLoadedTournamentRef.current = null;
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete("questionsModal");
        next.delete("questionsRound");
        next.delete("questionsUserId");
        return next;
      },
      { replace: true },
    );
  }, [setSearchParams]);

  useEffect(() => {
    const rawId = searchParams.get("questionsModal");
    const id = rawId && /^\d+$/.test(rawId) ? Number(rawId) : null;
    const round =
      searchParams.get("questionsRound") === "final" ? "final" : "semi";
    setQuestionsReviewRound(round);
    const rawUserId = searchParams.get("questionsUserId");
    const viewerUserId =
      rawUserId && /^\d+$/.test(rawUserId) ? Number(rawUserId) : null;
    if (!id || !token || !viewerUserId) {
      setQuestionsReviewTournamentId(null);
      setQuestionsReviewData(null);
      setQuestionsReviewLoading(false);
      setQuestionsReviewError("");
      questionsLoadedTournamentRef.current = null;
      return;
    }
    const key = `${id}:${viewerUserId}:${round}`;
    if (
      questionsLoadedTournamentRef.current === key &&
      (questionsReviewData || questionsReviewError)
    ) {
      setQuestionsReviewTournamentId(id);
      return;
    }
    questionsLoadedTournamentRef.current = key;
    setQuestionsReviewTournamentId(id);
    setQuestionsReviewTabIdx(-1);
    setQuestionsReviewData(null);
    setQuestionsReviewError("");
    setQuestionsReviewLoading(true);
    fetchTournamentQuestions(token, id, viewerUserId)
      .then((data) => {
        const answersChosenRaw = data.answersChosen;
        setQuestionsReviewData({
          questionsSemi1: data.questionsSemi1 ?? [],
          questionsSemi2: data.questionsSemi2 ?? [],
          questionsFinal: data.questionsFinal ?? [],
          questionsAnsweredCount: data.questionsAnsweredCount ?? 0,
          correctAnswersCount: data.correctAnswersCount ?? 0,
          semiFinalCorrectCount: data.semiFinalCorrectCount ?? null,
          semiTiebreakerCorrectSum: data.semiTiebreakerCorrectSum ?? 0,
          answersChosen: Array.isArray(answersChosenRaw)
            ? answersChosenRaw
            : [],
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
        const msg =
          axios.isAxiosError(e) && e.response?.data?.message
            ? String(e.response.data.message)
            : "Не удалось загрузить вопросы";
        setQuestionsReviewError(msg);
      })
      .finally(() => setQuestionsReviewLoading(false));
  }, [searchParams, token, headers, questionsReviewData, questionsReviewError]);

  const loadOppStats = React.useCallback(
    (userId: number, avatarUrl?: string | null) => {
      if (oppTooltip.data && oppTooltip.visible) {
        setOppTooltip((prev) => ({ ...prev, visible: false }));
        return;
      }
      setOppTooltip({ loading: true, data: null, visible: true, avatarUrl });
      axios
        .get<PlayerStats>(`/users/${userId}/public-stats`, { headers })
        .then((res) =>
          setOppTooltip({
            loading: false,
            data: res.data,
            visible: true,
            avatarUrl,
          }),
        )
        .catch(() =>
          setOppTooltip({ loading: false, data: null, visible: false }),
        );
    },
    [headers, oppTooltip.data, oppTooltip.visible],
  );

  const renderTournamentCell = React.useCallback(
    (row: TournamentListRow, column: TournamentColumnKey) => {
      switch (column) {
        case "tournamentId":
          return (
            <td
              className="admin-tournament-col-id"
              style={{ textAlign: "center" }}
            >
              <button
                type="button"
                className="admin-tournament-cell-link"
                onClick={() =>
                  openBracketModal(row.tournamentId, row.phase, row.userId)
                }
              >
                {row.tournamentId}
              </button>
            </td>
          );
        case "userNickname":
          return (
            <td className="admin-td-left">
              <button
                type="button"
                className="admin-tournament-cell-link admin-tournament-cell-link--left"
                onClick={() =>
                  setImpersonateConfirm({
                    userId: row.userId,
                    username: row.userNickname || `Игрок ${row.userId}`,
                    source: "tournaments",
                  })
                }
                title="Перейти как пользователь"
              >
                {row.userNickname}
              </button>
            </td>
          );
        case "userId":
          return <td style={{ textAlign: "center" }}>{row.userId}</td>;
        case "phase":
          return (
            <td style={{ textAlign: "center" }}>
              {row.phase === "active" ? "Активный" : "История"}
            </td>
          );
        case "stage":
          return <td style={{ textAlign: "center" }}>{row.stage ?? "—"}</td>;
        case "roundStartedAt":
          return (
            <td style={{ textAlign: "center" }}>
              {row.roundStartedAt
                ? formatMoscowDateTime(row.roundStartedAt)
                : "—"}
            </td>
          );
        case "deadline":
          return (
            <td style={{ textAlign: "center" }}>
              {formatTimeLeft(row.deadline)}
            </td>
          );
        case "status":
          return (
            <td style={{ textAlign: "center" }}>
              {getTournamentStatusLabel(row.status)}
            </td>
          );
        case "questions":
          return (
            <td style={{ textAlign: "center" }}>
              <button
                type="button"
                className="admin-tournament-cell-link"
                onClick={() =>
                  openQuestionsReview(
                    row.tournamentId,
                    row.roundForQuestions,
                    row.userId,
                  )
                }
                title="Всего / отвечено / правильно"
              >
                {`${row.questionsTotal}/${row.questionsAnswered}${row.correctAnswersInRound != null ? `/${row.correctAnswersInRound}` : ""}`}
              </button>
            </td>
          );
        case "userStatus":
          return (
            <td style={{ textAlign: "center" }}>
              {row.userStatus === "passed" ? "Пройден" : "Не пройден"}
            </td>
          );
        case "createdAt":
          return (
            <td style={{ textAlign: "center" }}>
              {row.createdAt ? formatMoscowDateTime(row.createdAt) : "—"}
            </td>
          );
        case "playersCount":
          return <td style={{ textAlign: "center" }}>{row.playersCount}</td>;
        case "leagueAmount":
          return (
            <td style={{ textAlign: "center" }}>
              {row.leagueAmount != null ? row.leagueAmount : "—"}
            </td>
          );
        case "gameType":
          return (
            <td style={{ textAlign: "center" }}>
              {row.gameType === "money"
                ? "Противостояние"
                : row.gameType === "training"
                  ? "Тренировка"
                  : "—"}
            </td>
          );
        case "resultLabel":
          return (
            <td style={{ textAlign: "center" }}>{row.resultLabel ?? "—"}</td>
          );
        case "correctAnswersInRound":
          return (
            <td style={{ textAlign: "center" }}>{row.correctAnswersInRound}</td>
          );
        case "completedAt":
          return (
            <td style={{ textAlign: "center" }}>
              {row.completedAt ? formatMoscowDateTime(row.completedAt) : "—"}
            </td>
          );
        default:
          return <td>—</td>;
      }
    },
    [openBracketModal, openQuestionsReview],
  );

  const sortedQuestionStats = React.useMemo(() => {
    const list = [...questionStats];
    const dir = qsSortDir === "asc" ? 1 : -1;
    list.sort((a, b) => {
      if (qsSortBy === "count") return (a.count - b.count) * dir;
      return a.topic.localeCompare(b.topic, "ru") * dir;
    });
    return list;
  }, [questionStats, qsSortBy, qsSortDir]);

  const sortedTxList = React.useMemo(() => {
    const list = [...txList];
    const dir = txSortDir === "asc" ? 1 : -1;
    list.sort((a, b) => {
      let va: string | number;
      let vb: string | number;
      switch (txSortBy) {
        case "id":
          return (a.id - b.id) * dir;
        case "userId":
          return (a.userId - b.userId) * dir;
        case "amount":
          return (Number(a.amount) - Number(b.amount)) * dir;
        case "createdAt":
          va = a.createdAt ? new Date(a.createdAt).getTime() : 0;
          vb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
          return ((va as number) - (vb as number)) * dir;
        case "username":
          return (a.username || "").localeCompare(b.username || "", "ru") * dir;
        case "email":
          return (a.email || "").localeCompare(b.email || "", "ru") * dir;
        case "category":
          return (a.category || "").localeCompare(b.category || "", "ru") * dir;
        default:
          return 0;
      }
    });
    return list;
  }, [txList, txSortBy, txSortDir]);

  const handleTxSort = (key: typeof txSortBy) => {
    if (txSortBy === key) {
      setTxSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setTxSortBy(key);
      setTxSortDir("desc");
    }
  };

  const TxSortableTh = ({
    sortKey,
    children,
  }: {
    sortKey: typeof txSortBy;
    children: React.ReactNode;
  }) => (
    <th
      className="admin-table-th-sortable"
      onClick={() => handleTxSort(sortKey)}
    >
      {children}
      {txSortBy === sortKey && (
        <span className="admin-table-sort-icon" aria-hidden>
          {txSortDir === "asc" ? " ↑" : " ↓"}
        </span>
      )}
    </th>
  );

  const fetchNews = React.useCallback(() => {
    if (!token) return;
    if (!newsLoadedRef.current) setNewsLoading(true);
    axios
      .get<
        {
          id: number;
          topic: string;
          body: string;
          published: boolean;
          createdAt: string;
        }[]
      >("/news/admin", { headers })
      .then((r) => setNewsList(Array.isArray(r.data) ? r.data : []))
      .catch(() => setNewsList([]))
      .finally(() => {
        setNewsLoading(false);
        newsLoadedRef.current = true;
      });
  }, [token, headers]);

  useEffect(() => {
    if (!isAdmin || !token || section !== "news") return;
    fetchNews();
  }, [isAdmin, token, section, fetchNews]);

  const handleGenerateNews = async () => {
    setNewsGenerating(true);
    setNewsError("");
    try {
      const res = await axios.post<{ topic: string; body: string }>(
        "/news/generate",
        {},
        { headers },
      );
      setNewsTopic(res.data.topic || "");
      setNewsBody(res.data.body || "");
    } catch (err: any) {
      const msg =
        err?.response?.data?.message || err?.message || "Ошибка при генерации";
      setNewsError(typeof msg === "string" ? msg : "Ошибка при генерации");
    } finally {
      setNewsGenerating(false);
    }
  };

  const handleCreateNews = async () => {
    setNewsCreating(true);
    setNewsSuccess("");
    try {
      await axios.post(
        "/news",
        { topic: newsTopic.trim(), body: newsBody.trim() },
        { headers },
      );
      setNewsSuccess("Новость опубликована");
      setNewsTopic("");
      setNewsBody("");
      fetchNews();
      setTimeout(() => setNewsSuccess(""), 3000);
    } catch {
      setNewsError("Ошибка при создании новости");
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
      setNewsError("Ошибка при удалении");
      setNewsDeleteConfirmId(null);
    }
  };

  const handleTogglePublish = async (id: number, published: boolean) => {
    try {
      await axios.put(`/news/${id}`, { published: !published }, { headers });
      fetchNews();
    } catch {
      setNewsError("Ошибка при обновлении");
    }
  };

  const handleSaveEdit = async (id: number) => {
    if (!newsEditTopic.trim() || !newsEditBody.trim()) return;
    try {
      await axios.put(
        `/news/${id}`,
        { topic: newsEditTopic.trim(), body: newsEditBody.trim() },
        { headers },
      );
      setNewsEditId(null);
      fetchNews();
    } catch {
      setNewsError("Ошибка при сохранении");
    }
  };

  const handleCreditBalance = async () => {
    const uid = parseInt(creditUserId.trim(), 10);
    const amt = parseFloat(creditAmount.trim());
    if (!uid || uid <= 0) {
      setCreditError("Введите корректный ID пользователя");
      return;
    }
    if (!amt || amt <= 0) {
      setCreditError("Введите корректную сумму (> 0)");
      return;
    }
    setCreditLoading(true);
    setCreditError("");
    setCreditSuccess("");
    try {
      const res = await axios.post<{
        success: boolean;
        newBalanceRubles: number;
      }>("/admin/credit-balance", { userId: uid, amount: amt }, { headers });
      setCreditSuccess(
        `Начислено ${amt} ₽ пользователю ID ${uid}. Новый баланс рублей: ${res.data.newBalanceRubles} ₽`,
      );
      setCreditUserId("");
      setCreditAmount("");
      fetchCreditHistory();
    } catch (e: any) {
      setCreditError(
        e?.response?.data?.message || e?.message || "Не удалось начислить",
      );
    } finally {
      setCreditLoading(false);
    }
  };

  const handleApprove = async (id: number) => {
    setLoading(true);
    setError("");
    setActionSuccessMsg("");
    setApprovedTransfer(null);
    try {
      await axios.post(
        `/admin/withdrawal-requests/${id}/approve`,
        {},
        { headers },
      );
      const req = withdrawals.find((w) => w.id === id);
      setApprovedTransfer({
        id,
        amount: req?.amount ?? 0,
        details: req?.details ?? null,
        username: req?.user?.username ?? `#${req?.userId ?? "?"}`,
        email: req?.user?.email ?? "",
      });
      setPendingWithdrawalsCount((c) => Math.max(0, c - 1));
      await fetchWithdrawals();
    } catch (e: any) {
      setError(e?.response?.data?.message || "Ошибка одобрения");
    } finally {
      setLoading(false);
    }
  };

  const handleReject = async (id: number) => {
    setLoading(true);
    setError("");
    setActionSuccessMsg("");
    try {
      await axios.post(
        `/admin/withdrawal-requests/${id}/reject`,
        {},
        { headers },
      );
      setActionSuccessMsg(`Заявка #${id} отклонена. Решение сохранено.`);
      setTimeout(() => setActionSuccessMsg(""), 8000);
      setPendingWithdrawalsCount((c) => Math.max(0, c - 1));
      await fetchWithdrawals();
    } catch (e: any) {
      setError(e?.response?.data?.message || "Ошибка отклонения");
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
    setError("");
    try {
      await axios.post(
        `/admin/users/${userId}/set-admin`,
        { isAdmin: value },
        { headers },
      );
      setUsers((prev) =>
        prev.map((u) => (u.id === userId ? { ...u, isAdmin: value } : u)),
      );
    } catch (e: any) {
      setError(e?.response?.data?.message || "Ошибка");
    }
  };

  const confirmImpersonateLabel =
    impersonateConfirm?.source === "tournaments"
      ? "Открыть кабинет этого игрока как пользователь?"
      : "Точно перейти в кабинет этого пользователя?";

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
      <header
        ref={adminHeaderRef}
        className="admin-panel-header cabinet-header"
      >
        <div className="cabinet-header-left">
          <span className="admin-header-title">Админ-панель</span>
        </div>
        <div className="cabinet-header-center">
          <div className="admin-menu-wrap">
            <button
              type="button"
              className="admin-menu-trigger"
              onClick={() => setMenuOpen((v) => !v)}
            >
              <svg width="14" height="14" viewBox="0 0 18 18" fill="none">
                <rect
                  x="1"
                  y="1"
                  width="7"
                  height="7"
                  rx="1.5"
                  fill="currentColor"
                />
                <rect
                  x="10"
                  y="1"
                  width="7"
                  height="7"
                  rx="1.5"
                  fill="currentColor"
                />
                <rect
                  x="1"
                  y="10"
                  width="7"
                  height="7"
                  rx="1.5"
                  fill="currentColor"
                />
                <rect
                  x="10"
                  y="10"
                  width="7"
                  height="7"
                  rx="1.5"
                  fill="currentColor"
                />
              </svg>
              <span className="admin-menu-label">Меню</span>
              <svg
                className={`admin-menu-chevron ${menuOpen ? "open" : ""}`}
                width="10"
                height="6"
                viewBox="0 0 10 6"
                fill="none"
              >
                <path
                  d="M1 1l4 4 4-4"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              {(pendingWithdrawalsCount > 0 || supportUnreadCount > 0) && (
                <span className="admin-menu-dot" />
              )}
            </button>
            {menuOpen && (
              <>
                <div
                  className="admin-menu-backdrop"
                  onClick={() => setMenuOpen(false)}
                />
                <div className="admin-menu-dropdown">
                  <button
                    type="button"
                    className={section === "statistics" ? "active" : ""}
                    onClick={() => {
                      setSectionAndUrl("statistics");
                      setMenuOpen(false);
                    }}
                  >
                    Статистика
                  </button>
                  <button
                    type="button"
                    className={section === "users" ? "active" : ""}
                    onClick={() => {
                      setSectionAndUrl("users");
                      setMenuOpen(false);
                    }}
                  >
                    Пользователи
                  </button>
                  <button
                    type="button"
                    className={section === "withdrawals" ? "active" : ""}
                    onClick={() => {
                      setSectionAndUrl("withdrawals");
                      setMenuOpen(false);
                    }}
                  >
                    Заявки на вывод
                    {pendingWithdrawalsCount > 0 && (
                      <span className="admin-tab-badge">
                        {pendingWithdrawalsCount}
                      </span>
                    )}
                  </button>
                  <button
                    type="button"
                    className={section === "credit" ? "active" : ""}
                    onClick={() => {
                      setSectionAndUrl("credit");
                      setMenuOpen(false);
                    }}
                  >
                    Начисление
                  </button>
                  <button
                    type="button"
                    className={section === "support" ? "active" : ""}
                    onClick={() => {
                      setSectionAndUrl("support");
                      setMenuOpen(false);
                    }}
                  >
                    Тех. поддержка
                    {supportUnreadCount > 0 && (
                      <span className="admin-tab-badge">
                        {supportUnreadCount}
                      </span>
                    )}
                  </button>
                  <button
                    type="button"
                    className={section === "news" ? "active" : ""}
                    onClick={() => {
                      setSectionAndUrl("news");
                      setMenuOpen(false);
                    }}
                  >
                    Новости
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
        <div className="cabinet-header-right">
          <Link to="/profile" className="admin-header-cabinet-link">
            Вернуться в кабинет
          </Link>
        </div>
      </header>
      <div className="admin-work-area">
        {error && <p className="admin-error">{error}</p>}
        {actionSuccessMsg && (
          <p className="admin-success admin-action-saved">{actionSuccessMsg}</p>
        )}
        {section === "withdrawals" && approvedTransfer && (
          <div className="admin-transfer-card">
            <h3>Переведите средства игроку</h3>
            <div className="admin-transfer-card-details">
              <div className="admin-transfer-card-row">
                <span className="admin-transfer-card-label">Заявка</span>
                <span className="admin-transfer-card-value">
                  #{approvedTransfer.id}
                </span>
              </div>
              <div className="admin-transfer-card-row">
                <span className="admin-transfer-card-label">Игрок</span>
                <span className="admin-transfer-card-value">
                  {approvedTransfer.username}
                  {approvedTransfer.email ? ` (${approvedTransfer.email})` : ""}
                </span>
              </div>
              <div className="admin-transfer-card-row">
                <span className="admin-transfer-card-label">Сумма</span>
                <span className="admin-transfer-card-value admin-transfer-card-amount">
                  {approvedTransfer.amount} ₽
                </span>
              </div>
              <div className="admin-transfer-card-row">
                <span className="admin-transfer-card-label">Реквизиты</span>
                <span className="admin-transfer-card-value">
                  {approvedTransfer.details || "—"}
                </span>
              </div>
            </div>
            <button
              type="button"
              className="admin-transfer-card-btn"
              onClick={() => {
                setApprovedTransfer(null);
                setWithdrawalStatusFilter("pending");
              }}
            >
              Перевод исполнен
            </button>
          </div>
        )}
        {section === "withdrawals" && !approvedTransfer && (
          <section className="admin-section admin-section-withdrawals">
            <label>
              Статус:{" "}
              <select
                value={withdrawalStatusFilter}
                onChange={(e) => {
                  const v = e.target.value;
                  setWithdrawalStatusFilter(v);
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
                      <td className="admin-td-left">
                        {w.user
                          ? `${w.user.username} (${w.user.email || "—"})`
                          : `#${w.userId}`}
                      </td>
                      <td>{w.amount} ₽</td>
                      <td className="admin-td-left">{w.details || "—"}</td>
                      <td>
                        <span
                          className={`admin-withdrawal-status admin-withdrawal-status--${w.status}`}
                        >
                          {getWithdrawalStatusLabel(w.status)}
                        </span>
                      </td>
                      <td className="admin-td-left">
                        {w.processedByAdminUsername != null ||
                        w.processedByAdminEmail != null
                          ? [
                              w.processedByAdminUsername || "",
                              w.processedByAdminEmail
                                ? `(${w.processedByAdminEmail})`
                                : "",
                            ]
                              .filter(Boolean)
                              .join(" ")
                          : "—"}
                      </td>
                      <td>
                        {w.processedAt
                          ? formatMoscowDateTimeFull(w.processedAt)
                          : "—"}
                      </td>
                      <td>
                        {w.createdAt
                          ? formatMoscowDateTimeFull(w.createdAt)
                          : "—"}
                      </td>
                      <td>
                        {w.status === "pending" && (
                          <>
                            <button
                              type="button"
                              className="admin-btn-approve"
                              onClick={() => handleApprove(w.id)}
                              disabled={loading}
                            >
                              Одобрить
                            </button>
                            <button
                              type="button"
                              className="admin-btn-reject"
                              onClick={() => handleReject(w.id)}
                              disabled={loading}
                            >
                              Отклонить
                            </button>
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
        {section === "users" && (
          <section className="admin-section admin-section-users">
            <label>
              Поиск:{" "}
              <input
                type="text"
                value={userSearch}
                onChange={(e) => setUserSearch(e.target.value)}
                placeholder="ID, логин или email"
              />
            </label>
            {usersLoading && <p className="admin-loading">Загрузка списка…</p>}
            {!usersLoading && (
              <>
                <div className="admin-table-wrap">
                  <table className="admin-table">
                    <thead>
                      <tr>
                        <UserSortableTh sortKey="id">ID</UserSortableTh>
                        <UserSortableTh sortKey="username">
                          Логин
                        </UserSortableTh>
                        <UserSortableTh sortKey="email">Email</UserSortableTh>
                        <UserSortableTh sortKey="balance">
                          Баланс L
                        </UserSortableTh>
                        <UserSortableTh sortKey="balanceRubles">
                          Баланс ₽
                        </UserSortableTh>
                        <th>Действия</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sortedUsers.map((u) => (
                        <tr key={u.id}>
                          <td>{u.id}</td>
                          <td className="admin-td-left">
                            <button
                              type="button"
                              className="admin-tournament-cell-link admin-tournament-cell-link--left"
                              onClick={() =>
                                setImpersonateConfirm({
                                  userId: u.id,
                                  username: u.username,
                                  source: "users",
                                })
                              }
                              title="Перейти как пользователь"
                            >
                              {u.username}
                              {u.isAdmin ? " (админ)" : ""}
                            </button>
                          </td>
                          <td className="admin-td-left">{u.email}</td>
                          <td>{u.balance}</td>
                          <td>{u.balanceRubles} ₽</td>
                          <td className="admin-table-actions">
                            <div className="admin-table-actions-inner">
                              {u.id !== 1 && !u.isAdmin && (
                                <button
                                  type="button"
                                  className="admin-btn-make-admin"
                                  onClick={() => handleSetAdmin(u.id, true)}
                                >
                                  Сделать админом
                                </button>
                              )}
                              {u.id !== 1 && u.isAdmin && (
                                <button
                                  type="button"
                                  className="admin-btn-remove-admin"
                                  onClick={() => handleSetAdmin(u.id, false)}
                                >
                                  Снять админа
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {users.length === 0 && !error && (
                  <p>Пользователей не найдено</p>
                )}
              </>
            )}
          </section>
        )}
        {section === "credit" && (
          <section className="admin-section admin-section-credit">
            <div className="admin-credit-form">
              <h3>Начисление</h3>
              {creditError && <p className="admin-error">{creditError}</p>}
              {creditSuccess && (
                <p className="admin-success">{creditSuccess}</p>
              )}
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
                  {creditLoading ? "Начисляю..." : "Начислить"}
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
                          <span>{ch.username || "—"}</span>
                          {ch.userEmail && (
                            <span className="admin-credit-cell-email">
                              {ch.userEmail}
                            </span>
                          )}
                        </td>
                        <td>+{Number(ch.amount).toFixed(2)} ₽</td>
                        <td className="admin-credit-cell-name admin-td-left">
                          <span>{ch.adminUsername || "—"}</span>
                          {ch.adminEmail && (
                            <span className="admin-credit-cell-email">
                              {ch.adminEmail}
                            </span>
                          )}
                        </td>
                        <td>
                          {ch.createdAt
                            ? formatMoscowDateTimeFull(ch.createdAt)
                            : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}
        {section === "support" && (
          <section className="admin-section">
            {supportOpenTicketId ? (
              (() => {
                const ticket = supportTickets.find(
                  (t: any) => t.id === supportOpenTicketId,
                );
                return (
                  <div className="admin-support-dialog">
                    <div className="admin-support-dialog-header">
                      <button
                        type="button"
                        className="admin-support-back"
                        onClick={() => {
                          setSupportOpenTicketId(null);
                          fetchSupportTickets();
                        }}
                      >
                        ← К тикетам
                      </button>
                      <span className="admin-support-dialog-title">
                        Тикет #{supportOpenTicketId} —{" "}
                        {ticket?.nickname || ticket?.username || "Игрок"}
                      </span>
                      <span
                        className={`admin-support-ticket-status admin-support-ticket-status--${ticket?.status || "open"}`}
                      >
                        {ticket?.status === "closed" ? "Закрыт" : "Открыт"}
                      </span>
                      {ticket?.status === "open" ? (
                        <button
                          type="button"
                          className="admin-support-close-btn"
                          onClick={closeSupportTicket}
                        >
                          Закрыть тикет
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="admin-support-reopen-btn"
                          onClick={reopenSupportTicket}
                        >
                          Переоткрыть
                        </button>
                      )}
                    </div>
                    <div className="admin-support-messages">
                      {supportMessages.length === 0 && (
                        <div className="admin-support-empty">Нет сообщений</div>
                      )}
                      {(() => {
                        let lastD = "";
                        return supportMessages.map((m: any) => {
                          const d = m.createdAt ? new Date(m.createdAt) : null;
                          const dk = d
                            ? `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
                            : "";
                          const showDate = dk !== lastD;
                          if (showDate) lastD = dk;
                          return (
                            <React.Fragment key={m.id}>
                              {showDate && d && (
                                <div className="admin-support-date-sep">
                                  {d.toLocaleDateString("ru-RU", {
                                    day: "numeric",
                                    month: "long",
                                    year: "numeric",
                                  })}
                                </div>
                              )}
                              <div
                                className={`admin-support-msg ${m.senderRole === "user" ? "admin-support-msg--user" : "admin-support-msg--admin"}`}
                              >
                                <div className="admin-support-msg-col">
                                  <div className="admin-support-msg-sender">
                                    {m.senderRole === "user"
                                      ? ticket?.nickname ||
                                        ticket?.username ||
                                        "Игрок"
                                      : "Поддержка"}
                                  </div>
                                  <div className="admin-support-msg-bubble">
                                    <div className="admin-support-msg-body">
                                      <div className="admin-support-msg-text">
                                        {m.text}
                                      </div>
                                      <span className="admin-support-msg-time">
                                        {d
                                          ? d.toLocaleTimeString("ru-RU", {
                                              hour: "2-digit",
                                              minute: "2-digit",
                                            })
                                          : ""}
                                      </span>
                                    </div>
                                  </div>
                                </div>
                              </div>
                            </React.Fragment>
                          );
                        });
                      })()}
                    </div>
                    <div className="admin-support-reply-wrap">
                      <textarea
                        className="admin-support-reply-input"
                        placeholder="Ответить..."
                        value={supportReply}
                        onChange={(e) => setSupportReply(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && !e.shiftKey) {
                            e.preventDefault();
                            sendSupportReply();
                          }
                        }}
                        rows={2}
                      />
                      <button
                        type="button"
                        className="admin-support-reply-btn"
                        disabled={!supportReply.trim() || supportSending}
                        onClick={sendSupportReply}
                      >
                        Отправить
                      </button>
                    </div>
                  </div>
                );
              })()
            ) : (
              <div>
                <div className="admin-support-filter-row">
                  <h3>Обращения</h3>
                  <select
                    className="admin-support-filter-select"
                    value={supportStatusFilter}
                    onChange={(e) => setSupportStatusFilter(e.target.value)}
                  >
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
                          <tr
                            key={t.id}
                            className={
                              Number(t.unreadCount) > 0
                                ? "admin-support-row-unread"
                                : ""
                            }
                          >
                            <td>{t.id}</td>
                            <td className="admin-td-left">
                              {t.nickname || t.username || "—"}
                            </td>
                            <td className="admin-td-left">{t.email || "—"}</td>
                            <td>
                              <span
                                className={`admin-support-ticket-status admin-support-ticket-status--${t.status}`}
                              >
                                {t.status === "open" ? "Открыт" : "Закрыт"}
                              </span>
                            </td>
                            <td className="admin-support-last-text">
                              {t.lastText?.slice(0, 60)}
                              {t.lastText?.length > 60 ? "…" : ""}
                            </td>
                            <td>
                              {t.lastMessageAt
                                ? new Date(t.lastMessageAt).toLocaleString(
                                    "ru-RU",
                                  )
                                : "—"}
                            </td>
                            <td>
                              {Number(t.unreadCount) > 0 ? (
                                <span className="admin-tab-badge">
                                  {t.unreadCount}
                                </span>
                              ) : (
                                "—"
                              )}
                            </td>
                            <td>
                              <button
                                type="button"
                                className="admin-support-open-btn"
                                onClick={() => openSupportTicket(t.id)}
                              >
                                Открыть
                              </button>
                            </td>
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
        {section === "statistics" && (
          <section className="admin-section">
            <div className="admin-stats-subtabs">
              <button
                type="button"
                className={`admin-stats-subtab${statsSubTab === "overview" ? " active" : ""}`}
                onClick={() => {
                  setStatsSubTab("overview");
                  patchQuery({ statsTab: "overview" });
                }}
              >
                Обзор
              </button>
              <button
                type="button"
                className={`admin-stats-subtab${statsSubTab === "transactions" ? " active" : ""}`}
                onClick={() => {
                  setStatsSubTab("transactions");
                  patchQuery({ statsTab: "transactions" });
                }}
              >
                Транзакции
              </button>
              <button
                type="button"
                className={`admin-stats-subtab${statsSubTab === "questions" ? " active" : ""}`}
                onClick={() => {
                  setStatsSubTab("questions");
                  patchQuery({ statsTab: "questions" });
                }}
              >
                Вопросы
              </button>
              <button
                type="button"
                className={`admin-stats-subtab${statsSubTab === "tournaments" ? " active" : ""}`}
                onClick={() => {
                  setStatsSubTab("tournaments");
                  patchQuery({ statsTab: "tournaments" });
                }}
              >
                Турниры
              </button>
              <button
                type="button"
                className={`admin-stats-subtab${statsSubTab === "project-cost" ? " active" : ""}`}
                onClick={() => {
                  setStatsSubTab("project-cost");
                  patchQuery({ statsTab: "project-cost" });
                }}
              >
                Стоимость проекта
              </button>
            </div>
            {statsSubTab === "overview" &&
              (() => {
                const totals = statsData.reduce(
                  (acc, d) => ({
                    registrations: acc.registrations + d.registrations,
                    withdrawals: acc.withdrawals + d.withdrawals,
                    topups: acc.topups + d.topups,
                    gameIncome: acc.gameIncome + d.gameIncome,
                  }),
                  {
                    registrations: 0,
                    withdrawals: 0,
                    topups: 0,
                    gameIncome: 0,
                  },
                );
                const fmt = (n: number) => n.toLocaleString("ru-RU");
                return (
                  <div className="admin-stats-section">
                    <div className="admin-stats-controls">
                      <label>
                        Период:
                        <select
                          value={statsGroupBy}
                          onChange={(e) => {
                            const v = e.target.value as
                              | "day"
                              | "week"
                              | "month"
                              | "all";
                            setStatsGroupBy(v);
                            setSearchParams(
                              (prev) => {
                                const p = new URLSearchParams(prev);
                                p.set("statsGroupBy", v);
                                return p;
                              },
                              { replace: true },
                            );
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
                      const metrics: {
                        key: string;
                        label: string;
                        color: string;
                        yAxisId: string;
                      }[] = [
                        {
                          key: "registrations",
                          label: "Регистрации",
                          color: "#8884d8",
                          yAxisId: "left",
                        },
                        {
                          key: "topups",
                          label: "Пополнения (₽)",
                          color: "#82ca9d",
                          yAxisId: "right",
                        },
                        {
                          key: "withdrawals",
                          label: "Выводы (₽)",
                          color: "#ff7c7c",
                          yAxisId: "right",
                        },
                        {
                          key: "gameIncome",
                          label: "Доход игры (₽)",
                          color: "#ffc658",
                          yAxisId: "right",
                        },
                      ];
                      const toggleMetric = (key: string) => {
                        setStatsMetrics((prev) => {
                          const next = new Set(prev);
                          if (next.has(key)) next.delete(key);
                          else next.add(key);
                          return next;
                        });
                      };
                      const active = metrics.filter((m) =>
                        statsMetrics.has(m.key),
                      );
                      const needLeftAxis = active.some(
                        (m) => m.yAxisId === "left",
                      );
                      const needRightAxis = active.some(
                        (m) => m.yAxisId === "right",
                      );
                      return (
                        <>
                          <div className="admin-stats-kpi">
                            <div
                              className="admin-stats-kpi-card"
                              style={{ borderColor: "#8884d8" }}
                            >
                              <div className="admin-stats-kpi-value">
                                {fmt(totals.registrations)}
                              </div>
                              <div className="admin-stats-kpi-label">
                                Регистрации
                              </div>
                            </div>
                            <div
                              className="admin-stats-kpi-card"
                              style={{ borderColor: "#82ca9d" }}
                            >
                              <div className="admin-stats-kpi-value">
                                {fmt(totals.topups)} ₽
                              </div>
                              <div className="admin-stats-kpi-label">
                                Пополнения
                              </div>
                            </div>
                            <div
                              className="admin-stats-kpi-card"
                              style={{ borderColor: "#ff7c7c" }}
                            >
                              <div className="admin-stats-kpi-value">
                                {fmt(totals.withdrawals)} ₽
                              </div>
                              <div className="admin-stats-kpi-label">
                                Выводы
                              </div>
                            </div>
                            <div
                              className="admin-stats-kpi-card"
                              style={{ borderColor: "#ffc658" }}
                            >
                              <div className="admin-stats-kpi-value">
                                {fmt(totals.gameIncome)} ₽
                              </div>
                              <div className="admin-stats-kpi-label">
                                Доход игры
                              </div>
                            </div>
                          </div>
                          <div className="admin-stats-metrics-toggle">
                            {metrics.map((m) => (
                              <button
                                key={m.key}
                                type="button"
                                className={`admin-stats-metric-btn ${statsMetrics.has(m.key) ? "active" : ""}`}
                                style={
                                  {
                                    "--metric-color": m.color,
                                  } as React.CSSProperties
                                }
                                onClick={() => toggleMetric(m.key)}
                              >
                                <span className="admin-stats-metric-dot" />
                                {m.label}
                              </button>
                            ))}
                            <button
                              type="button"
                              className="admin-stats-metric-reset"
                              onClick={() =>
                                setStatsMetrics((prev) =>
                                  prev.size === metrics.length
                                    ? new Set()
                                    : new Set(metrics.map((m) => m.key)),
                                )
                              }
                            >
                              {statsMetrics.size === metrics.length
                                ? "Сбросить все"
                                : "Выбрать все"}
                            </button>
                          </div>
                          {statsData.length === 0 ? (
                            <p className="admin-stats-empty">
                              Нет данных за выбранный период
                            </p>
                          ) : active.length === 0 ? (
                            <p className="admin-stats-empty">
                              Выберите хотя бы одну метрику
                            </p>
                          ) : (
                            <>
                              <div className="admin-stats-chart">
                                <ResponsiveContainer width="100%" height={400}>
                                  <LineChart
                                    data={statsData}
                                    margin={{
                                      top: 20,
                                      right: 30,
                                      left: 20,
                                      bottom: 5,
                                    }}
                                  >
                                    <CartesianGrid strokeDasharray="3 3" />
                                    <XAxis dataKey="period" />
                                    {needLeftAxis && <YAxis yAxisId="left" />}
                                    {needRightAxis && (
                                      <YAxis
                                        yAxisId="right"
                                        orientation="right"
                                      />
                                    )}
                                    {!needLeftAxis && !needRightAxis && (
                                      <YAxis yAxisId="left" />
                                    )}
                                    <Tooltip
                                      formatter={(
                                        value: number,
                                        name: string,
                                      ) => [
                                        typeof value === "number"
                                          ? value.toLocaleString("ru-RU")
                                          : value,
                                        name,
                                      ]}
                                    />
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
                                      <td>
                                        <strong>Итого</strong>
                                      </td>
                                      <td>
                                        <strong>
                                          {fmt(totals.registrations)}
                                        </strong>
                                      </td>
                                      <td>
                                        <strong>{fmt(totals.topups)} ₽</strong>
                                      </td>
                                      <td>
                                        <strong>
                                          {fmt(totals.withdrawals)} ₽
                                        </strong>
                                      </td>
                                      <td>
                                        <strong>
                                          {fmt(totals.gameIncome)} ₽
                                        </strong>
                                      </td>
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
            {statsSubTab === "transactions" && (
              <div className="admin-stats-section">
                <div className="admin-stats-controls">
                  <label>
                    Тип:
                    <select
                      value={txCategoryFilter}
                      onChange={(e) => {
                        setTxCategoryFilter(
                          e.target.value as
                            | ""
                            | "topup"
                            | "withdraw"
                            | "win"
                            | "other",
                        );
                        txLoadedRef.current = false;
                      }}
                    >
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
                          <TxSortableTh sortKey="userId">
                            Игрок (ID)
                          </TxSortableTh>
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
                            <td className="admin-td-left">
                              {tx.username || "—"}
                            </td>
                            <td className="admin-td-left">{tx.email || "—"}</td>
                            <td>
                              {(() => {
                                const isOtherTopup =
                                  tx.category === "other" &&
                                  /пополнение/i.test(tx.description);
                                const badge = isOtherTopup
                                  ? "topup"
                                  : tx.category;
                                const label =
                                  badge === "topup"
                                    ? "Пополнение"
                                    : badge === "withdraw"
                                      ? "Вывод"
                                      : badge === "win"
                                        ? "Выигрыш"
                                        : badge === "other"
                                          ? "Прочее"
                                          : badge;
                                return (
                                  <span
                                    className={`admin-tx-badge admin-tx-badge--${badge}`}
                                  >
                                    {label}
                                  </span>
                                );
                              })()}
                            </td>
                            <td
                              style={{
                                color: tx.amount >= 0 ? "#1a7f37" : "#cf222e",
                                fontWeight: 600,
                              }}
                            >
                              {tx.amount >= 0 ? "+" : ""}
                              {Number(tx.amount).toFixed(2)} ₽
                            </td>
                            <td className="admin-td-left">
                              {tx.description || "—"}
                            </td>
                            <td>
                              {tx.createdAt
                                ? formatMoscowDateTimeFull(tx.createdAt)
                                : "—"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
            {statsSubTab === "tournaments" && (
              <div className="admin-stats-section">
                <div
                  className="admin-stats-controls admin-stats-controls--tournaments"
                  style={{ marginBottom: 8 }}
                >
                  <label>
                    Поиск по ID турнира:{" "}
                    <input
                      type="text"
                      inputMode="numeric"
                      placeholder="Введите ID турнира"
                      value={tournamentIdFilter}
                      onChange={(e) => {
                        const v = e.target.value.trim();
                        setTournamentIdFilter(v);
                        setSearchParams(
                          (p) => {
                            const n = new URLSearchParams(p);
                            if (v) n.set("tournamentId", v);
                            else n.delete("tournamentId");
                            return n;
                          },
                          { replace: true },
                        );
                      }}
                      style={{ width: 160 }}
                    />
                  </label>
                </div>
                {tournamentsListLoading && !tournamentsListLoadedRef.current ? (
                  <p>Загрузка...</p>
                ) : tournamentsListError ? (
                  <p className="admin-error">{tournamentsListError}</p>
                ) : (
                  (() => {
                    const filtered = tournamentIdFilter
                      ? tournamentsList.filter(
                          (r) => String(r.tournamentId) === tournamentIdFilter,
                        )
                      : tournamentsList;
                    if (filtered.length === 0) {
                      return (
                        <p className="admin-stats-empty">
                          {tournamentIdFilter
                            ? "Нет записей по этому ID турнира"
                            : "Нет данных о турнирах"}
                        </p>
                      );
                    }
                    return (
                      <div className="admin-table-wrap admin-table-wrap--tournaments">
                        <table className="admin-table admin-table--tournaments">
                          <thead>
                            <tr>
                              {tournamentColumns.map((column) => (
                                <th
                                  key={column}
                                  className={
                                    [
                                      dragOverTournamentColumn === column
                                        ? "admin-tournament-th-drop-target"
                                        : "",
                                      column === "tournamentId"
                                        ? "admin-tournament-col-id"
                                        : "",
                                    ]
                                      .filter(Boolean)
                                      .join(" ") || undefined
                                  }
                                  onDragOver={(e) => {
                                    if (
                                      !draggedTournamentColumn ||
                                      draggedTournamentColumn === column
                                    )
                                      return;
                                    e.preventDefault();
                                    e.dataTransfer.dropEffect = "move";
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
                                    if (
                                      !draggedTournamentColumn ||
                                      draggedTournamentColumn === column
                                    )
                                      return;
                                    reorderTournamentColumns(
                                      draggedTournamentColumn,
                                      column,
                                    );
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
                                        e.dataTransfer.effectAllowed = "move";
                                        e.dataTransfer.setData(
                                          "text/plain",
                                          column,
                                        );
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
                              <tr
                                key={`${row.tournamentId}-${row.userId}-${idx}`}
                              >
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
                  })()
                )}
              </div>
            )}
            {statsSubTab === "project-cost" && (
              <div className="admin-stats-section">
                {projectCostLoading && !projectCostLoadedRef.current ? (
                  <p>Загрузка...</p>
                ) : (
                  (() => {
                    const dashboard = projectCostData ?? {
                      currentTotal: 0,
                      todayTotal: 0,
                      updatedAt: null,
                      totalDurationMinutes: 0,
                      totalDurationLabel: "0 мин",
                      history: [],
                    };
                    const latestChange =
                      dashboard.history[0]?.amountChange ?? 0;
                    return (
                      <>
                        <div className="admin-cost-hero">
                          <div className="admin-cost-hero-label">
                            Стоимость проекта
                          </div>
                          <div className="admin-cost-hero-value">
                            {formatRubles(dashboard.currentTotal)}
                          </div>
                        </div>

                        <div className="admin-stats-kpi admin-cost-kpi">
                          <div
                            className="admin-stats-kpi-card admin-cost-kpi-card"
                            style={{ borderColor: "#0f766e" }}
                          >
                            <div className="admin-stats-kpi-value">
                              {formatRubles(dashboard.todayTotal)}
                            </div>
                            <div className="admin-stats-kpi-label">
                              За сегодня
                            </div>
                          </div>
                          <div
                            className="admin-stats-kpi-card admin-cost-kpi-card"
                            style={{ borderColor: "#1d4ed8" }}
                          >
                            <div className="admin-stats-kpi-value">
                              +{formatRubles(latestChange).replace(" ₽", "")} ₽
                            </div>
                            <div className="admin-stats-kpi-label">
                              Последнее изменение
                            </div>
                          </div>
                          <div
                            className="admin-stats-kpi-card admin-cost-kpi-card"
                            style={{ borderColor: "#7c3aed" }}
                          >
                            <div className="admin-stats-kpi-value">
                              {dashboard.history.length.toLocaleString("ru-RU")}
                            </div>
                            <div className="admin-stats-kpi-label">
                              Записей в истории
                            </div>
                          </div>
                          <div
                            className="admin-stats-kpi-card admin-cost-kpi-card"
                            style={{ borderColor: "var(--gold-dark, #c9a227)" }}
                          >
                            <div className="admin-stats-kpi-value">
                              {dashboard.totalDurationLabel}
                            </div>
                            <div className="admin-stats-kpi-label">
                              Общее время по проекту
                            </div>
                          </div>
                        </div>

                        <div className="admin-cost-updated-inline">
                          Обновлено автоматически:{" "}
                          {dashboard.updatedAt
                            ? formatMoscowDateTimeFull(dashboard.updatedAt)
                            : "—"}
                        </div>

                        {dashboard.history.length === 0 ? (
                          <p className="admin-stats-empty">
                            История стоимости пока пуста
                          </p>
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
                                  <tr
                                    key={`${row.date}-${row.time ?? "na"}-${idx}`}
                                  >
                                    <td>{row.date}</td>
                                    <td>{row.time ?? "—"}</td>
                                    <td className="admin-cost-change">
                                      +{formatRubles(row.amountChange)}
                                    </td>
                                    <td className="admin-cost-after">
                                      {formatRubles(row.afterAmount)}
                                    </td>
                                    <td>{row.duration}</td>
                                    <td className="admin-td-left admin-cost-description">
                                      {row.description}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </>
                    );
                  })()
                )}
              </div>
            )}
            {statsSubTab === "questions" && (
              <div className="admin-stats-section">
                {questionStatsLoading && !questionStatsLoadedRef.current ? (
                  <p>Загрузка...</p>
                ) : questionStats.length === 0 ? (
                  <p className="admin-stats-empty">Нет данных о вопросах</p>
                ) : (
                  (() => {
                    const totalQuestions = questionStats.reduce(
                      (s, r) => s + r.count,
                      0,
                    );
                    const toggleSort = (col: "topic" | "count") => {
                      if (qsSortBy === col)
                        setQsSortDir((d) => (d === "asc" ? "desc" : "asc"));
                      else {
                        setQsSortBy(col);
                        setQsSortDir(col === "count" ? "desc" : "asc");
                      }
                    };
                    const arrow = (col: "topic" | "count") =>
                      qsSortBy === col
                        ? qsSortDir === "asc"
                          ? " ▲"
                          : " ▼"
                        : "";
                    return (
                      <>
                        <div
                          className="admin-stats-kpi"
                          style={{ marginBottom: 16 }}
                        >
                          <div
                            className="admin-stats-kpi-card"
                            style={{ borderColor: "#8884d8" }}
                          >
                            <div className="admin-stats-kpi-value">
                              {totalQuestions.toLocaleString("ru-RU")}
                            </div>
                            <div className="admin-stats-kpi-label">
                              Всего вопросов
                            </div>
                          </div>
                          <div
                            className="admin-stats-kpi-card"
                            style={{ borderColor: "#82ca9d" }}
                          >
                            <div className="admin-stats-kpi-value">
                              {questionStats.length}
                            </div>
                            <div className="admin-stats-kpi-label">
                              Категорий
                            </div>
                          </div>
                        </div>
                        <div className="admin-table-wrap">
                          <table className="admin-table">
                            <thead>
                              <tr>
                                <th style={{ width: 50, textAlign: "center" }}>
                                  №
                                </th>
                                <th
                                  style={{
                                    cursor: "pointer",
                                    userSelect: "none",
                                  }}
                                  onClick={() => toggleSort("topic")}
                                >
                                  Категория{arrow("topic")}
                                </th>
                                <th
                                  style={{
                                    cursor: "pointer",
                                    userSelect: "none",
                                    textAlign: "center",
                                  }}
                                  onClick={() => toggleSort("count")}
                                >
                                  Вопросов{arrow("count")}
                                </th>
                              </tr>
                            </thead>
                            <tbody>
                              {sortedQuestionStats.map((row, i) => (
                                <tr key={row.topic}>
                                  <td style={{ textAlign: "center" }}>
                                    {i + 1}
                                  </td>
                                  <td className="admin-td-left">
                                    {topicNames[row.topic] || row.topic}
                                  </td>
                                  <td
                                    style={{
                                      textAlign: "center",
                                      fontWeight: 600,
                                    }}
                                  >
                                    {row.count.toLocaleString("ru-RU")}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </>
                    );
                  })()
                )}
              </div>
            )}
          </section>
        )}
        {section === "news" && (
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
                      <svg
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
                      </svg>
                      Сгенерировать
                    </>
                  )}
                </button>
                <button
                  type="button"
                  className="admin-news-publish-btn"
                  disabled={newsCreating}
                  onClick={() => {
                    if (!newsTopic.trim()) {
                      setNewsError("Введите заголовок");
                      return;
                    }
                    if (!newsBody.trim()) {
                      setNewsError("Введите текст новости");
                      return;
                    }
                    setNewsError("");
                    setNewsPublishConfirm(true);
                  }}
                >
                  {newsCreating ? "Публикация..." : "Опубликовать"}
                </button>
              </div>
            </div>
            <div className="admin-news-list-section">
              <h3>Все новости ({newsList.length})</h3>
              {newsLoading && newsList.length === 0 && <p>Загрузка...</p>}
              {!newsLoading && newsList.length === 0 && (
                <p className="admin-stats-empty">Новостей пока нет</p>
              )}
              {newsList.map((item) => (
                <div
                  key={item.id}
                  className={`admin-news-card ${!item.published ? "unpublished" : ""}`}
                >
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
                        <button
                          type="button"
                          onClick={() => handleSaveEdit(item.id)}
                          className="admin-news-save-btn"
                        >
                          Сохранить
                        </button>
                        <button
                          type="button"
                          onClick={() => setNewsEditId(null)}
                          className="admin-news-cancel-btn"
                        >
                          Отмена
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="admin-news-card-header">
                        <strong>{item.topic}</strong>
                        <span className="admin-news-card-date">
                          {new Date(item.createdAt).toLocaleDateString("ru-RU")}
                        </span>
                        {!item.published && (
                          <span className="admin-news-draft-badge">Скрыта</span>
                        )}
                      </div>
                      <p className="admin-news-card-body">{item.body}</p>
                      <div className="admin-news-card-actions">
                        <button
                          type="button"
                          onClick={() => {
                            setNewsEditId(item.id);
                            setNewsEditTopic(item.topic);
                            setNewsEditBody(item.body);
                          }}
                        >
                          Редактировать
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            handleTogglePublish(item.id, item.published)
                          }
                        >
                          {item.published ? "Скрыть" : "Опубликовать"}
                        </button>
                        <button
                          type="button"
                          className="admin-news-delete-btn"
                          onClick={() => setNewsDeleteConfirmId(item.id)}
                        >
                          Удалить
                        </button>
                      </div>
                    </>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}
        {impersonateConfirm && (
          <div
            className="admin-modal-overlay"
            onClick={() => setImpersonateConfirm(null)}
          >
            <div className="admin-modal" onClick={(e) => e.stopPropagation()}>
              <p className="admin-modal-text">{confirmImpersonateLabel}</p>
              <p className="admin-modal-text">
                Пользователь: <strong>{impersonateConfirm.username}</strong> (ID{" "}
                {impersonateConfirm.userId})
              </p>
              <div className="admin-modal-actions">
                <button
                  type="button"
                  className="admin-modal-cancel"
                  onClick={() => setImpersonateConfirm(null)}
                >
                  Отмена
                </button>
                <button
                  type="button"
                  className="admin-modal-confirm admin-modal-confirm--publish"
                  onClick={() => {
                    const target = impersonateConfirm;
                    setImpersonateConfirm(null);
                    if (target) void handleImpersonate(target.userId);
                  }}
                >
                  Да, перейти
                </button>
              </div>
            </div>
          </div>
        )}
        {newsPublishConfirm && (
          <div
            className="admin-modal-overlay"
            onClick={() => setNewsPublishConfirm(false)}
          >
            <div className="admin-modal" onClick={(e) => e.stopPropagation()}>
              <p className="admin-modal-text">Опубликовать новость?</p>
              <div className="admin-modal-actions">
                <button
                  type="button"
                  className="admin-modal-cancel"
                  onClick={() => setNewsPublishConfirm(false)}
                >
                  Отмена
                </button>
                <button
                  type="button"
                  className="admin-modal-confirm admin-modal-confirm--publish"
                  onClick={() => {
                    setNewsPublishConfirm(false);
                    handleCreateNews();
                  }}
                >
                  Опубликовать
                </button>
              </div>
            </div>
          </div>
        )}
        {newsDeleteConfirmId !== null && (
          <div
            className="admin-modal-overlay"
            onClick={() => setNewsDeleteConfirmId(null)}
          >
            <div className="admin-modal" onClick={(e) => e.stopPropagation()}>
              <p className="admin-modal-text">
                Вы уверены, что хотите удалить эту новость?
              </p>
              <div className="admin-modal-actions">
                <button
                  type="button"
                  className="admin-modal-cancel"
                  onClick={() => setNewsDeleteConfirmId(null)}
                >
                  Отмена
                </button>
                <button
                  type="button"
                  className="admin-modal-confirm"
                  onClick={() => handleDeleteNews(newsDeleteConfirmId)}
                >
                  Удалить
                </button>
              </div>
            </div>
          </div>
        )}
        <TournamentBracketModal
          variant="admin"
          bracketView={bracketView}
          bracketLoading={bracketLoading}
          bracketError={bracketError}
          token={token}
          onClose={closeBracket}
          bracketPlayerTooltip={bracketPlayerTooltip}
          setBracketPlayerTooltip={setBracketPlayerTooltip}
          bracketLeftColRef={bracketLeftColRef}
          bracketFinalBlockRef={bracketFinalBlockRef}
          bracketBlocksEqualized={bracketBlocksEqualized}
        />
        <TournamentQuestionsModal
          variant="admin"
          questionsReviewTournamentId={questionsReviewTournamentId}
          questionsReviewLoading={questionsReviewLoading}
          questionsReviewError={questionsReviewError}
          questionsReviewData={questionsReviewData}
          closeQuestionsReview={closeQuestionsReview}
          questionsReviewRound={questionsReviewRound}
          questionsReviewTabIdx={questionsReviewTabIdx}
          setQuestionsReviewTabIdx={setQuestionsReviewTabIdx}
          loadOppStats={loadOppStats}
          oppTooltip={oppTooltip}
          setOppTooltip={setOppTooltip}
        />
      </div>
    </div>
  );
};

export default Admin;
