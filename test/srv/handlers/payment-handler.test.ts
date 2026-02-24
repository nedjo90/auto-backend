/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-require-imports, @typescript-eslint/no-unused-vars */
export {};

/**
 * Unit tests for payment handler functions:
 * - getPublishableListings, calculateBatchTotal, createCheckoutSession
 * - getPaymentSessionStatus, handleStripeWebhook
 */

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

// ─── Tests ────────────────────────────────────────────────────────────────

describe("Payment Handlers", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockConfigGet.mockReturnValue({ key: "LISTING_PRICE_EUR", value: "4.99", type: "number" });
  });

  describe("handleGetPublishableListings", () => {
    it("should return eligible drafts with photo counts and unit price", async () => {
      const drafts = [
        {
          ID: "l1",
          make: "Renault",
          model: "Clio",
          year: 2020,
          visibilityScore: 85,
          declarationId: "d1",
          sellerId: "seller-1",
        },
        {
          ID: "l2",
          make: "Peugeot",
          model: "208",
          year: 2021,
          visibilityScore: 72,
          declarationId: "d2",
          sellerId: "seller-1",
        },
      ];

      mockRun
        .mockResolvedValueOnce(drafts) // fetch drafts
        .mockResolvedValueOnce([{ ID: "p1" }, { ID: "p2" }]) // photos for l1
        .mockResolvedValueOnce([{ ID: "p3" }]); // photos for l2

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

      const listings = JSON.parse(result.listings);
      expect(listings).toHaveLength(0);
    });

    it("should use default price when config is missing", async () => {
      mockConfigGet.mockReturnValue(undefined);
      mockRun.mockResolvedValueOnce([]);

      const req = createMockReq();
      const result = await handleGetPublishableListings(req);

      expect(result.unitPriceCents).toBe(499);
    });

    it("should call req.error for unauthenticated requests", async () => {
      const req = createMockReq({}, "");
      req.user.id = undefined;

      await handleGetPublishableListings(req);

      expect(req.error).toHaveBeenCalledWith(401, "Authentication required");
    });
  });

  describe("handleCalculateBatchTotal", () => {
    it("should calculate correct total for eligible listings", async () => {
      mockRun.mockResolvedValueOnce([
        { ID: "l1", sellerId: "seller-1", status: "draft", declarationId: "d1" },
        { ID: "l2", sellerId: "seller-1", status: "draft", declarationId: "d2" },
      ]);

      const req = createMockReq({ listingIds: JSON.stringify(["l1", "l2"]) });
      const result = await handleCalculateBatchTotal(req);

      expect(result.count).toBe(2);
      expect(result.unitPriceCents).toBe(499);
      expect(result.totalCents).toBe(998);
    });

    it("should reject listings not in draft status", async () => {
      mockRun.mockResolvedValueOnce([
        { ID: "l1", sellerId: "seller-1", status: "published", declarationId: "d1" },
      ]);

      const req = createMockReq({ listingIds: JSON.stringify(["l1"]) });
      await handleCalculateBatchTotal(req);

      expect(req.error).toHaveBeenCalledWith(400, expect.stringContaining("not a draft"));
    });

    it("should reject listings without declaration", async () => {
      mockRun.mockResolvedValueOnce([
        { ID: "l1", sellerId: "seller-1", status: "draft", declarationId: null },
      ]);

      const req = createMockReq({ listingIds: JSON.stringify(["l1"]) });
      await handleCalculateBatchTotal(req);

      expect(req.error).toHaveBeenCalledWith(400, expect.stringContaining("no declaration"));
    });

    it("should reject listings belonging to another seller", async () => {
      mockRun.mockResolvedValueOnce([
        { ID: "l1", sellerId: "other-seller", status: "draft", declarationId: "d1" },
      ]);

      const req = createMockReq({ listingIds: JSON.stringify(["l1"]) });
      await handleCalculateBatchTotal(req);

      expect(req.error).toHaveBeenCalledWith(400, expect.stringContaining("does not belong"));
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
      mockRun.mockResolvedValueOnce([]); // none found

      const req = createMockReq({ listingIds: JSON.stringify(["nonexistent"]) });
      await handleCalculateBatchTotal(req);

      expect(req.error).toHaveBeenCalledWith(400, expect.stringContaining("not found"));
    });
  });

  describe("handleCreateCheckoutSession", () => {
    it("should create checkout session and pending payment transaction", async () => {
      mockRun
        .mockResolvedValueOnce([
          { ID: "l1", sellerId: "seller-1", status: "draft", declarationId: "d1" },
        ])
        .mockResolvedValueOnce(undefined); // INSERT PaymentTransaction

      mockCreateCheckoutSession.mockResolvedValue({
        sessionId: "cs_test_123",
        sessionUrl: "https://checkout.stripe.com/pay/cs_test_123",
        status: "pending",
        provider: { providerName: "mock", providerVersion: "1.0.0" },
      });

      const req = createMockReq({
        listingIds: JSON.stringify(["l1"]),
        successUrl: "https://auto.fr/success",
        cancelUrl: "https://auto.fr/cancel",
      });

      const result = await handleCreateCheckoutSession(req);

      expect(result.sessionId).toBe("cs_test_123");
      expect(result.sessionUrl).toBe("https://checkout.stripe.com/pay/cs_test_123");
      expect(mockCreateCheckoutSession).toHaveBeenCalledWith(
        expect.objectContaining({
          amountCents: 499,
          currency: "eur",
          customerId: "seller-1",
        }),
      );
    });

    it("should reject ineligible listings", async () => {
      mockRun.mockResolvedValueOnce([]); // no listings found

      const req = createMockReq({
        listingIds: JSON.stringify(["nonexistent"]),
        successUrl: "https://auto.fr/success",
        cancelUrl: "https://auto.fr/cancel",
      });

      await handleCreateCheckoutSession(req);

      expect(req.error).toHaveBeenCalledWith(400, expect.stringContaining("not found"));
    });

    it("should pass correct metadata to payment adapter", async () => {
      mockRun
        .mockResolvedValueOnce([
          { ID: "l1", sellerId: "seller-1", status: "draft", declarationId: "d1" },
          { ID: "l2", sellerId: "seller-1", status: "draft", declarationId: "d2" },
        ])
        .mockResolvedValueOnce(undefined);

      mockCreateCheckoutSession.mockResolvedValue({
        sessionId: "cs_meta",
        sessionUrl: "https://stripe.com",
        status: "pending",
        provider: { providerName: "mock", providerVersion: "1.0.0" },
      });

      const req = createMockReq({
        listingIds: JSON.stringify(["l1", "l2"]),
        successUrl: "https://auto.fr/success",
        cancelUrl: "https://auto.fr/cancel",
      });

      await handleCreateCheckoutSession(req);

      const callArgs = mockCreateCheckoutSession.mock.calls[0][0];
      expect(callArgs.metadata.listingIds).toBe(JSON.stringify(["l1", "l2"]));
      expect(callArgs.metadata.sellerId).toBe("seller-1");
      expect(callArgs.metadata.listingCount).toBe("2");
      expect(callArgs.amountCents).toBe(998);
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
          listingIds: JSON.stringify(["l1", "l2"]),
        })
        .mockResolvedValueOnce([
          { ID: "l1", status: "published" },
          { ID: "l2", status: "published" },
        ]);

      const req = createMockReq({ sessionId: "cs_test_123" });
      const result = await handleGetPaymentSessionStatus(req);

      expect(result.status).toBe("Succeeded");
      expect(result.listingCount).toBe(2);
      const listings = JSON.parse(result.listings);
      expect(listings).toHaveLength(2);
      expect(listings[0].status).toBe("published");
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

    it("should handle checkout.session.completed and publish listings atomically", async () => {
      mockHandleWebhookAdapter.mockResolvedValue({
        id: "evt_1",
        type: "checkout.session.completed",
        sessionId: "cs_test_123",
        amountCents: 998,
        currency: "eur",
        customerId: "seller-1",
        metadata: { listingIds: '["l1","l2"]', sellerId: "seller-1" },
        createdAt: "2026-02-24T10:00:00Z",
      });

      mockRun.mockResolvedValueOnce({
        ID: "tx-1",
        sellerId: "seller-1",
        status: "Pending",
        listingIds: JSON.stringify(["l1", "l2"]),
      });

      mockTxRun
        .mockResolvedValueOnce({ ID: "l1", status: "draft", sellerId: "seller-1" })
        .mockResolvedValueOnce({ ID: "l2", status: "draft", sellerId: "seller-1" })
        .mockResolvedValueOnce(undefined) // update l1
        .mockResolvedValueOnce(undefined) // update l2
        .mockResolvedValueOnce(undefined); // update transaction

      mockTxCommit.mockResolvedValue(undefined);

      const req = { headers: { "stripe-signature": "valid_sig" }, body: "{}" } as any;
      const res = createMockRes();

      await handleStripeWebhook(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({ received: true });
      expect(mockTxCommit).toHaveBeenCalled();
    });

    it("should handle idempotent duplicate webhook (already succeeded)", async () => {
      mockHandleWebhookAdapter.mockResolvedValue({
        id: "evt_dup",
        type: "checkout.session.completed",
        sessionId: "cs_dup",
        amountCents: 499,
        currency: "eur",
        customerId: "seller-1",
        metadata: {},
        createdAt: "2026-02-24T10:00:00Z",
      });

      mockRun.mockResolvedValueOnce({
        ID: "tx-dup",
        sellerId: "seller-1",
        status: "Succeeded",
        listingIds: JSON.stringify(["l1"]),
      });

      const req = { headers: { "stripe-signature": "valid" }, body: "{}" } as any;
      const res = createMockRes();

      await handleStripeWebhook(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(mockTxCommit).not.toHaveBeenCalled();
    });

    it("should rollback on batch publication failure", async () => {
      mockHandleWebhookAdapter.mockResolvedValue({
        id: "evt_fail",
        type: "checkout.session.completed",
        sessionId: "cs_fail",
        amountCents: 998,
        currency: "eur",
        customerId: "seller-1",
        metadata: {},
        createdAt: "2026-02-24T10:00:00Z",
      });

      mockRun
        .mockResolvedValueOnce({
          ID: "tx-fail",
          sellerId: "seller-1",
          status: "Pending",
          listingIds: JSON.stringify(["l1", "l2"]),
        })
        .mockResolvedValue(undefined); // post-rollback UPDATE

      mockTxRun
        .mockResolvedValueOnce({ ID: "l1", status: "draft" })
        .mockResolvedValueOnce({ ID: "l2", status: "published" }); // not draft => error

      mockTxRollback.mockResolvedValue(undefined);

      const req = { headers: { "stripe-signature": "valid" }, body: "{}" } as any;
      const res = createMockRes();

      await handleStripeWebhook(req, res);

      expect(mockTxRollback).toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(500);
    });

    it("should handle payment_intent.payment_failed", async () => {
      mockHandleWebhookAdapter.mockResolvedValue({
        id: "evt_pf",
        type: "payment_intent.payment_failed",
        sessionId: "cs_pf",
        amountCents: 499,
        currency: "eur",
        customerId: "seller-1",
        metadata: {},
        createdAt: "2026-02-24T10:00:00Z",
      });

      mockRun
        .mockResolvedValueOnce({
          ID: "tx-pf",
          sellerId: "seller-1",
          status: "Pending",
          listingIds: JSON.stringify(["l1"]),
        })
        .mockResolvedValue(undefined);

      const req = { headers: { "stripe-signature": "valid" }, body: "{}" } as any;
      const res = createMockRes();

      await handleStripeWebhook(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({ received: true });
    });

    it("should handle missing PaymentTransaction gracefully", async () => {
      mockHandleWebhookAdapter.mockResolvedValue({
        id: "evt_miss",
        type: "checkout.session.completed",
        sessionId: "cs_miss",
        amountCents: 0,
        currency: "eur",
        customerId: "",
        metadata: {},
        createdAt: "2026-02-24T10:00:00Z",
      });

      mockRun.mockResolvedValueOnce(null);

      const req = { headers: { "stripe-signature": "valid" }, body: "{}" } as any;
      const res = createMockRes();

      await handleStripeWebhook(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({ received: true });
    });

    it("should handle Buffer body", async () => {
      mockHandleWebhookAdapter.mockResolvedValue({
        id: "evt_buf",
        type: "checkout.session.completed",
        sessionId: "cs_buf",
        amountCents: 499,
        currency: "eur",
        customerId: "seller-1",
        metadata: {},
        createdAt: "2026-02-24T10:00:00Z",
      });

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
  });
});
