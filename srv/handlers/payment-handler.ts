import cds from "@sap/cds";
import type { Request as ExpressRequest, Response as ExpressResponse } from "express";
import { LISTING_PRICE_CONFIG_KEY, PAYMENT_STATUS_TRANSITIONS } from "@auto/shared";
import { getPayment } from "../adapters/factory/adapter-factory";
import { configCache } from "../lib/config-cache";
import { auditLog } from "../middleware/audit-trail";

const LOG = cds.log("payment");

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

// ─── Helper: validate listing eligibility ─────────────────────────────────

async function validateListingEligibility(
  listingIds: string[],
  sellerId: string,
): Promise<{ valid: boolean; error?: string; listings?: Record<string, unknown>[] }> {
  const entities = cds.entities("auto");
  const Listing = entities["Listing"];

  const listings = await cds.run(SELECT.from(Listing).where({ ID: { in: listingIds } }));

  if (listings.length !== listingIds.length) {
    const foundIds = new Set(listings.map((l: { ID: string }) => l.ID));
    const missing = listingIds.filter((id) => !foundIds.has(id));
    return { valid: false, error: `Listings not found: ${missing.join(", ")}` };
  }

  for (const listing of listings) {
    if (listing.sellerId !== sellerId) {
      return { valid: false, error: `Listing ${listing.ID} does not belong to you` };
    }
    if (listing.status !== "draft") {
      return {
        valid: false,
        error: `Listing ${listing.ID} is not a draft (status: ${listing.status})`,
      };
    }
    if (!listing.declarationId) {
      return { valid: false, error: `Listing ${listing.ID} has no declaration completed` };
    }
  }

  return { valid: true, listings };
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
        visibilityScore: d.visibilityScore || 0,
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

  let listingIds: string[];
  try {
    listingIds = JSON.parse(listingIdsJson);
    if (!Array.isArray(listingIds) || listingIds.length === 0) {
      return req.error(400, "listingIds must be a non-empty array");
    }
  } catch {
    return req.error(400, "Invalid listingIds format");
  }

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

  let listingIds: string[];
  try {
    listingIds = JSON.parse(listingIdsJson);
    if (!Array.isArray(listingIds) || listingIds.length === 0) {
      return req.error(400, "listingIds must be a non-empty array");
    }
  } catch {
    return req.error(400, "Invalid listingIds format");
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

  const rawBody =
    typeof expressReq.body === "string"
      ? expressReq.body
      : Buffer.isBuffer(expressReq.body)
        ? expressReq.body.toString("utf8")
        : JSON.stringify(expressReq.body);

  let webhookEvent;
  try {
    const payment = getPayment();
    webhookEvent = await payment.handleWebhook(rawBody, signature);
  } catch (err) {
    LOG.error("Webhook signature validation failed:", err);
    expressRes.status(400).json({ error: "Invalid webhook signature" });
    return;
  }

  const entities = cds.entities("auto");
  const PaymentTransaction = entities["PaymentTransaction"];
  const Listing = entities["Listing"];

  try {
    if (webhookEvent.type === "checkout.session.completed") {
      // Idempotency check: has this session already been processed?
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
        // Validate all listings are still in draft status
        for (const listingId of listingIds) {
          const listing = await tx.run(SELECT.one.from(Listing).where({ ID: listingId }));
          if (!listing) {
            throw new Error(`Listing ${listingId} not found during batch publication`);
          }
          if (listing.status !== "draft") {
            throw new Error(
              `Listing ${listingId} is no longer a draft (status: ${listing.status})`,
            );
          }
        }

        // Update all listings to published
        const publishedAt = new Date().toISOString();
        for (const listingId of listingIds) {
          await tx.run(UPDATE(Listing).set({ status: "published" }).where({ ID: listingId }));
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
          }).catch(() => {});
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
        }).catch(() => {});

        LOG.info(
          `Batch published ${listingIds.length} listings for session ${webhookEvent.sessionId}`,
        );
      } catch (err) {
        await tx.rollback();
        LOG.error(
          `Batch publication failed for session ${webhookEvent.sessionId}, rolling back:`,
          err,
        );

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
        return;
      }
    } else if (webhookEvent.type === "payment_intent.payment_failed") {
      // Handle payment failure
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
          details: { sessionId: webhookEvent.sessionId, outcome: "failed" },
          severity: "warning",
        }).catch(() => {});

        LOG.info(`Payment failed for session ${webhookEvent.sessionId}`);
      }
    }

    expressRes.status(200).json({ received: true });
  } catch (err) {
    LOG.error("Webhook processing error:", err);
    expressRes.status(500).json({ error: "Webhook processing failed" });
  }
}
