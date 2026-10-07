import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
const eventSchema=z.object({eventId:z.string().min(1).max(200),invoiceId:z.string().min(1).max(200),orderId:z.string().uuid(),amountKopecks:z.number().int().positive(),currency:z.literal('RUB'),status:z.enum(['paid','failed'])});
export function verifyPaymentWebhook(raw:string,signature:string,secret:string){const expected=createHmac('sha256',secret).update(raw).digest('hex');const a=Buffer.from(expected,'hex'),b=Buffer.from(signature,'hex');if(b.length!==a.length||!timingSafeEqual(a,b))throw new Error('Invalid payment signature');return eventSchema.parse(JSON.parse(raw));}
