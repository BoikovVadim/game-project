import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { formatMoscowDateTimeFull } from './dateUtils.ts';
import './Admin.css';

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
  const [section, setSection] = useState<'withdrawals' | 'users' | 'credit' | 'support' | 'statistics'>(() =>
    tabFromUrl === 'users' ? 'users' : tabFromUrl === 'credit' ? 'credit' : tabFromUrl === 'support' ? 'support' : tabFromUrl === 'statistics' ? 'statistics' : 'withdrawals'
  );
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
    if (status === 'pending' || status === 'approved' || status === 'rejected' || status === '') {
      setWithdrawalStatusFilter(status);
    }
    if (groupBy === 'day' || groupBy === 'week' || groupBy === 'month' || groupBy === 'all') {
      setStatsGroupBy(groupBy);
    }
  }, [searchParams]);

  const setSectionAndUrl = (next: 'withdrawals' | 'users' | 'credit' | 'support' | 'statistics') => {
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
    if (!isAdmin || !token || section !== 'users') return;
    const loadPending = () => {
      axios.get<WithdrawalRequestRow[]>(`/admin/withdrawal-requests?status=pending`, { headers })
        .then((res) => setPendingWithdrawalsCount(Array.isArray(res.data) ? res.data.length : 0))
        .catch(() => setPendingWithdrawalsCount(0));
    };
    loadPending();
    const interval = setInterval(loadPending, 2000);
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
      <header className="admin-panel-header cabinet-header">
        <div className="cabinet-header-left">
          <span className="admin-header-title">Админ-панель</span>
        </div>
        <div className="cabinet-header-center" />
        <div className="cabinet-header-right">
          <Link to="/profile" className="admin-header-cabinet-link">Вернуться в кабинет</Link>
        </div>
      </header>
      <div className="admin-work-area">
      <nav className="admin-tabs">
        <div className="admin-tabs-left">
          <button type="button" className={section === 'users' ? 'active' : ''} onClick={() => setSectionAndUrl('users')}>
            Пользователи
          </button>
          <button type="button" className={section === 'withdrawals' ? 'active' : ''} onClick={() => setSectionAndUrl('withdrawals')}>
            Заявки на вывод
            {pendingWithdrawalsCount > 0 && (
              <span className="admin-tab-badge" aria-label={`Ожидают: ${pendingWithdrawalsCount}`}>
                {pendingWithdrawalsCount}
              </span>
            )}
          </button>
          <button type="button" className={section === 'credit' ? 'active' : ''} onClick={() => setSectionAndUrl('credit')}>
            Начисление
          </button>
          <button type="button" className={section === 'support' ? 'active' : ''} onClick={() => setSectionAndUrl('support')}>
            Тех. поддержка
            {supportUnreadCount > 0 && (
              <span className="admin-tab-badge" aria-label={`Непрочитано: ${supportUnreadCount}`}>
                {supportUnreadCount}
              </span>
            )}
          </button>
          <button type="button" className={section === 'statistics' ? 'active' : ''} onClick={() => setSectionAndUrl('statistics')}>
            Статистика
          </button>
        </div>
      </nav>
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
                          {!u.isAdmin && (
                            <button type="button" className="admin-btn-make-admin" onClick={() => handleSetAdmin(u.id, true)}>Сделать админом</button>
                          )}
                          {u.isAdmin && (
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
          {(() => {
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
              {statsData.length === 0 ? (
                <p className="admin-stats-empty">Нет данных за выбранный период</p>
              ) : (
                <>
                  <div className="admin-stats-chart">
                    <ResponsiveContainer width="100%" height={400}>
                      <BarChart data={statsData} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="period" />
                        <YAxis yAxisId="left" />
                        <YAxis yAxisId="right" orientation="right" />
                        <Tooltip formatter={(value: number, name: string) => [typeof value === 'number' ? value.toLocaleString('ru-RU') : value, name]} />
                        <Legend />
                        <Bar yAxisId="left" dataKey="registrations" name="Регистрации" fill="#8884d8" />
                        <Bar yAxisId="right" dataKey="withdrawals" name="Выводы (₽)" fill="#ff7c7c" />
                        <Bar yAxisId="right" dataKey="topups" name="Пополнения (₽)" fill="#82ca9d" />
                        <Bar yAxisId="right" dataKey="gameIncome" name="Доход игры (₽)" fill="#ffc658" />
                      </BarChart>
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
                        {statsData.map((d) => (
                          <tr key={d.period}>
                            <td>{d.period}</td>
                            <td>{fmt(d.registrations)}</td>
                            <td>{fmt(d.topups)}</td>
                            <td>{fmt(d.withdrawals)}</td>
                            <td>{fmt(d.gameIncome)}</td>
                          </tr>
                        ))}
                        <tr className="admin-stats-totals-row">
                          <td><strong>Итого</strong></td>
                          <td><strong>{fmt(totals.registrations)}</strong></td>
                          <td><strong>{fmt(totals.topups)} ₽</strong></td>
                          <td><strong>{fmt(totals.withdrawals)} ₽</strong></td>
                          <td><strong>{fmt(totals.gameIncome)} ₽</strong></td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </div>
            );
          })()}
        </section>
      )}
      </div>
    </div>
  );
};

export default Admin;
