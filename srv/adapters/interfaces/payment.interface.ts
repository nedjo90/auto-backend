import type { PaymentRequest, PaymentResponse, WebhookEvent } from "@auto/shared";

export interface IPaymentAdapter {
  readonly providerName: string;
  readonly providerVersion: string;
  createCheckoutSession(request: PaymentRequest): Promise<PaymentResponse>;
  handleWebhook(payload: string, signature: string): Promise<WebhookEvent>;
}
