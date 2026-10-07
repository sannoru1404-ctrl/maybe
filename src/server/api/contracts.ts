import { createSubscriptionSchema, catalogQuerySchema, createOrderSchema, disputeSchema } from './schemas.js';
import type { TelegramSession } from '../auth/telegram.js';
export interface Database { query<T>(sql: string, params?: readonly unknown[]): Promise<{ rows: T[] }>; }
export function parseCatalog(url: string) { return catalogQuerySchema.parse(Object.fromEntries(new URL(url).searchParams)); }
export function createSubscriptionBody(input: unknown) { return createSubscriptionSchema.parse(input); }
export function createOrderBody(input: unknown) { return createOrderSchema.parse(input); }
export function disputeBody(input: unknown) { return disputeSchema.parse(input); }
export function currentUser(session: TelegramSession): bigint { return BigInt(session.telegramId); }

/** SQL handlers keep all actor IDs server-derived and delegate state transitions to locked DB functions. */
export async function confirmOrder(db: Database, orderId: string, session: TelegramSession) {
  return db.query<{ confirm_order: string }>('SELECT subshare_private.confirm_order($1,$2,false)', [orderId, currentUser(session).toString()]);
}
export async function openDispute(db: Database, orderId: string, body: unknown, session: TelegramSession) {
  const { reason } = disputeBody(body);
  return db.query<{ open_dispute: string }>('SELECT subshare_private.open_dispute($1,$2,$3)', [orderId, currentUser(session).toString(), reason]);
}
export async function readOrderAccess(db: Database, orderId: string, session: TelegramSession) {
  return db.query('SELECT * FROM subshare_private.read_order_access($1,$2)', [orderId, currentUser(session).toString()]);
}
