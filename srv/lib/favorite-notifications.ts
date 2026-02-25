import cds from "@sap/cds";
import { createNotification } from "./notification-emitter";

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
  const body = `Le prix du ${label} a ${direction} de ${oldPrice}€ à ${newPrice}€`;

  let created = 0;
  for (const f of favorites) {
    const result = await createNotification({
      userId: f.userId,
      type: "price_change",
      title: "Changement de prix",
      body,
      actionUrl: `/listing/${listingId}`,
      listingId,
    });
    if (result) created++;
  }

  LOG.info(`Created ${created} price_change notifications for listing ${listingId}`);
  return created;
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
  const body = `Le ${label} que vous suivez a été vendu`;

  let created = 0;
  for (const f of favorites) {
    const result = await createNotification({
      userId: f.userId,
      type: "sold",
      title: "Véhicule vendu",
      body,
      actionUrl: `/listing/${listingId}`,
      listingId,
    });
    if (result) created++;
  }

  LOG.info(`Created ${created} sold notifications for listing ${listingId}`);
  return created;
}
