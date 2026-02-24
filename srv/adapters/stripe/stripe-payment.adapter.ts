import Stripe from "stripe";
import type { PaymentRequest, PaymentResponse, WebhookEvent, WebhookEventType } from "@auto/shared";
import type { IPaymentAdapter } from "../interfaces/payment.interface";

const STRIPE_API_VERSION = "2025-01-27.acacia" as Stripe.LatestApiVersion;

export class StripePaymentAdapter implements IPaymentAdapter {
  readonly providerName = "stripe";
  readonly providerVersion = "1.0.0";

  private stripe: Stripe;
  private webhookSecret: string;

  constructor(secretKey?: string, webhookSecret?: string) {
    const key = secretKey || process.env.STRIPE_SECRET_KEY;
    if (!key) {
      throw new Error("STRIPE_SECRET_KEY is required for StripePaymentAdapter");
    }
    this.webhookSecret = webhookSecret || process.env.STRIPE_WEBHOOK_SECRET || "";
    this.stripe = new Stripe(key, { apiVersion: STRIPE_API_VERSION });
  }

  async createCheckoutSession(request: PaymentRequest): Promise<PaymentResponse> {
    const session = await this.stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      line_items: [
        {
          price_data: {
            currency: request.currency,
            unit_amount: request.amountCents,
            product_data: {
              name: request.description,
            },
          },
          quantity: 1,
        },
      ],
      metadata: request.metadata || {},
      customer_email: undefined,
      client_reference_id: request.customerId,
      success_url: request.successUrl,
      cancel_url: request.cancelUrl,
    });

    return {
      sessionId: session.id,
      sessionUrl: session.url || "",
      status: "pending",
      provider: { providerName: this.providerName, providerVersion: this.providerVersion },
    };
  }

  async handleWebhook(payload: string, signature: string): Promise<WebhookEvent> {
    if (!this.webhookSecret) {
      throw new Error("STRIPE_WEBHOOK_SECRET is required for webhook verification");
    }

    const event = this.stripe.webhooks.constructEvent(payload, signature, this.webhookSecret);

    const eventTypeMap: Record<string, WebhookEventType> = {
      "checkout.session.completed": "checkout.session.completed",
      "checkout.session.expired": "checkout.session.expired",
      "payment_intent.succeeded": "payment_intent.succeeded",
      "payment_intent.payment_failed": "payment_intent.payment_failed",
    };

    const mappedType = eventTypeMap[event.type];
    if (!mappedType) {
      throw new Error(`Unsupported Stripe event type: ${event.type}`);
    }

    const session = event.data.object as Stripe.Checkout.Session;

    return {
      id: event.id,
      type: mappedType,
      sessionId: session.id || "",
      amountCents: session.amount_total || 0,
      currency: session.currency || "eur",
      customerId: session.client_reference_id || session.metadata?.customerId || "",
      metadata: (session.metadata as Record<string, string>) || {},
      createdAt: new Date(event.created * 1000).toISOString(),
    };
  }
}
