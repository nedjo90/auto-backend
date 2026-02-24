/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Unit tests for StripePaymentAdapter.
 * Mocks the Stripe SDK to test session creation and webhook handling.
 */

const mockSessionsCreate = jest.fn();
const mockConstructEvent = jest.fn();

jest.mock("stripe", () => {
  return jest.fn().mockImplementation(() => ({
    checkout: {
      sessions: {
        create: mockSessionsCreate,
      },
    },
    webhooks: {
      constructEvent: mockConstructEvent,
    },
  }));
});

import { StripePaymentAdapter } from "../../../srv/adapters/stripe/stripe-payment.adapter";
import type { PaymentRequest } from "@auto/shared";

describe("StripePaymentAdapter", () => {
  let adapter: StripePaymentAdapter;

  const validRequest: PaymentRequest = {
    amountCents: 1497,
    currency: "eur",
    description: "3 annonces",
    customerId: "seller-123",
    metadata: {
      listingIds: JSON.stringify(["l1", "l2", "l3"]),
      sellerId: "seller-123",
    },
    successUrl: "https://auto.fr/publish/success?session_id={CHECKOUT_SESSION_ID}",
    cancelUrl: "https://auto.fr/publish/",
  };

  beforeEach(() => {
    jest.clearAllMocks();
    adapter = new StripePaymentAdapter("sk_test_fake_key", "whsec_test_secret");
  });

  describe("constructor", () => {
    it("should throw if no secret key is provided", () => {
      const originalEnv = process.env.STRIPE_SECRET_KEY;
      delete process.env.STRIPE_SECRET_KEY;

      try {
        expect(() => new StripePaymentAdapter("", "")).toThrow("STRIPE_SECRET_KEY is required");
      } finally {
        if (originalEnv === undefined) delete process.env.STRIPE_SECRET_KEY;
        else process.env.STRIPE_SECRET_KEY = originalEnv;
      }
    });

    it("should use environment variables as fallback", () => {
      const originalKey = process.env.STRIPE_SECRET_KEY;
      const originalWebhook = process.env.STRIPE_WEBHOOK_SECRET;
      process.env.STRIPE_SECRET_KEY = "sk_test_env_key";
      process.env.STRIPE_WEBHOOK_SECRET = "whsec_env_secret";

      try {
        const envAdapter = new StripePaymentAdapter();
        expect(envAdapter.providerName).toBe("stripe");
      } finally {
        if (originalKey === undefined) delete process.env.STRIPE_SECRET_KEY;
        else process.env.STRIPE_SECRET_KEY = originalKey;
        if (originalWebhook === undefined) delete process.env.STRIPE_WEBHOOK_SECRET;
        else process.env.STRIPE_WEBHOOK_SECRET = originalWebhook;
      }
    });

    it("should have correct provider metadata", () => {
      expect(adapter.providerName).toBe("stripe");
      expect(adapter.providerVersion).toBe("1.0.0");
    });
  });

  describe("createCheckoutSession", () => {
    it("should create a Stripe Checkout Session and return PaymentResponse", async () => {
      mockSessionsCreate.mockResolvedValue({
        id: "cs_test_abc123",
        url: "https://checkout.stripe.com/pay/cs_test_abc123",
      });

      const result = await adapter.createCheckoutSession(validRequest);

      expect(result).toEqual({
        sessionId: "cs_test_abc123",
        sessionUrl: "https://checkout.stripe.com/pay/cs_test_abc123",
        status: "pending",
        provider: { providerName: "stripe", providerVersion: "1.0.0" },
      });
    });

    it("should pass correct parameters to Stripe SDK", async () => {
      mockSessionsCreate.mockResolvedValue({ id: "cs_test_xyz", url: "https://stripe.com/pay" });

      await adapter.createCheckoutSession(validRequest);

      expect(mockSessionsCreate).toHaveBeenCalledWith({
        mode: "payment",
        payment_method_types: ["card"],
        line_items: [
          {
            price_data: {
              currency: "eur",
              unit_amount: 1497,
              product_data: {
                name: "3 annonces",
              },
            },
            quantity: 1,
          },
        ],
        metadata: validRequest.metadata,
        customer_email: undefined,
        client_reference_id: "seller-123",
        success_url: validRequest.successUrl,
        cancel_url: validRequest.cancelUrl,
      });
    });

    it("should handle Stripe SDK errors", async () => {
      mockSessionsCreate.mockRejectedValue(new Error("Stripe API error"));

      await expect(adapter.createCheckoutSession(validRequest)).rejects.toThrow("Stripe API error");
    });

    it("should handle empty session URL", async () => {
      mockSessionsCreate.mockResolvedValue({ id: "cs_test_no_url", url: null });

      const result = await adapter.createCheckoutSession(validRequest);
      expect(result.sessionUrl).toBe("");
    });

    it("should pass empty metadata when not provided", async () => {
      mockSessionsCreate.mockResolvedValue({ id: "cs_test_meta", url: "https://stripe.com" });

      const requestNoMeta: PaymentRequest = {
        ...validRequest,
        metadata: undefined,
      };
      await adapter.createCheckoutSession(requestNoMeta);

      expect(mockSessionsCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: {},
        }),
      );
    });
  });

  describe("handleWebhook", () => {
    const makeStripeEvent = (type: string, session: Record<string, any> = {}) => ({
      id: "evt_test_123",
      type,
      created: 1700000000,
      data: {
        object: {
          id: "cs_test_session",
          amount_total: 1497,
          currency: "eur",
          client_reference_id: "seller-123",
          metadata: { listingIds: '["l1","l2"]', sellerId: "seller-123" },
          ...session,
        },
      },
    });

    it("should validate webhook signature and return WebhookEvent for checkout.session.completed", async () => {
      const stripeEvent = makeStripeEvent("checkout.session.completed");
      mockConstructEvent.mockReturnValue(stripeEvent);

      const result = await adapter.handleWebhook('{"payload":"data"}', "sig_test");

      expect(mockConstructEvent).toHaveBeenCalledWith(
        '{"payload":"data"}',
        "sig_test",
        "whsec_test_secret",
      );
      expect(result).toEqual({
        id: "evt_test_123",
        type: "checkout.session.completed",
        sessionId: "cs_test_session",
        amountCents: 1497,
        currency: "eur",
        customerId: "seller-123",
        metadata: { listingIds: '["l1","l2"]', sellerId: "seller-123" },
        createdAt: new Date(1700000000 * 1000).toISOString(),
      });
    });

    it("should handle checkout.session.expired event", async () => {
      const stripeEvent = makeStripeEvent("checkout.session.expired");
      mockConstructEvent.mockReturnValue(stripeEvent);

      const result = await adapter.handleWebhook("{}", "sig");
      expect(result.type).toBe("checkout.session.expired");
    });

    it("should handle payment_intent.succeeded event", async () => {
      const stripeEvent = makeStripeEvent("payment_intent.succeeded");
      mockConstructEvent.mockReturnValue(stripeEvent);

      const result = await adapter.handleWebhook("{}", "sig");
      expect(result.type).toBe("payment_intent.succeeded");
    });

    it("should handle payment_intent.payment_failed event", async () => {
      const stripeEvent = makeStripeEvent("payment_intent.payment_failed");
      mockConstructEvent.mockReturnValue(stripeEvent);

      const result = await adapter.handleWebhook("{}", "sig");
      expect(result.type).toBe("payment_intent.payment_failed");
    });

    it("should throw on unsupported event types", async () => {
      const stripeEvent = makeStripeEvent("charge.refunded");
      mockConstructEvent.mockReturnValue(stripeEvent);

      await expect(adapter.handleWebhook("{}", "sig")).rejects.toThrow(
        "Unsupported Stripe event type: charge.refunded",
      );
    });

    it("should throw on invalid signature", async () => {
      mockConstructEvent.mockImplementation(() => {
        throw new Error("Webhook signature verification failed");
      });

      await expect(adapter.handleWebhook("{}", "bad_sig")).rejects.toThrow(
        "Webhook signature verification failed",
      );
    });

    it("should throw if webhook secret is not configured", async () => {
      const adapterNoSecret = new StripePaymentAdapter("sk_test_key", "");

      await expect(adapterNoSecret.handleWebhook("{}", "sig")).rejects.toThrow(
        "STRIPE_WEBHOOK_SECRET is required",
      );
    });

    it("should handle missing session fields gracefully", async () => {
      const stripeEvent = makeStripeEvent("checkout.session.completed", {
        id: "",
        amount_total: null,
        currency: null,
        client_reference_id: null,
        metadata: null,
      });
      mockConstructEvent.mockReturnValue(stripeEvent);

      const result = await adapter.handleWebhook("{}", "sig");
      expect(result.sessionId).toBe("");
      expect(result.amountCents).toBe(0);
      expect(result.currency).toBe("eur");
      expect(result.customerId).toBe("");
      expect(result.metadata).toEqual({});
    });
  });
});
