import { LISTING_FIELDS } from "@auto/shared";

/**
 * Weights for visibility score calculation.
 * Higher weight = more impact on score.
 */
const FIELD_WEIGHTS: Record<string, number> = {
  // Required fields (highest weight)
  make: 10,
  model: 10,
  year: 10,
  fuelType: 8,
  mileage: 10,
  price: 15,
  condition: 8,
  description: 12,

  // Important optional fields
  plate: 3,
  vin: 3,
  registrationDate: 3,
  engineCapacityCc: 2,
  powerKw: 3,
  powerHp: 3,
  gearbox: 3,
  bodyType: 3,
  doors: 1,
  seats: 1,
  color: 2,
  co2GKm: 2,
  euroNorm: 2,
  energyClass: 1,
  critAirLevel: 2,
  critAirLabel: 1,
  critAirColor: 1,
  bodyClass: 1,
  engineCylinders: 1,
  manufacturer: 1,
  vehicleType: 1,
  plantCountry: 1,
  recallCount: 1,
  variant: 2,
  transmission: 2,
  driveType: 1,
  numberOfDoors: 1,
  interiorColor: 1,
  exteriorColor: 1,
  options: 5,
};

/**
 * Calculate the visibility score for a listing based on filled fields.
 * Returns a score from 0 to 100.
 *
 * @param filledFields - Map of field names to whether they have a value
 */
export function calculateVisibilityScore(filledFields: Record<string, boolean>): number {
  let totalWeight = 0;
  let earnedWeight = 0;

  for (const field of LISTING_FIELDS) {
    const weight = FIELD_WEIGHTS[field.fieldName] || 1;
    totalWeight += weight;

    if (filledFields[field.fieldName]) {
      earnedWeight += weight;
    }
  }

  if (totalWeight === 0) return 0;
  return Math.round((earnedWeight / totalWeight) * 100);
}

/**
 * Build a filled-fields map from a listing record.
 */
export function getFilledFieldsFromListing(
  listing: Record<string, unknown>,
): Record<string, boolean> {
  const filled: Record<string, boolean> = {};

  for (const field of LISTING_FIELDS) {
    const value = listing[field.fieldName];
    filled[field.fieldName] = value != null && value !== "";
  }

  return filled;
}
