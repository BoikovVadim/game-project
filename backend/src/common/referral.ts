import * as crypto from 'crypto';

export function generateReferralCode(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = crypto.randomBytes(8);
  let result = '';
  for (let i = 0; i < 8; i++) result += chars[bytes[i]! % chars.length];
  return result;
}
