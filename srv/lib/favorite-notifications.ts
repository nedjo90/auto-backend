import cds from "@sap/cds";

const LOG = cds.log("favorite-notifications");

/**
 * Create notifications for all users who favorited a listing when its price changes.
 */
export async function notifyPriceChange(
  listingId: string,
  make: string | null,
  model: string | null,
  oldPrice: number,
  newPrice: number,
): Promise<number> {
  const entities = cds.entities("auto");

  const favorites = await cds.run(
    SELECT.from(entities["Favorite"]).columns("userId").where({ listingId }),
  );

  if (favorites.length === 0) return 0;

  const direction = newPrice < oldPrice ? "baissé" : "augmenté";
  const label = [make, model].filter(Boolean).join(" ") || "véhicule";
  const message = `Le prix du ${label} a ${direction} de ${oldPrice}€ à ${newPrice}€`;

  const now = new Date().toISOString();
  const entries = favorites.map((f: { userId: string }) => ({
    ID: cds.utils.uuid(),
    userId: f.userId,
    type: "price_change",
    message,
    listingId,
    isRead: false,
    createdAt: now,
  }));

  await cds.run(INSERT.into(entities["Notification"]).entries(entries));

  LOG.info(`Created ${entries.length} price_change notifications for listing ${listingId}`);
  return entries.length;
}

/**
 * Create notifications for all users who favorited a listing when it is sold.
 */
export async function notifySold(
  listingId: string,
  make: string | null,
  model: string | null,
): Promise<number> {
  const entities = cds.entities("auto");

  const favorites = await cds.run(
    SELECT.from(entities["Favorite"]).columns("userId").where({ listingId }),
  );

  if (favorites.length === 0) return 0;

  const label = [make, model].filter(Boolean).join(" ") || "véhicule";
  const message = `Le ${label} que vous suivez a été vendu`;

  const now = new Date().toISOString();
  const entries = favorites.map((f: { userId: string }) => ({
    ID: cds.utils.uuid(),
    userId: f.userId,
    type: "sold",
    message,
    listingId,
    isRead: false,
    createdAt: now,
  }));

  await cds.run(INSERT.into(entities["Notification"]).entries(entries));

  LOG.info(`Created ${entries.length} sold notifications for listing ${listingId}`);
  return entries.length;
}
