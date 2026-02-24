/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-require-imports, @typescript-eslint/no-unused-vars */
export {};

/**
 * Unit tests for payment handler functions:
 * - getPublishableListings, calculateBatchTotal, createCheckoutSession
 * - getPaymentSessionStatus, handleStripeWebhook
 */

// ─── Test UUIDs (required by Zod batchPublishRequestSchema) ──────────────

const UUID1 = "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d";
const UUID2 = "b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e";
const UUID3 = "c3d4e5f6-a7b8-4c9d-0e1f-2a3b4c5d6e7f";

// ─── Mocks ──────────────────────────────────────────────────────────────────

const mockRun = jest.fn();
const mockUuid = jest.fn(() => "test-uuid-payment");
const mockTxRun = jest.fn();
const mockTxCommit = jest.fn();
const mockTxRollback = jest.fn();

jest.mock("@sap/cds", () => {
  const mockLog = { warn: jest.fn(), info: jest.fn(), error: jest.fn() };
  return {
    __esModule: true,
    default: {
      entities: jest.fn(() => ({
        Listing: "Listing",
        ListingPhoto: "ListingPhoto",
        PaymentTransaction: "PaymentTransaction",
        AuditTrailEntry: "AuditTrailEntry",
      })),
      run: (...args: any[]) => mockRun(...args),
      tx: () => ({
        run: (...args: any[]) => mockTxRun(...args),
        commit: () => mockTxCommit(),
        rollback: () => mockTxRollback(),
      }),
      log: jest.fn(() => mockLog),
      utils: { uuid: () => mockUuid() },
      context: {},
    },
  };
});

const mockConfigGet = jest.fn();
jest.mock("../../../srv/lib/config-cache", () => ({
  configCache: {
    get: (...args: any[]) => mockConfigGet(...args),
    getAll: jest.fn(() => []),
  },
}));

const mockCreateCheckoutSession = jest.fn();
const mockHandleWebhookAdapter = jest.fn();
jest.mock("../../../srv/adapters/factory/adapter-factory", () => ({
  getPayment: () => ({
    providerName: "mock",
    providerVersion: "1.0.0",
    createCheckoutSession: (...args: any[]) => mockCreateCheckoutSession(...args),
    handleWebhook: (...args: any[]) => mockHandleWebhookAdapter(...args),
  }),
}));

jest.mock("../../../srv/middleware/audit-trail", () => ({
  auditLog: jest.fn().mockResolvedValue(undefined),
  extractAuditContext: jest.fn().mockReturnValue({ actorId: "seller-1", actorRole: "seller" }),
}));

// Global CDS query helpers
(global as any).SELECT = {
  one: {
    from: jest.fn().mockReturnValue({
      where: jest.fn().mockReturnValue("select-one-query"),
    }),
  },
  from: jest.fn().mockReturnValue({
    where: jest.fn().mockReturnValue({
      and: jest.fn().mockReturnValue("select-query"),
    }),
    columns: jest.fn().mockReturnValue({
      where: jest.fn().mockReturnValue("select-columns-query"),
    }),
  }),
};
(global as any).INSERT = {
  into: jest.fn().mockReturnValue({ entries: jest.fn().mockReturnValue("insert-query") }),
};
(global as any).UPDATE = jest.fn().mockReturnValue({
  set: jest.fn().mockReturnValue({ where: jest.fn().mockReturnValue("update-query") }),
});

// ─── Import handlers ───────────────────────────────────────────────────────

const {
  handleGetPublishableListings,
  handleCalculateBatchTotal,
  handleCreateCheckoutSession,
  handleGetPaymentSessionStatus,
  handleStripeWebhook,
} = require("../../../srv/handlers/payment-handler");

// ─── Test Helpers ─────────────────────────────────────────────────────────

function createMockReq(data: Record<string, unknown> = {}, userId = "seller-1"): any {
  const errors: any[] = [];
  return {
    user: { id: userId },
    data,
    headers: {},
    error: jest.fn((code: number, msg: string) => {
      errors.push({ code, msg });
    }),
    _errors: errors,
  };
}

function createMockRes(): any {
  const res: any = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

function makeWebhookEvent(overrides: Record<string, any> = {}) {
  return {
    id: "evt_test",
    type: "checkout.session.completed",
    sessionId: "cs_test_123",
    amountCents: 499,
    currency: "eur",
    customerId: "seller-1",
    metadata: {},
    createdAt: "2026-02-24T10:00:00Z",
    ...overrides,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────

describe("Payment Handlers", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Reset once-queues to prevent cascade from earlier tests
    mockRun.mockReset();
    mockTxRun.mockReset();
    mockTxCommit.mockReset();
    mockTxRollback.mockReset();
    mockConfigGet.mockReturnValue({ key: "LISTING_PRICE_EUR", value: "4.99", type: "number" });
  });

  describe("handleGetPublishableListings", () => {
    it("should return eligible drafts with photo counts and unit price", async () => {
      const drafts = [
        {
          ID: UUID1,
          make: "Renault",
          model: "Clio",
          year: 2020,
          visibilityScore: 85,
          declarationId: "d1",
          sellerId: "seller-1",
        },
        {
          ID: UUID2,
          make: "Peugeot",
          model: "208",
          year: 2021,
          visibilityScore: 72,
          declarationId: "d2",
          sellerId: "seller-1",
        },
      ];
      mockRun
        .mockResolvedValueOnce(drafts)
        .mockResolvedValueOnce([{ ID: "p1" }, { ID: "p2" }])
        .mockResolvedValueOnce([{ ID: "p3" }]);

      const req = createMockReq();
      const result = await handleGetPublishableListings(req);

      expect(result.unitPriceCents).toBe(499);
      const listings = JSON.parse(result.listings);
      expect(listings).toHaveLength(2);
      expect(listings[0].photoCount).toBe(2);
      expect(listings[1].photoCount).toBe(1);
    });

    it("should return empty list when no eligible drafts", async () => {
      mockRun.mockResolvedValueOnce([]);
      const req = createMockReq();
      const result = await handleGetPublishableListings(req);
      expect(JSON.parse(result.listings)).toHaveLength(0);
    });

    it("should use default price when config is missing", async () => {
      mockConfigGet.mockReturnValue(undefined);
      mockRun.mockResolvedValueOnce([]);
      const req = createMockReq();
      const result = await handleGetPublishableListings(req);
      expect(result.unitPriceCents).toBe(499);
    });

    it("should use default price for invalid config value", async () => {
      mockConfigGet.mockReturnValue({ key: "LISTING_PRICE_EUR", value: "abc", type: "number" });
      mockRun.mockResolvedValueOnce([]);
      const req = createMockReq();
      const result = await handleGetPublishableListings(req);
      expect(result.unitPriceCents).toBe(499);
    });

    it("should use default price for zero value", async () => {
      mockConfigGet.mockReturnValue({ key: "LISTING_PRICE_EUR", value: "0", type: "number" });
      mockRun.mockResolvedValueOnce([]);
      const req = createMockReq();
      const result = await handleGetPublishableListings(req);
      expect(result.unitPriceCents).toBe(499);
    });

    it("should reject unauthenticated requests", async () => {
      const req = createMockReq({}, "");
      req.user.id = undefined;
      await handleGetPublishableListings(req);
      expect(req.error).toHaveBeenCalledWith(401, "Authentication required");
    });
  });

  describe("handleCalculateBatchTotal", () => {
    it("should calculate correct total for eligible listings", async () => {
      mockRun.mockResolvedValueOnce([
        { ID: UUID1, sellerId: "seller-1", status: "draft", declarationId: "d1" },
        { ID: UUID2, sellerId: "seller-1", status: "draft", declarationId: "d2" },
      ]);
      const req = createMockReq({ listingIds: JSON.stringify([UUID1, UUID2]) });
      const result = await handleCalculateBatchTotal(req);

      expect(result.count).toBe(2);
      expect(result.unitPriceCents).toBe(499);
      expect(result.totalCents).toBe(998);
    });

    it("should reject ineligible listings with generic error", async () => {
      mockRun.mockResolvedValueOnce([
        { ID: UUID1, sellerId: "seller-1", status: "published", declarationId: "d1" },
      ]);
      const req = createMockReq({ listingIds: JSON.stringify([UUID1]) });
      await handleCalculateBatchTotal(req);
      expect(req.error).toHaveBeenCalledWith(
        400,
        "One or more listings are ineligible for publication",
      );
    });

    it("should reject invalid JSON", async () => {
      const req = createMockReq({ listingIds: "not-json" });
      await handleCalculateBatchTotal(req);
      expect(req.error).toHaveBeenCalledWith(400, "Invalid listingIds format");
    });

    it("should reject empty array", async () => {
      const req = createMockReq({ listingIds: "[]" });
      await handleCalculateBatchTotal(req);
      expect(req.error).toHaveBeenCalledWith(400, expect.stringContaining("non-empty"));
    });

    it("should reject missing listings", async () => {
      mockRun.mockResolvedValueOnce([]);
      const req = createMockReq({ listingIds: JSON.stringify([UUID1]) });
      await handleCalculateBatchTotal(req);
      expect(req.error).toHaveBeenCalledWith(
        400,
        "One or more listings are ineligible for publication",
      );
    });

    it("should reject unauthenticated requests", async () => {
      const req = createMockReq({}, "");
      req.user.id = undefined;
      await handleCalculateBatchTotal(req);
      expect(req.error).toHaveBeenCalledWith(401, "Authentication required");
    });

    it("should deduplicate listing IDs", async () => {
      mockRun.mockResolvedValueOnce([
        { ID: UUID1, sellerId: "seller-1", status: "draft", declarationId: "d1" },
      ]);
      const req = createMockReq({ listingIds: JSON.stringify([UUID1, UUID1, UUID1]) });
      const result = await handleCalculateBatchTotal(req);
      expect(result.count).toBe(1);
      expect(result.totalCents).toBe(499);
    });
  });

  describe("handleCreateCheckoutSession", () => {
    it("should create checkout session and pending payment transaction", async () => {
      mockRun
        .mockResolvedValueOnce([
          { ID: UUID1, sellerId: "seller-1", status: "draft", declarationId: "d1" },
        ])
        .mockResolvedValueOnce(undefined);

      mockCreateCheckoutSession.mockResolvedValue({
        sessionId: "cs_test_123",
        sessionUrl: "https://checkout.stripe.com/pay/cs_test_123",
        status: "pending",
        provider: { providerName: "mock", providerVersion: "1.0.0" },
      });

      const req = createMockReq({
        listingIds: JSON.stringify([UUID1]),
        successUrl: "https://auto.fr/success",
        cancelUrl: "https://auto.fr/cancel",
      });
      const result = await handleCreateCheckoutSession(req);

      expect(result.sessionId).toBe("cs_test_123");
      expect(result.sessionUrl).toBe("https://checkout.stripe.com/pay/cs_test_123");
    });

    it("should reject ineligible listings", async () => {
      mockRun.mockResolvedValueOnce([]);
      const req = createMockReq({
        listingIds: JSON.stringify([UUID1]),
        successUrl: "https://auto.fr/success",
        cancelUrl: "https://auto.fr/cancel",
      });
      await handleCreateCheckoutSession(req);
      expect(req.error).toHaveBeenCalledWith(
        400,
        "One or more listings are ineligible for publication",
      );
    });

    it("should pass correct metadata to payment adapter", async () => {
      mockRun
        .mockResolvedValueOnce([
          { ID: UUID1, sellerId: "seller-1", status: "draft", declarationId: "d1" },
          { ID: UUID2, sellerId: "seller-1", status: "draft", declarationId: "d2" },
        ])
        .mockResolvedValueOnce(undefined);

      mockCreateCheckoutSession.mockResolvedValue({
        sessionId: "cs_meta",
        sessionUrl: "https://stripe.com",
        status: "pending",
        provider: { providerName: "mock", providerVersion: "1.0.0" },
      });

      const req = createMockReq({
        listingIds: JSON.stringify([UUID1, UUID2]),
        successUrl: "https://auto.fr/success",
        cancelUrl: "https://auto.fr/cancel",
      });
      await handleCreateCheckoutSession(req);

      const callArgs = mockCreateCheckoutSession.mock.calls[0][0];
      expect(callArgs.metadata.listingIds).toBe(JSON.stringify([UUID1, UUID2]));
      expect(callArgs.metadata.sellerId).toBe("seller-1");
      expect(callArgs.amountCents).toBe(998);
    });

    it("should reject unauthenticated requests", async () => {
      const req = createMockReq({}, "");
      req.user.id = undefined;
      await handleCreateCheckoutSession(req);
      expect(req.error).toHaveBeenCalledWith(401, "Authentication required");
    });

    it("should reject invalid JSON listingIds", async () => {
      const req = createMockReq({
        listingIds: "broken",
        successUrl: "https://auto.fr/s",
        cancelUrl: "https://auto.fr/c",
      });
      await handleCreateCheckoutSession(req);
      expect(req.error).toHaveBeenCalledWith(400, "Invalid listingIds format");
    });
  });

  describe("handleGetPaymentSessionStatus", () => {
    it("should return payment session status with listing statuses", async () => {
      mockRun
        .mockResolvedValueOnce({
          ID: "tx-1",
          sellerId: "seller-1",
          stripeSessionId: "cs_test_123",
          status: "Succeeded",
          listingCount: 2,
          listingIds: JSON.stringify([UUID1, UUID2]),
        })
        .mockResolvedValueOnce([
          { ID: UUID1, status: "published" },
          { ID: UUID2, status: "published" },
        ]);

      const req = createMockReq({ sessionId: "cs_test_123" });
      const result = await handleGetPaymentSessionStatus(req);

      expect(result.status).toBe("Succeeded");
      expect(result.listingCount).toBe(2);
      expect(JSON.parse(result.listings)).toHaveLength(2);
    });

    it("should return error for unknown session", async () => {
      mockRun.mockResolvedValueOnce(null);
      const req = createMockReq({ sessionId: "cs_unknown" });
      await handleGetPaymentSessionStatus(req);
      expect(req.error).toHaveBeenCalledWith(404, "Payment session not found");
    });

    it("should handle transaction with no listing IDs", async () => {
      mockRun.mockResolvedValueOnce({
        ID: "tx-1",
        sellerId: "seller-1",
        stripeSessionId: "cs_test_empty",
        status: "Pending",
        listingCount: 0,
        listingIds: null,
      });
      const req = createMockReq({ sessionId: "cs_test_empty" });
      const result = await handleGetPaymentSessionStatus(req);
      expect(result.status).toBe("Pending");
      expect(JSON.parse(result.listings)).toHaveLength(0);
    });

    it("should reject unauthenticated requests", async () => {
      const req = createMockReq({}, "");
      req.user.id = undefined;
      await handleGetPaymentSessionStatus(req);
      expect(req.error).toHaveBeenCalledWith(401, "Authentication required");
    });
  });

  describe("handleStripeWebhook", () => {
    it("should reject requests without stripe-signature header", async () => {
      const req = { headers: {}, body: "{}" } as any;
      const res = createMockRes();
      await handleStripeWebhook(req, res);
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ error: "Missing stripe-signature header" });
    });

    it("should reject invalid webhook signatures", async () => {
      mockHandleWebhookAdapter.mockRejectedValue(new Error("Invalid signature"));
      const req = { headers: { "stripe-signature": "invalid" }, body: "{}" } as any;
      const res = createMockRes();
      await handleStripeWebhook(req, res);
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ error: "Invalid webhook signature" });
    });

    it("should return 200 for unsupported event types", async () => {
      mockHandleWebhookAdapter.mockRejectedValue(
        new Error("Unsupported Stripe event type: charge.refunded"),
      );
      const req = { headers: { "stripe-signature": "valid" }, body: "{}" } as any;
      const res = createMockRes();
      await handleStripeWebhook(req, res);
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({ received: true });
    });

    it("should reject non-raw body with 500", async () => {
      const req = { headers: { "stripe-signature": "valid" }, body: { parsed: true } } as any;
      const res = createMockRes();
      await handleStripeWebhook(req, res);
      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({ error: "Server configuration error" });
    });

    it("should handle checkout.session.completed and publish listings atomically", async () => {
      mockHandleWebhookAdapter.mockResolvedValue(
        makeWebhookEvent({
          sessionId: "cs_test_123",
          amountCents: 998,
        }),
      );

      mockRun.mockResolvedValueOnce({
        ID: "tx-1",
        sellerId: "seller-1",
        status: "Pending",
        listingIds: JSON.stringify([UUID1, UUID2]),
      });

      // Batch fetch returns both listings
      mockTxRun
        .mockResolvedValueOnce([
          { ID: UUID1, status: "draft", sellerId: "seller-1" },
          { ID: UUID2, status: "draft", sellerId: "seller-1" },
        ])
        .mockResolvedValueOnce(undefined) // update listing 1
        .mockResolvedValueOnce(undefined) // update listing 2
        .mockResolvedValueOnce(undefined); // update transaction

      mockTxCommit.mockResolvedValue(undefined);

      const req = { headers: { "stripe-signature": "valid_sig" }, body: "{}" } as any;
      const res = createMockRes();
      await handleStripeWebhook(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(mockTxCommit).toHaveBeenCalled();
    });

    it("should handle idempotent duplicate webhook (already succeeded)", async () => {
      mockHandleWebhookAdapter.mockResolvedValue(makeWebhookEvent({ sessionId: "cs_dup" }));
      mockRun.mockResolvedValueOnce({
        ID: "tx-dup",
        sellerId: "seller-1",
        status: "Succeeded",
        listingIds: JSON.stringify([UUID1]),
      });

      const req = { headers: { "stripe-signature": "valid" }, body: "{}" } as any;
      const res = createMockRes();
      await handleStripeWebhook(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(mockTxCommit).not.toHaveBeenCalled();
    });

    it("should skip invalid status transitions (e.g. Failed → Succeeded)", async () => {
      mockHandleWebhookAdapter.mockResolvedValue(makeWebhookEvent({ sessionId: "cs_failed" }));
      mockRun.mockResolvedValueOnce({
        ID: "tx-f",
        sellerId: "seller-1",
        status: "Failed",
        listingIds: JSON.stringify([UUID1]),
      });

      const req = { headers: { "stripe-signature": "valid" }, body: "{}" } as any;
      const res = createMockRes();
      await handleStripeWebhook(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(mockTxCommit).not.toHaveBeenCalled();
    });

    it("should rollback on batch publication failure", async () => {
      mockHandleWebhookAdapter.mockResolvedValue(makeWebhookEvent({ sessionId: "cs_fail" }));

      mockRun.mockResolvedValueOnce({
        ID: "tx-fail",
        sellerId: "seller-1",
        status: "Pending",
        listingIds: JSON.stringify([UUID1, UUID2]),
      });

      // Batch fetch: UUID2 is already published → will cause rollback
      mockTxRun.mockResolvedValueOnce([
        { ID: UUID1, status: "draft" },
        { ID: UUID2, status: "published" },
      ]);

      mockTxRollback.mockResolvedValue(undefined);
      // cds.run for the failed-status update after rollback
      mockRun.mockResolvedValueOnce(undefined);

      const req = { headers: { "stripe-signature": "valid" }, body: "{}" } as any;
      const res = createMockRes();
      await handleStripeWebhook(req, res);

      expect(mockTxRollback).toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(500);
    });

    it("should handle checkout.session.expired", async () => {
      mockHandleWebhookAdapter.mockResolvedValue(
        makeWebhookEvent({
          type: "checkout.session.expired",
          sessionId: "cs_expired",
        }),
      );

      mockRun
        .mockResolvedValueOnce({
          ID: "tx-exp",
          sellerId: "seller-1",
          status: "Pending",
          listingIds: JSON.stringify([UUID1]),
        })
        .mockResolvedValue(undefined);

      const req = { headers: { "stripe-signature": "valid" }, body: "{}" } as any;
      const res = createMockRes();
      await handleStripeWebhook(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({ received: true });
    });

    it("should handle payment_intent.payment_failed", async () => {
      mockHandleWebhookAdapter.mockResolvedValue(
        makeWebhookEvent({
          type: "payment_intent.payment_failed",
          sessionId: "cs_pf",
        }),
      );

      mockRun
        .mockResolvedValueOnce({
          ID: "tx-pf",
          sellerId: "seller-1",
          status: "Pending",
          listingIds: JSON.stringify([UUID1]),
        })
        .mockResolvedValue(undefined);

      const req = { headers: { "stripe-signature": "valid" }, body: "{}" } as any;
      const res = createMockRes();
      await handleStripeWebhook(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({ received: true });
    });

    it("should handle missing PaymentTransaction gracefully", async () => {
      mockHandleWebhookAdapter.mockResolvedValue(makeWebhookEvent({ sessionId: "cs_miss" }));
      mockRun.mockResolvedValueOnce(null);

      const req = { headers: { "stripe-signature": "valid" }, body: "{}" } as any;
      const res = createMockRes();
      await handleStripeWebhook(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({ received: true });
    });

    it("should handle Buffer body", async () => {
      mockHandleWebhookAdapter.mockResolvedValue(makeWebhookEvent({ sessionId: "cs_buf" }));
      mockRun.mockResolvedValueOnce(null);

      const req = {
        headers: { "stripe-signature": "valid" },
        body: Buffer.from('{"test": true}'),
      } as any;
      const res = createMockRes();
      await handleStripeWebhook(req, res);

      expect(mockHandleWebhookAdapter).toHaveBeenCalledWith('{"test": true}', "valid");
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it("should return 500 on unexpected processing error", async () => {
      // Use expired event so the error hits the outer try-catch
      mockHandleWebhookAdapter.mockResolvedValue(
        makeWebhookEvent({
          type: "checkout.session.expired",
        }),
      );
      mockRun.mockRejectedValueOnce(new Error("DB connection failed"));

      const req = { headers: { "stripe-signature": "valid" }, body: "{}" } as any;
      const res = createMockRes();
      await handleStripeWebhook(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({ error: "Webhook processing failed" });
    });
  });
});
