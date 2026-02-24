import cds from "@sap/cds";
import type { Request as ExpressRequest, Response as ExpressResponse } from "express";
import {
  LISTING_PRICE_CONFIG_KEY,
  PAYMENT_STATUS_TRANSITIONS,
  batchPublishRequestSchema,
} from "@auto/shared";
import { getPayment } from "../adapters/factory/adapter-factory";
import { configCache } from "../lib/config-cache";
import { auditLog } from "../middleware/audit-trail";

const LOG = cds.log("payment");

const MAX_BATCH_SIZE = 50;

interface ConfigParam {
  key: string;
  value: string;
  type: string;
}

// ─── Helper: get listing price from ConfigParameter ──────────────────────

function getListingPriceCents(): number {
  const param = configCache.get<ConfigParam>("ConfigParameter", LISTING_PRICE_CONFIG_KEY);
  if (!param) {
    LOG.warn("LISTING_PRICE_EUR not configured, using default 499 cents");
    return 499;
  }
  const euros = parseFloat(param.value);
  if (isNaN(euros) || euros <= 0) {
    LOG.warn(`Invalid LISTING_PRICE_EUR value: ${param.value}, using default 499 cents`);
    return 499;
  }
  return Math.round(euros * 100);
}

// ─── Helper: validate and parse listing IDs ──────────────────────────────

function parseAndValidateListingIds(
  listingIdsJson: string,
  req: cds.Request,
): string[] | undefined {
  let listingIds: string[];
  try {
    listingIds = JSON.parse(listingIdsJson);
    if (!Array.isArray(listingIds) || listingIds.length === 0) {
      req.error(400, "listingIds must be a non-empty array");
      return undefined;
    }
  } catch {
    req.error(400, "Invalid listingIds format");
    return undefined;
  }

  // Deduplicate
  listingIds = [...new Set(listingIds)];

  // Enforce max batch size
  if (listingIds.length > MAX_BATCH_SIZE) {
    req.error(400, `Maximum ${MAX_BATCH_SIZE} listings per batch`);
    return undefined;
  }

  // Validate UUIDs via shared schema
  const result = batchPublishRequestSchema.safeParse({ listingIds });
  if (!result.success) {
    req.error(400, result.error.issues[0]?.message || "Invalid listing IDs");
    return undefined;
  }

  return listingIds;
}

// ─── Helper: validate listing eligibility ─────────────────────────────────

async function validateListingEligibility(
  listingIds: string[],
  sellerId: string,
): Promise<{ valid: boolean; error?: string; listings?: Record<string, unknown>[] }> {
  const entities = cds.entities("auto");
  const Listing = entities["Listing"];

  const listings = await cds.run(SELECT.from(Listing).where({ ID: { in: listingIds } }));

  if (listings.length !== listingIds.length) {
    return { valid: false, error: "One or more listings are ineligible for publication" };
  }

  for (const listing of listings) {
    if (listing.sellerId !== sellerId) {
      return { valid: false, error: "One or more listings are ineligible for publication" };
    }
    if (listing.status !== "draft") {
      return { valid: false, error: "One or more listings are ineligible for publication" };
    }
    if (!listing.declarationId) {
      return { valid: false, error: "One or more listings are ineligible for publication" };
    }
  }

  return { valid: true, listings };
}

// ─── Helper: validate redirect URLs ──────────────────────────────────────

function isAllowedRedirectUrl(url: string): boolean {
  const allowedOrigins = (process.env.ALLOWED_REDIRECT_ORIGINS || "").split(",").filter(Boolean);
  if (allowedOrigins.length === 0) {
    // In dev mode, allow any URL
    return true;
  }
  try {
    const parsed = new URL(url);
    return allowedOrigins.some((origin) => parsed.origin === origin.trim());
  } catch {
    return false;
  }
}

// ─── CAP Action Handlers ─────────────────────────────────────────────────

export async function handleGetPublishableListings(req: cds.Request) {
  const userId = (req.user as { id?: string })?.id;
  if (!userId) return req.error(401, "Authentication required");

  const entities = cds.entities("auto");
  const Listing = entities["Listing"];
  const ListingPhoto = entities["ListingPhoto"];

  // Fetch eligible drafts: status=draft, declarationId not null, seller=current user
  const drafts = await cds.run(
    SELECT.from(Listing)
      .where({ sellerId: userId, status: "draft" })
      .and("declarationId is not null"),
  );

  // Enrich with photo counts
  const listings = await Promise.all(
    drafts.map(async (d: Record<string, unknown>) => {
      const photos = await cds.run(SELECT.from(ListingPhoto).where({ listingId: d.ID as string }));
      return {
        ID: d.ID,
        make: d.make || null,
        model: d.model || null,
        year: d.year || null,
        visibilityScore: d.visibilityScore ?? 0,
        photoCount: photos.length,
        declarationId: d.declarationId,
      };
    }),
  );

  const unitPriceCents = getListingPriceCents();

  return {
    listings: JSON.stringify(listings),
    unitPriceCents,
  };
}

export async function handleCalculateBatchTotal(req: cds.Request) {
  const userId = (req.user as { id?: string })?.id;
  if (!userId) return req.error(401, "Authentication required");

  const { listingIds: listingIdsJson } = req.data as { listingIds: string };

  const listingIds = parseAndValidateListingIds(listingIdsJson, req);
  if (!listingIds) return;

  const validation = await validateListingEligibility(listingIds, userId);
  if (!validation.valid) {
    return req.error(400, validation.error!);
  }

  const unitPriceCents = getListingPriceCents();
  const totalCents = listingIds.length * unitPriceCents;

  return {
    count: listingIds.length,
    unitPriceCents,
    totalCents,
    listingIds: JSON.stringify(listingIds),
  };
}

export async function handleCreateCheckoutSession(req: cds.Request) {
  const userId = (req.user as { id?: string })?.id;
  if (!userId) return req.error(401, "Authentication required");

  const {
    listingIds: listingIdsJson,
    successUrl,
    cancelUrl,
  } = req.data as {
    listingIds: string;
    successUrl: string;
    cancelUrl: string;
  };

  const listingIds = parseAndValidateListingIds(listingIdsJson, req);
  if (!listingIds) return;

  // Validate redirect URLs against allowlist
  if (!isAllowedRedirectUrl(successUrl) || !isAllowedRedirectUrl(cancelUrl)) {
    return req.error(400, "Invalid redirect URL");
  }

  const validation = await validateListingEligibility(listingIds, userId);
  if (!validation.valid) {
    return req.error(400, validation.error!);
  }

  const unitPriceCents = getListingPriceCents();
  const totalCents = listingIds.length * unitPriceCents;

  // Create Stripe Checkout Session via adapter
  const payment = getPayment();
  const response = await payment.createCheckoutSession({
    amountCents: totalCents,
    currency: "eur",
    description: `${listingIds.length} annonce${listingIds.length > 1 ? "s" : ""}`,
    customerId: userId,
    metadata: {
      listingIds: JSON.stringify(listingIds),
      sellerId: userId,
      listingCount: String(listingIds.length),
    },
    successUrl,
    cancelUrl,
  });

  // Create pending PaymentTransaction
  const entities = cds.entities("auto");
  const PaymentTransaction = entities["PaymentTransaction"];

  await cds.run(
    INSERT.into(PaymentTransaction).entries({
      ID: cds.utils.uuid(),
      sellerId: userId,
      stripeSessionId: response.sessionId,
      amount: totalCents / 100,
      currency: "EUR",
      status: "Pending",
      listingIds: JSON.stringify(listingIds),
      listingCount: listingIds.length,
    }),
  );

  // Audit log
  await auditLog({
    action: "payment.initiated",
    actorId: userId,
    targetType: "PaymentTransaction",
    targetId: response.sessionId,
    details: { listingIds, totalCents, listingCount: listingIds.length },
  });

  LOG.info(`Checkout session created: ${response.sessionId} for ${listingIds.length} listings`);

  return {
    sessionId: response.sessionId,
    sessionUrl: response.sessionUrl,
  };
}

export async function handleGetPaymentSessionStatus(req: cds.Request) {
  const userId = (req.user as { id?: string })?.id;
  if (!userId) return req.error(401, "Authentication required");

  const { sessionId } = req.data as { sessionId: string };

  const entities = cds.entities("auto");
  const PaymentTransaction = entities["PaymentTransaction"];
  const Listing = entities["Listing"];

  const transaction = await cds.run(
    SELECT.one.from(PaymentTransaction).where({ stripeSessionId: sessionId, sellerId: userId }),
  );

  if (!transaction) {
    return req.error(404, "Payment session not found");
  }

  let listings: Array<{ ID: string; status: string }> = [];
  if (transaction.listingIds) {
    try {
      const listingIds: string[] = JSON.parse(transaction.listingIds);
      const dbListings = await cds.run(
        SELECT.from(Listing)
          .columns("ID", "status")
          .where({ ID: { in: listingIds } }),
      );
      listings = dbListings.map((l: { ID: string; status: string }) => ({
        ID: l.ID,
        status: l.status,
      }));
    } catch {
      LOG.error(`Failed to parse listingIds for transaction ${transaction.ID}`);
    }
  }

  return {
    status: transaction.status,
    listingCount: transaction.listingCount,
    listings: JSON.stringify(listings),
  };
}

// ─── Stripe Webhook Express Handler ──────────────────────────────────────

export async function handleStripeWebhook(
  expressReq: ExpressRequest,
  expressRes: ExpressResponse,
): Promise<void> {
  const signature = expressReq.headers["stripe-signature"] as string;
  if (!signature) {
    expressRes.status(400).json({ error: "Missing stripe-signature header" });
    return;
  }

  // Raw body must be string or Buffer for signature verification
  let rawBody: string;
  if (typeof expressReq.body === "string") {
    rawBody = expressReq.body;
  } else if (Buffer.isBuffer(expressReq.body)) {
    rawBody = expressReq.body.toString("utf8");
  } else {
    LOG.error("Webhook received non-raw body — check express.raw() middleware configuration");
    expressRes.status(500).json({ error: "Server configuration error" });
    return;
  }

  let webhookEvent;
  try {
    const payment = getPayment();
    webhookEvent = await payment.handleWebhook(rawBody, signature);
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    // Unsupported event types should return 200 to prevent Stripe retries
    if (errMsg.includes("Unsupported Stripe event type")) {
      LOG.info(`Ignoring unsupported webhook event: ${errMsg}`);
      expressRes.status(200).json({ received: true });
      return;
    }
    LOG.error("Webhook signature validation failed:", err);
    expressRes.status(400).json({ error: "Invalid webhook signature" });
    return;
  }

  const entities = cds.entities("auto");
  const PaymentTransaction = entities["PaymentTransaction"];
  const Listing = entities["Listing"];

  try {
    if (webhookEvent.type === "checkout.session.completed") {
      await processCheckoutCompleted(webhookEvent, PaymentTransaction, Listing, expressRes);
      return;
    }

    if (
      webhookEvent.type === "checkout.session.expired" ||
      webhookEvent.type === "payment_intent.payment_failed"
    ) {
      await processPaymentFailure(webhookEvent, PaymentTransaction);
    }

    expressRes.status(200).json({ received: true });
  } catch (err) {
    LOG.error("Webhook processing error:", err);
    expressRes.status(500).json({ error: "Webhook processing failed" });
  }
}

// ─── Webhook sub-handlers ────────────────────────────────────────────────

async function processCheckoutCompleted(
  webhookEvent: { sessionId: string; amountCents: number; type: string },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  PaymentTransaction: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  Listing: any,
  expressRes: ExpressResponse,
): Promise<void> {
  const existing = await cds.run(
    SELECT.one.from(PaymentTransaction).where({ stripeSessionId: webhookEvent.sessionId }),
  );

  if (!existing) {
    LOG.warn(`No PaymentTransaction found for session ${webhookEvent.sessionId}`);
    expressRes.status(200).json({ received: true });
    return;
  }

  if (existing.status === "Succeeded") {
    LOG.info(`Webhook already processed for session ${webhookEvent.sessionId} (idempotent)`);
    expressRes.status(200).json({ received: true });
    return;
  }

  // Validate status transition
  const allowed = PAYMENT_STATUS_TRANSITIONS[existing.status as string];
  if (!allowed || !allowed.includes("Succeeded")) {
    LOG.warn(
      `Invalid transition from ${existing.status} to Succeeded for session ${webhookEvent.sessionId}`,
    );
    expressRes.status(200).json({ received: true });
    return;
  }

  const listingIds: string[] = existing.listingIds ? JSON.parse(existing.listingIds) : [];

  // Atomic batch publication within a transaction
  const tx = cds.tx();
  try {
    // Batch-fetch all listings in a single query (avoid N+1)
    const allListings = await tx.run(SELECT.from(Listing).where({ ID: { in: listingIds } }));

    // Validate all listings are still in draft status
    const listingMap = new Map<string, { ID: string; status: string }>(
      allListings.map((l: { ID: string; status: string }) => [l.ID, l]),
    );
    for (const listingId of listingIds) {
      const listing = listingMap.get(listingId);
      if (!listing) {
        throw new Error(`Listing ${listingId} not found during batch publication`);
      }
      if (listing.status !== "draft") {
        throw new Error(`Listing ${listingId} is no longer a draft (status: ${listing.status})`);
      }
    }

    // Update all listings to published
    const publishedAt = new Date().toISOString();
    for (const listingId of listingIds) {
      await tx.run(
        UPDATE(Listing).set({ status: "published", publishedAt }).where({ ID: listingId }),
      );
    }

    // Update payment transaction
    await tx.run(
      UPDATE(PaymentTransaction)
        .set({
          status: "Succeeded",
          processedAt: publishedAt,
          webhookReceivedAt: new Date().toISOString(),
        })
        .where({ ID: existing.ID }),
    );

    await tx.commit();

    // Audit trail entries (fire-and-forget, outside transaction)
    const sellerId = existing.sellerId;
    for (const listingId of listingIds) {
      auditLog({
        action: "listing.published",
        actorId: sellerId,
        targetType: "Listing",
        targetId: listingId,
        details: { paymentSessionId: webhookEvent.sessionId, batchSize: listingIds.length },
      }).catch((err) => LOG.error("Audit log failed:", err));
    }

    auditLog({
      action: "payment.processed",
      actorId: sellerId,
      targetType: "PaymentTransaction",
      targetId: existing.ID,
      details: {
        sessionId: webhookEvent.sessionId,
        listingCount: listingIds.length,
        amountCents: webhookEvent.amountCents,
      },
    }).catch((err) => LOG.error("Audit log failed:", err));

    // Initialize analytics records for published listings (fire-and-forget)
    const allEntities = cds.entities("auto");
    const ListingAnalytics = allEntities["ListingAnalytics"];
    if (ListingAnalytics) {
      for (const listingId of listingIds) {
        cds
          .run(
            INSERT.into(ListingAnalytics).entries({
              ID: cds.utils.uuid(),
              listingId,
              viewCount: 0,
              favoriteCount: 0,
              chatCount: 0,
            }),
          )
          .catch((err: unknown) => LOG.warn(`Failed to init analytics for ${listingId}:`, err));
      }
    }

    LOG.info(`Batch published ${listingIds.length} listings for session ${webhookEvent.sessionId}`);
    expressRes.status(200).json({ received: true });
  } catch (err) {
    await tx.rollback();
    LOG.error(`Batch publication failed for session ${webhookEvent.sessionId}, rolling back:`, err);

    // Mark transaction as failed
    await cds.run(
      UPDATE(PaymentTransaction)
        .set({
          status: "Failed",
          webhookReceivedAt: new Date().toISOString(),
        })
        .where({ ID: existing.ID }),
    );

    expressRes.status(500).json({ error: "Batch publication failed" });
  }
}

async function processPaymentFailure(
  webhookEvent: { sessionId: string; type: string },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  PaymentTransaction: any,
): Promise<void> {
  const existing = await cds.run(
    SELECT.one.from(PaymentTransaction).where({ stripeSessionId: webhookEvent.sessionId }),
  );

  if (existing && existing.status === "Pending") {
    await cds.run(
      UPDATE(PaymentTransaction)
        .set({
          status: "Failed",
          webhookReceivedAt: new Date().toISOString(),
        })
        .where({ ID: existing.ID }),
    );

    auditLog({
      action: "payment.processed",
      actorId: existing.sellerId,
      targetType: "PaymentTransaction",
      targetId: existing.ID,
      details: { sessionId: webhookEvent.sessionId, outcome: webhookEvent.type },
      severity: "warning",
    }).catch((err) => LOG.error("Audit log failed:", err));

    LOG.info(`Payment ${webhookEvent.type} for session ${webhookEvent.sessionId}`);
  }
}
