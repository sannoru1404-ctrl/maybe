import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

const telegramUserSchema = z.object({
  id: z.number().int().positive().safe(),
  first_name: z.string().min(1).max(256),
  last_name: z.string().max(256).optional(),
  username: z.string().max(64).optional(),
  language_code: z.string().max(16).optional(),
  is_bot: z.boolean().optional(),
  is_premium: z.boolean().optional(),
  photo_url: z.string().url().optional(),
});

export class TelegramAuthError extends Error {
  readonly statusCode = 401;
  constructor() { super('Invalid or expired Telegram initData'); }
}

export interface TelegramSession {
  readonly telegramId: string;
  readonly user: z.infer<typeof telegramUserSchema>;
  readonly authenticatedAt: number;
}

/** Validate raw Mini App initData. Never trust initDataUnsafe or log this input. */
export function validateTelegramInitData(
  raw: string,
  botToken: string,
  options: { nowSeconds?: number; maxAgeSeconds?: number; clockSkewSeconds?: number } = {},
): TelegramSession {
  if (!botToken) throw new Error('BOT_TOKEN is required');
  const now = options.nowSeconds ?? Math.floor(Date.now() / 1000);
  const maxAge = options.maxAgeSeconds ?? 3600;
  const skew = options.clockSkewSeconds ?? 30;
  if (![now, maxAge, skew].every(Number.isSafeInteger) || maxAge <= 0 || skew < 0) {
    throw new Error('Invalid Telegram authentication configuration');
  }
  if (!raw || Buffer.byteLength(raw) > 16_384 || /%(?![0-9a-f]{2})/i.test(raw)) {
    throw new TelegramAuthError();
  }
  const params = new URLSearchParams(raw);
  const keys = new Set<string>();
  for (const [key] of params) {
    if (!key || keys.has(key)) throw new TelegramAuthError();
    keys.add(key);
  }
  const hash = params.get('hash');
  if (!hash || !/^[a-f0-9]{64}$/i.test(hash)) throw new TelegramAuthError();
  params.delete('hash');
  // For bot-token HMAC validation, signature (when present) remains in the signed data.
  const data = [...params.entries()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([key, value]) => `${key}=${value}`).join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(botToken).digest();
  const expected = createHmac('sha256', secret).update(data).digest();
  if (!timingSafeEqual(expected, Buffer.from(hash, 'hex'))) throw new TelegramAuthError();
  const date = params.get('auth_date');
  if (!date || !/^\d+$/.test(date)) throw new TelegramAuthError();
  const authenticatedAt = Number(date);
  if (!Number.isSafeInteger(authenticatedAt) || authenticatedAt > now + skew || now - authenticatedAt > maxAge) {
    throw new TelegramAuthError();
  }
  try {
    const user = telegramUserSchema.parse(JSON.parse(params.get('user') ?? 'null'));
    return { telegramId: String(user.id), user, authenticatedAt };
  } catch { throw new TelegramAuthError(); }
}

/** Adapter for Next.js Request headers; session is derived afresh for every request. */
export function authenticateTelegramRequest(request: Pick<Request, 'headers'>, botToken: string): TelegramSession {
  const authorization = request.headers.get('authorization');
  if (!authorization?.startsWith('tma ')) throw new TelegramAuthError();
  return validateTelegramInitData(authorization.slice(4), botToken);
}
