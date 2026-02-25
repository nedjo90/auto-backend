/**
 * SEO utility library for structured data generation.
 * Slug and ID extraction utilities are in @auto/shared.
 * Story 4-5: SEO Pages & Structured Data
 */

// Re-export from shared for backward compatibility
export { generateListingSlug as generateSlug, extractIdFromSlug } from "@auto/shared";

/**
 * Generate a canonical URL for search pages.
 * Normalizes and sorts query parameters to prevent duplicate content.
 */
export function generateCanonicalUrl(
  basePath: string,
  searchParams: Record<string, string | string[] | undefined>,
): string {
  const params = new URLSearchParams();
  const sortedKeys = Object.keys(searchParams).sort();

  for (const key of sortedKeys) {
    const value = searchParams[key];
    if (value === undefined || value === "" || value === null) continue;
    if (Array.isArray(value)) {
      const sorted = [...value].filter((v) => v !== "").sort();
      for (const v of sorted) {
        params.append(key, v);
      }
    } else {
      params.set(key, value as string);
    }
  }

  const qs = params.toString();
  return qs ? `${basePath}?${qs}` : basePath;
}

/** Listing data shape for structured data generation. */
export interface StructuredDataInput {
  ID: string;
  make?: string | null;
  model?: string | null;
  year?: number | null;
  mileage?: number | null;
  fuelType?: string | null;
  gearbox?: string | null;
  color?: string | null;
  vin?: string | null;
  price?: number | null;
  description?: string | null;
  status?: string;
  primaryPhotoUrl?: string | null;
}

/**
 * Generate Schema.org JSON-LD structured data for a listing.
 * Combines Vehicle, Product, and Offer schemas.
 */
export function generateStructuredData(listing: StructuredDataInput): Record<string, unknown> {
  const vehicle: Record<string, unknown> = {
    "@type": "Vehicle",
  };

  if (listing.make) vehicle.manufacturer = listing.make;
  if (listing.model) vehicle.model = listing.model;
  if (listing.year != null) {
    vehicle.modelDate = String(listing.year);
    vehicle.vehicleModelDate = String(listing.year);
  }
  if (listing.mileage != null) {
    vehicle.mileageFromOdometer = {
      "@type": "QuantitativeValue",
      value: listing.mileage,
      unitCode: "KMT",
    };
  }
  if (listing.fuelType) vehicle.fuelType = listing.fuelType;
  if (listing.gearbox) vehicle.vehicleTransmission = listing.gearbox;
  if (listing.color) vehicle.color = listing.color;
  if (listing.vin) vehicle.vehicleIdentificationNumber = listing.vin;

  const title = [listing.make, listing.model, listing.year].filter(Boolean).join(" ");

  const offer: Record<string, unknown> = {
    "@type": "Offer",
    priceCurrency: "EUR",
    availability:
      listing.status === "sold" ? "https://schema.org/SoldOut" : "https://schema.org/InStock",
  };
  if (listing.price != null) offer.price = listing.price;

  const product: Record<string, unknown> = {
    "@type": "Product",
    name: title || "Annonce",
    offers: offer,
  };
  if (listing.description) product.description = listing.description;
  if (listing.primaryPhotoUrl) product.image = listing.primaryPhotoUrl;
  if (listing.make) product.brand = { "@type": "Brand", name: listing.make };

  return {
    "@context": "https://schema.org",
    "@graph": [vehicle, product],
  };
}
