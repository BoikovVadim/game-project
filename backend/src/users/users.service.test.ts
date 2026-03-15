import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildAdminTopupDescription,
  buildApprovedWithdrawalDescription,
  buildPaymentTopupDescription,
  parseAdminTopupDescription,
  parseApprovedWithdrawalDescription,
  parsePaymentTopupDescription,
} from './ruble-ledger-descriptions';
import { buildTransactionHistoryWithBalances } from './transaction-balance-history';

test('builds and parses structured payment topup descriptions', () => {
  const description = buildPaymentTopupDescription('yookassa', 42, 'yk_123');
  assert.equal(
    description,
    'Пополнение через платёжного провайдера (YooKassa, paymentId 42, externalId yk_123)',
  );

  const parsed = parsePaymentTopupDescription(description);
  assert.deepEqual(parsed, {
    provider: 'yookassa',
    paymentId: 42,
    externalId: 'yk_123',
  });
});

test('builds and parses approved withdrawal descriptions', () => {
  const description = buildApprovedWithdrawalDescription(77);
  assert.equal(description, 'Вывод средств одобрен (requestId 77)');
  assert.deepEqual(parseApprovedWithdrawalDescription(description), { requestId: 77 });
});

test('parses admin topup descriptions with optional comments', () => {
  const description = buildAdminTopupDescription(11, 'ручная коррекция');
  assert.deepEqual(parseAdminTopupDescription(description), {
    adminId: 11,
    comment: 'ручная коррекция',
  });
  assert.deepEqual(parseAdminTopupDescription('Пополнение баланса'), {
    adminId: null,
    comment: null,
  });
});

test('getTransactions computes running balance by createdAt timeline', async () => {
  const transactions = [
    {
      id: 1,
      userId: 1,
      amount: 100,
      description: 'Пополнение баланса',
      tournamentId: null,
      category: 'topup',
      createdAt: new Date('2026-03-07T02:28:59.000Z'),
    },
    {
      id: 25,
      userId: 1,
      amount: -90,
      description: 'Конвертация L в рубли',
      tournamentId: null,
      category: 'convert',
      createdAt: new Date('2026-03-09T06:59:39.000Z'),
    },
    {
      id: 26,
      userId: 1,
      amount: 90,
      description: 'Конвертация L в рубли',
      tournamentId: null,
      category: 'convert',
      createdAt: new Date('2026-03-09T06:59:56.000Z'),
    },
    {
      id: 301,
      userId: 1,
      amount: 100,
      description: 'Manual recovery: legacy opening balance before tx #2',
      tournamentId: null,
      category: 'other',
      createdAt: new Date('2026-03-07T02:28:58.000Z'),
    },
    {
      id: 302,
      userId: 1,
      amount: 5,
      description: 'Manual recovery: reconcile 5 L drift before tx #25',
      tournamentId: null,
      category: 'other',
      createdAt: new Date('2026-03-09T06:59:38.000Z'),
    },
  ];

  const result = buildTransactionHistoryWithBalances(transactions).reverse();

  assert.deepEqual(
    result.map((row) => ({
      id: row.transaction.id,
      balanceAfterRubles: row.balanceAfterRubles,
      balanceAfterL: row.balanceAfterL,
    })),
    [
      { id: 26, balanceAfterRubles: 100, balanceAfterL: 105 },
      { id: 25, balanceAfterRubles: 190, balanceAfterL: 15 },
      { id: 302, balanceAfterRubles: 100, balanceAfterL: 105 },
      { id: 1, balanceAfterRubles: 100, balanceAfterL: 100 },
      { id: 301, balanceAfterRubles: 0, balanceAfterL: 100 },
    ],
  );
});
