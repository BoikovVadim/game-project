import * as dotenv from 'dotenv';
dotenv.config();

import { promises as fs } from 'fs';
import { NestFactory } from '@nestjs/core';
import { DataSource } from 'typeorm';
import { AppModule } from '../app.module';
import { UsersService } from '../users/users.service';
import {
  parseAdminTopupDescription,
  parseAnyWithdrawalDescription,
  parsePaymentTopupDescription,
} from '../users/ruble-ledger-descriptions';

type BasicUserRow = {
  id: number;
  username: string;
  email: string;
  balance: number | string | null;
  balanceRubles: number | string | null;
  createdAt: string | Date;
};

type TxRow = {
  id: number;
  userId: number;
  amount: number | string;
  category: string;
  description: string | null;
  tournamentId: number | null;
  createdAt: string | Date;
};

type PaymentRow = {
  id: number;
  userId: number;
  amount: number | string;
  provider: 'yookassa' | 'robokassa';
  externalId: string | null;
  status: string;
  createdAt: string | Date;
};

type WithdrawalRow = {
  id: number;
  userId: number;
  amount: number | string;
  status: string;
  createdAt: string | Date;
  processedAt: string | Date | null;
};

type EscrowRow = {
  id: number;
  userId: number;
  tournamentId: number;
  amount: number | string;
  status: string;
  createdAt: string | Date;
};

type TournamentRow = {
  id: number;
  status: string;
  gameType: string | null;
  leagueAmount: number | null;
  createdAt: string | Date;
};

type ResultRow = {
  id: number;
  userId: number;
  tournamentId: number;
  passed: number;
  completedAt: string | Date | null;
};

type EntryRow = {
  id: number;
  userId: number;
  tournamentId: number;
  joinedAt: string | Date;
};

type AuditIssue = Record<string, unknown>;

function getArgValue(flag: string): string | null {
  const index = process.argv.indexOf(flag);
  if (index < 0) return null;
  return process.argv[index + 1] ?? null;
}

async function maybeWrite(
  targetPath: string | null,
  content: string,
): Promise<void> {
  if (!targetPath) return;
  await fs.writeFile(targetPath, content, 'utf8');
}

function toIso(value: string | Date | null | undefined): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toISOString();
}

function toMillis(value: string | Date | null | undefined): number | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.getTime();
}

function pushIssue(
  bucket: Record<string, AuditIssue[]>,
  kind: string,
  issue: AuditIssue,
): void {
  if (!bucket[kind]) bucket[kind] = [];
  bucket[kind]!.push(issue);
}

function buildMarkdown(report: {
  generatedAt: string;
  summary: {
    totalUsers: number;
    deterministicIssueCount: number;
    manualReviewCount: number;
    issueCounts: Record<string, number>;
  };
  deterministicIssues: Record<string, AuditIssue[]>;
  manualReview: Record<string, AuditIssue[]>;
}): string {
  const lines: string[] = [];
  lines.push('# Finance Audit');
  lines.push('');
  lines.push(`Generated at: ${report.generatedAt}`);
  lines.push('');
  lines.push('## Summary');
  lines.push(`- Users audited: ${report.summary.totalUsers}`);
  lines.push(
    `- Deterministic issues: ${report.summary.deterministicIssueCount}`,
  );
  lines.push(`- Manual review issues: ${report.summary.manualReviewCount}`);
  lines.push('');
  lines.push('## Issue Counts');
  for (const [kind, count] of Object.entries(report.summary.issueCounts).sort()) {
    lines.push(`- ${kind}: ${count}`);
  }
  const appendBucket = (
    title: string,
    bucket: Record<string, AuditIssue[]>,
  ): void => {
    lines.push('');
    lines.push(`## ${title}`);
    const entries = Object.entries(bucket).filter(([, items]) => items.length > 0);
    if (entries.length === 0) {
      lines.push('- none');
      return;
    }
    for (const [kind, items] of entries) {
      lines.push(`- ${kind}: ${items.length}`);
      for (const item of items.slice(0, 5)) {
        lines.push(`  - ${JSON.stringify(item)}`);
      }
      if (items.length > 5) {
        lines.push(`  - ... and ${items.length - 5} more`);
      }
    }
  };
  appendBucket('Deterministic Issues', report.deterministicIssues);
  appendBucket('Manual Review', report.manualReview);
  return lines.join('\n');
}

async function main() {
  const jsonOut = getArgValue('--json-out');
  const mdOut = getArgValue('--md-out');

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: false,
  });

  try {
    const dataSource = app.get(DataSource);
    const usersService = app.get(UsersService);

    const users = (await dataSource.query(
      `SELECT id, username, email, balance, "balanceRubles", "createdAt"
       FROM "user"
       ORDER BY id ASC`,
    )) as BasicUserRow[];
    const userIds = users.map((user) => Number(user.id)).filter((id) => id > 0);
    const computed = await usersService.getComputedBalanceMapsForUsers(userIds);

    const txRows = (await dataSource.query(
      `SELECT id, "userId", amount, category, description, "tournamentId", "createdAt"
       FROM "transaction"
       ORDER BY id ASC`,
    )) as TxRow[];
    const paymentRows = (await dataSource.query(
      `SELECT id, "userId", amount, provider, "externalId", status, "createdAt"
       FROM payment
       ORDER BY id ASC`,
    )) as PaymentRow[];
    const withdrawalRows = (await dataSource.query(
      `SELECT id, "userId", amount, status, "createdAt", "processedAt"
       FROM withdrawal_request
       ORDER BY id ASC`,
    )) as WithdrawalRow[];
    const escrowRows = (await dataSource.query(
      `SELECT id, "userId", "tournamentId", amount, status, "createdAt"
       FROM tournament_escrow
       ORDER BY id ASC`,
    )) as EscrowRow[];
    const tournamentRows = (await dataSource.query(
      `SELECT id, status, "gameType", "leagueAmount", "createdAt"
       FROM tournament
       ORDER BY id ASC`,
    )) as TournamentRow[];
    const resultRows = (await dataSource.query(
      `SELECT id, "userId", "tournamentId", passed, "completedAt"
       FROM tournament_result
       ORDER BY id ASC`,
    )) as ResultRow[];
    const entryRows = (await dataSource.query(
      `SELECT id, "userId", "tournamentId", "joinedAt"
       FROM tournament_entry
       ORDER BY id ASC`,
    )) as EntryRow[];

    const deterministicIssues: Record<string, AuditIssue[]> = {};
    const manualReview: Record<string, AuditIssue[]> = {};

    const withdrawTxByRequestId = new Map<number, TxRow[]>();
    const refundTxByUserTournament = new Map<string, TxRow[]>();
    const winTxByTournamentUser = new Map<string, TxRow[]>();
    const referralTxByTournament = new Map<number, TxRow[]>();
    const topupRows = txRows.filter((row) => row.category === 'topup');
    const escrowByUserTournament = new Map<string, EscrowRow[]>();
    const earliestEventByUser = new Map<number, number>();

    for (const row of txRows) {
      const createdAtMs = toMillis(row.createdAt);
      if (createdAtMs != null) {
        const current = earliestEventByUser.get(Number(row.userId));
        if (current == null || createdAtMs < current) {
          earliestEventByUser.set(Number(row.userId), createdAtMs);
        }
      }
      if (row.category === 'withdraw') {
        const requestId = parseAnyWithdrawalDescription(row.description).requestId;
        if (requestId != null) {
          const list = withdrawTxByRequestId.get(requestId) ?? [];
          list.push(row);
          withdrawTxByRequestId.set(requestId, list);
        }
      }
      if (row.category === 'refund' && row.tournamentId != null) {
        const key = `${row.userId}:${row.tournamentId}`;
        const list = refundTxByUserTournament.get(key) ?? [];
        list.push(row);
        refundTxByUserTournament.set(key, list);
      }
      if (row.category === 'win' && row.tournamentId != null) {
        const key = `${row.userId}:${row.tournamentId}`;
        const list = winTxByTournamentUser.get(key) ?? [];
        list.push(row);
        winTxByTournamentUser.set(key, list);
      }
      if (row.category === 'referral' && row.tournamentId != null) {
        const list = referralTxByTournament.get(row.tournamentId) ?? [];
        list.push(row);
        referralTxByTournament.set(row.tournamentId, list);
      }
    }

    for (const row of paymentRows) {
      const createdAtMs = toMillis(row.createdAt);
      if (createdAtMs != null) {
        const current = earliestEventByUser.get(Number(row.userId));
        if (current == null || createdAtMs < current) {
          earliestEventByUser.set(Number(row.userId), createdAtMs);
        }
      }
    }
    for (const row of withdrawalRows) {
      const createdAtMs = toMillis(row.createdAt);
      if (createdAtMs != null) {
        const current = earliestEventByUser.get(Number(row.userId));
        if (current == null || createdAtMs < current) {
          earliestEventByUser.set(Number(row.userId), createdAtMs);
        }
      }
    }
    for (const row of entryRows) {
      const createdAtMs = toMillis(row.joinedAt);
      if (createdAtMs != null) {
        const current = earliestEventByUser.get(Number(row.userId));
        if (current == null || createdAtMs < current) {
          earliestEventByUser.set(Number(row.userId), createdAtMs);
        }
      }
    }
    for (const row of escrowRows) {
      const key = `${row.userId}:${row.tournamentId}`;
      const list = escrowByUserTournament.get(key) ?? [];
      list.push(row);
      escrowByUserTournament.set(key, list);
      const createdAtMs = toMillis(row.createdAt);
      if (createdAtMs != null) {
        const current = earliestEventByUser.get(Number(row.userId));
        if (current == null || createdAtMs < current) {
          earliestEventByUser.set(Number(row.userId), createdAtMs);
        }
      }
    }
    for (const row of resultRows) {
      const createdAtMs = toMillis(row.completedAt);
      if (createdAtMs != null) {
        const current = earliestEventByUser.get(Number(row.userId));
        if (current == null || createdAtMs < current) {
          earliestEventByUser.set(Number(row.userId), createdAtMs);
        }
      }
    }

    for (const user of users) {
      const userId = Number(user.id);
      const computedL = computed.balanceL.get(userId) ?? 0;
      const computedRubles = computed.rubles.get(userId) ?? 0;
      const storedL = Number(user.balance ?? 0);
      const storedRubles = Number(user.balanceRubles ?? 0);
      if (storedL !== computedL || storedRubles !== computedRubles) {
        pushIssue(deterministicIssues, 'stored_vs_ledger_mismatch', {
          userId,
          username: user.username,
          storedBalance: storedL,
          computedBalance: computedL,
          storedBalanceRubles: storedRubles,
          computedBalanceRubles: computedRubles,
          reservedBalance: computed.heldEscrow.get(userId) ?? 0,
        });
      }
      const earliestEvent = earliestEventByUser.get(userId);
      const createdAtMs = toMillis(user.createdAt);
      if (
        earliestEvent != null &&
        createdAtMs != null &&
        earliestEvent < createdAtMs - 60_000
      ) {
        pushIssue(manualReview, 'swap_id_inconsistency', {
          userId,
          username: user.username,
          userCreatedAt: toIso(user.createdAt),
          earliestFinancialEventAt: new Date(earliestEvent).toISOString(),
        });
      }
    }

    for (const payment of paymentRows) {
      if (payment.status !== 'succeeded') continue;
      const structuredPayment = UsersService.buildPaymentTopupDescription(
        payment.provider,
        Number(payment.id),
        payment.externalId,
      );
      const paymentTime = toMillis(payment.createdAt) ?? 0;
      const hasMatch = topupRows.some((row) => {
        if (Number(row.userId) !== Number(payment.userId)) return false;
        if (Math.abs(Number(row.amount) - Number(payment.amount)) >= 0.01) {
          return false;
        }
        const parsed = parsePaymentTopupDescription(row.description);
        if (
          parsed.paymentId === Number(payment.id) &&
          parsed.provider === payment.provider
        ) {
          return true;
        }
        const desc = String(row.description ?? '').trim();
        if (!desc) return false;
        if (parseAdminTopupDescription(desc).adminId != null) return false;
        if (!desc.toLowerCase().includes('пополнение')) return false;
        const txTime = toMillis(row.createdAt) ?? 0;
        return Math.abs(txTime - paymentTime) <= 24 * 60 * 60 * 1000;
      });
      if (!hasMatch) {
        pushIssue(deterministicIssues, 'succeeded_payment_without_topup', {
          paymentId: Number(payment.id),
          userId: Number(payment.userId),
          amount: Number(payment.amount),
          provider: payment.provider,
          externalId: payment.externalId,
          createdAt: toIso(payment.createdAt),
          expectedDescription: structuredPayment,
        });
      }
    }

    for (const request of withdrawalRows) {
      const requestId = Number(request.id);
      const matchingWithdrawTx = withdrawTxByRequestId.get(requestId) ?? [];
      if (request.status === 'approved' && matchingWithdrawTx.length === 0) {
        pushIssue(deterministicIssues, 'approved_withdraw_without_tx', {
          requestId,
          userId: Number(request.userId),
          amount: Number(request.amount),
          createdAt: toIso(request.createdAt),
        });
      }
      if (matchingWithdrawTx.length > 1) {
        pushIssue(manualReview, 'duplicate_withdraw_tx', {
          requestId,
          userId: Number(request.userId),
          transactionIds: matchingWithdrawTx.map((row) => Number(row.id)),
        });
      }
      if (request.status === 'rejected' && matchingWithdrawTx.length > 0) {
        pushIssue(manualReview, 'rejected_withdraw_with_wrong_refund', {
          requestId,
          userId: Number(request.userId),
          transactionIds: matchingWithdrawTx.map((row) => Number(row.id)),
        });
      }
    }

    for (const row of txRows) {
      if (row.category === 'loss' && row.tournamentId != null) {
        const key = `${row.userId}:${row.tournamentId}`;
        if ((escrowByUserTournament.get(key) ?? []).length === 0) {
          pushIssue(manualReview, 'loss_without_escrow', {
            transactionId: Number(row.id),
            userId: Number(row.userId),
            tournamentId: Number(row.tournamentId),
            amount: Number(row.amount),
          });
        }
      }
      const desc = String(row.description ?? '').trim();
      const lower = desc.toLowerCase();
      if (
        ['topup', 'other'].includes(row.category) &&
        lower.includes('пополнение баланса') &&
        parseAdminTopupDescription(desc).adminId == null &&
        parsePaymentTopupDescription(desc).paymentId == null
      ) {
        pushIssue(manualReview, 'legacy_topup_ambiguous', {
          transactionId: Number(row.id),
          userId: Number(row.userId),
          category: row.category,
          description: desc,
          tournamentId: row.tournamentId,
          createdAt: toIso(row.createdAt),
        });
      }
    }

    for (const escrow of escrowRows) {
      if (escrow.status === 'refunded') {
        const key = `${escrow.userId}:${escrow.tournamentId}`;
        if ((refundTxByUserTournament.get(key) ?? []).length === 0) {
          pushIssue(deterministicIssues, 'refunded_escrow_without_refund_tx', {
            escrowId: Number(escrow.id),
            userId: Number(escrow.userId),
            tournamentId: Number(escrow.tournamentId),
            amount: Number(escrow.amount),
            createdAt: toIso(escrow.createdAt),
          });
        }
      }
    }

    const resultsByTournament = new Map<number, ResultRow[]>();
    for (const row of resultRows) {
      const list = resultsByTournament.get(Number(row.tournamentId)) ?? [];
      list.push(row);
      resultsByTournament.set(Number(row.tournamentId), list);
    }
    const escrowByTournament = new Map<number, EscrowRow[]>();
    for (const row of escrowRows) {
      const list = escrowByTournament.get(Number(row.tournamentId)) ?? [];
      list.push(row);
      escrowByTournament.set(Number(row.tournamentId), list);
    }

    for (const tournament of tournamentRows) {
      if (tournament.gameType !== 'money' || tournament.status !== 'finished') {
        continue;
      }
      const tournamentId = Number(tournament.id);
      const tournamentResults = resultsByTournament.get(tournamentId) ?? [];
      const winners = tournamentResults.filter((row) => Number(row.passed) === 1);
      if (winners.length === 1) {
        const winner = winners[0]!;
        const winKey = `${winner.userId}:${tournamentId}`;
        if ((winTxByTournamentUser.get(winKey) ?? []).length === 0) {
          pushIssue(deterministicIssues, 'winner_without_win_tx', {
            tournamentId,
            winnerUserId: Number(winner.userId),
            leagueAmount: Number(tournament.leagueAmount ?? 0),
          });
        }
      }
      const lingeringEscrows = (escrowByTournament.get(tournamentId) ?? []).filter(
        (row) => row.status === 'held' || row.status === 'processing',
      );
      if (lingeringEscrows.length > 0) {
        const hasUniqueWinner = winners.length === 1;
        const hasAllRefunds =
          winners.length === 0 &&
          lingeringEscrows.every(
            (row) =>
              (refundTxByUserTournament.get(`${row.userId}:${row.tournamentId}`) ??
                []).length > 0,
          );
        const bucket =
          hasUniqueWinner || hasAllRefunds
            ? deterministicIssues
            : manualReview;
        pushIssue(bucket, 'processing_or_held_escrow_on_finished_tournament', {
          tournamentId,
          statuses: lingeringEscrows.map((row) => ({
            escrowId: Number(row.id),
            userId: Number(row.userId),
            status: row.status,
            amount: Number(row.amount),
          })),
          winnerCount: winners.length,
        });
      }
    }

    const issueCounts: Record<string, number> = {};
    for (const [kind, items] of Object.entries(deterministicIssues)) {
      issueCounts[kind] = items.length;
    }
    for (const [kind, items] of Object.entries(manualReview)) {
      issueCounts[kind] = items.length;
    }

    const report = {
      generatedAt: new Date().toISOString(),
      summary: {
        totalUsers: users.length,
        deterministicIssueCount: Object.values(deterministicIssues).reduce(
          (sum, items) => sum + items.length,
          0,
        ),
        manualReviewCount: Object.values(manualReview).reduce(
          (sum, items) => sum + items.length,
          0,
        ),
        issueCounts,
      },
      deterministicIssues,
      manualReview,
    };

    const markdown = buildMarkdown(report);
    await maybeWrite(jsonOut, JSON.stringify(report, null, 2));
    await maybeWrite(mdOut, markdown);

    console.log(markdown);
    if (report.summary.deterministicIssueCount > 0) {
      process.exitCode = 1;
    }
  } finally {
    await app.close();
  }
}

main().catch((error) => {
  console.error('[audit-finance-ledger] failed:', error);
  process.exit(1);
});
