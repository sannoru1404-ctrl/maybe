export type PaymentProviderName = 'yookassa' | 'lava' | 'robokassa';
export interface PaymentInvoice { invoiceId: string; checkoutUrl: string; }
export interface PaymentProvider {
  readonly name: PaymentProviderName;
  createInvoice(input: { orderId: string; amountKopecks: number; description: string }): Promise<PaymentInvoice>;
  verifyWebhook(request: Request): Promise<{ eventId: string; invoiceId: string; orderId: string; amountKopecks: number; currency: 'RUB'; status: 'paid' | 'failed' }>;
  refund(input: { orderId: string; invoiceId: string; amountKopecks: number; idempotencyKey: string }): Promise<void>;
}
export class PaymentProviderRegistry {
  #providers = new Map<PaymentProviderName, PaymentProvider>();
  register(provider: PaymentProvider): this { this.#providers.set(provider.name, provider); return this; }
  get(name: PaymentProviderName): PaymentProvider { const result = this.#providers.get(name); if (!result) throw new Error(`Provider ${name} is not configured`); return result; }
}
