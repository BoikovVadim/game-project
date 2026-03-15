import { parseAdminTopupDescription } from './ruble-ledger-descriptions';

export type LedgerBalanceState = {
  rubles: number;
  balanceL: number;
};

export type LedgerBalanceRow = {
  category: string;
  amount: number | string;
  description: string | null;
  tournamentId: number | null;
};

export type TransactionTimelineRow = LedgerBalanceRow & {
  id: number;
  createdAt: Date | string;
};

/** Транзакции «Возврат по отклонённой заявке» не показываем и не учитываем в балансе. */
export function isRejectedWithdrawalRefund(
  description: string | null,
  category: string,
): boolean {
  if (category !== 'refund' || !description) return false;
  const d = description.toLowerCase().replace(/ё/g, 'е');
  return (
    (d.includes('отклонен') && (d.includes('заявк') || d.includes('вывод'))) ||
    d.includes('возврат по отклонен') ||
    (d.includes('возврат') &&
      d.includes('заявк') &&
      (d.includes('вывод') || d.includes('отклонен')))
  );
}

/** Refund, связанные с L/турнирами: не учитывать в балансе в рублях. */
export function isNonRublesRefund(
  description: string | null,
  category: string,
  tournamentId?: number | null,
): boolean {
  if (category !== 'refund') return false;
  if (tournamentId != null) return true;
  if (!description) return false;
  const d = description.toLowerCase().replace(/ё/g, 'е');
  return (
    d.includes('турнир') ||
    d.includes('возврат за турнир') ||
    d.includes('возврат взноса') ||
    d.includes('лига')
  );
}

export function applyLedgerTransactionToBalanceState(
  current: LedgerBalanceState,
  row: LedgerBalanceRow,
): LedgerBalanceState {
  const next: LedgerBalanceState = {
    rubles: current.rubles,
    balanceL: current.balanceL,
  };
  const amount = Number(row.amount);
  const parsedAdminTopup = parseAdminTopupDescription(row.description);
  const isLegacyRublesOtherAdminTopup =
    row.category === 'other' && parsedAdminTopup.adminId != null;

  if (
    ['topup', 'admin_credit', 'withdraw', 'refund', 'convert', 'other'].includes(
      row.category,
    )
  ) {
    if (row.category !== 'other' || isLegacyRublesOtherAdminTopup) {
      if (
        !isRejectedWithdrawalRefund(row.description, row.category) &&
        !isNonRublesRefund(row.description, row.category, row.tournamentId)
      ) {
        next.rubles += row.category === 'convert' ? -amount : amount;
      }
    }
  }

  if (
    ['win', 'loss', 'referral', 'other', 'convert', 'refund'].includes(
      row.category,
    )
  ) {
    if (row.category === 'other' && isLegacyRublesOtherAdminTopup) {
      return next;
    }
    if (isRejectedWithdrawalRefund(row.description, row.category)) {
      return next;
    }
    if (
      row.category === 'refund' &&
      !isNonRublesRefund(row.description, row.category, row.tournamentId)
    ) {
      return next;
    }
    next.balanceL += amount;
  }

  return next;
}

export function sortTransactionsByTimeline<T extends TransactionTimelineRow>(
  rows: readonly T[],
): T[] {
  return [...rows].sort((a, b) => {
    const timeDiff =
      new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    return timeDiff !== 0 ? timeDiff : a.id - b.id;
  });
}

export function buildTransactionHistoryWithBalances<
  T extends TransactionTimelineRow,
>(rows: readonly T[]): Array<{
  transaction: T;
  balanceAfterRubles: number;
  balanceAfterL: number;
}> {
  let running: LedgerBalanceState = { rubles: 0, balanceL: 0 };
  return sortTransactionsByTimeline(rows).map((transaction) => {
    running = applyLedgerTransactionToBalanceState(running, transaction);
    return {
      transaction,
      balanceAfterRubles: running.rubles,
      balanceAfterL: running.balanceL,
    };
  });
}
