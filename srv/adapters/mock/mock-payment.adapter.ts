import type { PaymentRequest, PaymentResponse, WebhookEvent } from "@auto/shared";
import type { IPaymentAdapter } from "../interfaces/payment.interface";

let sessionCounter = 0;

export class MockPaymentAdapter implements IPaymentAdapter {
  readonly providerName = "mock";
  readonly providerVersion = "1.0.0";

  /** If true, simulates payment failure. */
  simulateFailure = false;

  constructor(private delayMs = 0) {}

  async createCheckoutSession(request: PaymentRequest): Promise<PaymentResponse> {
    if (this.delayMs > 0) await delay(this.delayMs);

    if (this.simulateFailure) {
      throw new Error("Payment provider unavailable (simulated failure)");
    }

    sessionCounter++;
    const sessionId = `mock_cs_${Date.now()}_${sessionCounter}`;

    return {
      sessionId,
      sessionUrl: `https://mock-checkout.example.com/pay/${sessionId}?amount=${request.amountCents}`,
      status: "pending",
      provider: { providerName: "mock", providerVersion: "1.0.0" },
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async handleWebhook(payload: string, signature: string): Promise<WebhookEvent> {
    if (this.delayMs > 0) await delay(this.delayMs);

    const parsed = JSON.parse(payload) as {
      type?: string;
      sessionId?: string;
      amountCents?: number;
      customerId?: string;
      metadata?: Record<string, string>;
    };

    return {
      id: `mock_evt_${Date.now()}`,
      type: (parsed.type as WebhookEvent["type"]) || "checkout.session.completed",
      sessionId: parsed.sessionId || "mock_cs_unknown",
      amountCents: parsed.amountCents || 0,
      currency: "eur",
      customerId: parsed.customerId || "unknown",
      metadata: parsed.metadata || {},
      createdAt: new Date().toISOString(),
    };
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
