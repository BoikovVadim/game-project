const ADMIN_TOPUP_PREFIX = 'Пополнение баланса администратором';
const PAYMENT_TOPUP_PREFIX = 'Пополнение через платёжного провайдера';
const WITHDRAWAL_APPROVED_PREFIX = 'Вывод средств одобрен';

export function buildAdminTopupDescription(adminId: number, comment?: string | null): string {
  const safeComment = String(comment ?? '').trim();
  return safeComment
    ? `${ADMIN_TOPUP_PREFIX} (ID ${adminId}): ${safeComment}`
    : `${ADMIN_TOPUP_PREFIX} (ID ${adminId})`;
}

export function parseAdminTopupDescription(
  description: string | null | undefined,
): { adminId: number | null; comment: string | null } {
  const text = String(description ?? '').trim();
  const match = text.match(/^Пополнение баланса администратором \(ID (\d+)\)(?::\s*(.*))?$/);
  if (!match) return { adminId: null, comment: null };
  const adminId = Number.parseInt(match[1] ?? '', 10);
  const comment = (match[2] ?? '').trim();
  return {
    adminId: Number.isFinite(adminId) ? adminId : null,
    comment: comment || null,
  };
}

export function buildPaymentTopupDescription(
  provider: 'yookassa' | 'robokassa',
  paymentId: number,
  externalId?: string | null,
): string {
  const providerLabel = provider === 'robokassa' ? 'Robokassa' : 'YooKassa';
  const externalSuffix = String(externalId ?? '').trim()
    ? `, externalId ${String(externalId).trim()}`
    : '';
  return `${PAYMENT_TOPUP_PREFIX} (${providerLabel}, paymentId ${paymentId}${externalSuffix})`;
}

export function parsePaymentTopupDescription(
  description: string | null | undefined,
): { provider: 'yookassa' | 'robokassa' | null; paymentId: number | null; externalId: string | null } {
  const text = String(description ?? '').trim();
  const match = text.match(
    /^Пополнение через платёжного провайдера \((YooKassa|Robokassa), paymentId (\d+)(?:, externalId (.+))?\)$/,
  );
  if (!match) {
    return { provider: null, paymentId: null, externalId: null };
  }
  const providerLabel = match[1] === 'Robokassa' ? 'robokassa' : 'yookassa';
  const paymentId = Number.parseInt(match[2] ?? '', 10);
  const externalId = String(match[3] ?? '').trim();
  return {
    provider: providerLabel,
    paymentId: Number.isFinite(paymentId) ? paymentId : null,
    externalId: externalId || null,
  };
}

export function buildApprovedWithdrawalDescription(requestId: number): string {
  return `${WITHDRAWAL_APPROVED_PREFIX} (requestId ${requestId})`;
}

export function parseApprovedWithdrawalDescription(
  description: string | null | undefined,
): { requestId: number | null } {
  const text = String(description ?? '').trim();
  const match = text.match(/^Вывод средств одобрен \(requestId (\d+)\)$/);
  if (!match) return { requestId: null };
  const requestId = Number.parseInt(match[1] ?? '', 10);
  return { requestId: Number.isFinite(requestId) ? requestId : null };
}
