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
