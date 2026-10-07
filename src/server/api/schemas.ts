import { z } from 'zod';

export const categorySchema = z.enum(['design', 'education', 'media', 'vpn']);
export const catalogQuerySchema = z.object({ category: categorySchema.optional(), q: z.string().trim().max(100).optional() });
export const createSubscriptionSchema = z.object({
  service: z.string().trim().min(2).max(128), slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  category: categorySchema, slots: z.number().int().min(1).max(10), price: z.number().int().positive().max(100_000_000),
  inviteType: z.enum(['link', 'email']), instructions: z.string().max(10_000).optional(), inviteUrl: z.string().url().startsWith('https://').optional(),
}).superRefine((value, ctx) => { if (value.inviteType === 'link' && !value.inviteUrl) ctx.addIssue({code:'custom',path:['inviteUrl'],message:'Required for link invites'}); });
export const createOrderSchema = z.object({ subscriptionId: z.string().uuid(), idempotencyKey: z.string().uuid(), provider: z.enum(['yookassa','lava','robokassa']) });
export const disputeSchema = z.object({ reason: z.string().trim().min(10).max(4000) });
export type CreateSubscription = z.infer<typeof createSubscriptionSchema>;
