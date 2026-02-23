import {
  LISTING_FIELDS,
  CERTIFIABLE_FIELDS,
  DECLARED_ONLY_FIELDS,
  DEFAULT_VISIBILITY_WEIGHTS,
  VISIBILITY_LABELS,
  VISIBILITY_SUGGESTIONS,
  VISIBILITY_CONFIG_KEYS,
} from "@auto/shared";
import type {
  VisibilityScoreInput,
  VisibilityScoreWeights,
  VisibilityScoreResult,
  ScoreSuggestion,
} from "@auto/shared";
import { configCache } from "./config-cache";

/**
 * Load visibility score weights from ConfigBoostFactor via configCache.
 * Falls back to DEFAULT_VISIBILITY_WEIGHTS for any missing entries.
 */
export function loadWeightsFromConfig(): VisibilityScoreWeights {
  const weights = { ...DEFAULT_VISIBILITY_WEIGHTS };

  if (!configCache.isReady()) return weights;

  const keyMap = VISIBILITY_CONFIG_KEYS;
  for (const [prop, configKey] of Object.entries(keyMap)) {
    const entry = configCache.get<{ factor: number }>("ConfigBoostFactor", configKey);
    if (entry && entry.factor != null) {
      (weights as Record<string, number>)[prop] = Number(entry.factor);
    }
  }

  return weights;
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

/**
 * Calculate the visibility score for a listing.
 *
 * Scoring model:
 * - Each filled certified field earns certifiedFieldWeight points
 * - Each filled declared field earns declaredFieldWeight points
 * - Each photo earns photoWeight points (up to photoMax)
 * - History report presence earns historyReportWeight points
 * - Description length >= descriptionMinLength earns descriptionBonusWeight points
 * - Raw points are normalized to 0-100
 * - Vehicle age normalization adjusts score ceiling for older vehicles
 *
 * @param input - Listing data, photo count, history report presence
 * @param weights - Optional weights override (defaults loaded from ConfigBoostFactor)
 */
export function calculateVisibilityScore(
  input: VisibilityScoreInput,
  weights?: VisibilityScoreWeights,
): VisibilityScoreResult {
  const w = weights ?? loadWeightsFromConfig();
  const filledFields = getFilledFieldsFromListing(input.listing);

  // Count filled fields by type
  let certifiedFilled = 0;
  let declaredFilled = 0;
  for (const field of LISTING_FIELDS) {
    if (filledFields[field.fieldName]) {
      if (field.fieldType === "certifiable") {
        certifiedFilled++;
      } else {
        declaredFilled++;
      }
    }
  }

  // Calculate earned points
  const certifiedPoints = certifiedFilled * w.certifiedFieldWeight;
  const declaredPoints = declaredFilled * w.declaredFieldWeight;
  const photoPoints = Math.min(input.photoCount, w.photoMax) * w.photoWeight;
  const historyPoints = input.hasHistoryReport ? w.historyReportWeight : 0;

  const descriptionValue = input.listing.description;
  const descriptionLength = typeof descriptionValue === "string" ? descriptionValue.length : 0;
  const descriptionPoints =
    descriptionLength >= w.descriptionMinLength ? w.descriptionBonusWeight : 0;

  const earnedPoints =
    certifiedPoints + declaredPoints + photoPoints + historyPoints + descriptionPoints;

  // Calculate max possible points
  const maxCertified = CERTIFIABLE_FIELDS.length * w.certifiedFieldWeight;
  const maxDeclared = DECLARED_ONLY_FIELDS.length * w.declaredFieldWeight;
  const maxPhoto = w.photoMax * w.photoWeight;
  const maxHistory = w.historyReportWeight;
  const maxDescription = w.descriptionBonusWeight;
  const maxPossible = maxCertified + maxDeclared + maxPhoto + maxHistory + maxDescription;

  if (maxPossible === 0) {
    return { score: 0, label: VISIBILITY_LABELS.low, suggestions: [] };
  }

  // Normalize to 0-100
  let score = Math.round((earnedPoints / maxPossible) * 100);
  score = Math.min(100, Math.max(0, score));

  // Vehicle age normalization
  let normalizedScore: number | undefined;
  let normalizationMessage: string | undefined;

  const vehicleYear = input.listing.year;
  if (typeof vehicleYear === "number" && vehicleYear > 0) {
    const currentYear = new Date().getFullYear();
    const vehicleAge = currentYear - vehicleYear;

    if (vehicleAge > w.ageThreshold) {
      // Reduce the max possible by ageNormalizationFactor, effectively boosting the score
      const adjustedMax = maxPossible * w.ageNormalizationFactor;
      normalizedScore = Math.round((earnedPoints / adjustedMax) * 100);
      normalizedScore = Math.min(100, Math.max(0, normalizedScore));
      normalizationMessage = `Bon score pour un véhicule de ${vehicleYear}`;
    }
  }

  // Use normalized score for label if applicable
  const effectiveScore = normalizedScore ?? score;

  // Determine label
  let label: string;
  if (effectiveScore < w.labelThresholdLow) {
    label = VISIBILITY_LABELS.low;
  } else if (effectiveScore < w.labelThresholdHigh) {
    label = VISIBILITY_LABELS.medium;
  } else {
    label = VISIBILITY_LABELS.high;
  }

  // Generate suggestions
  const suggestions = generateSuggestions(input, filledFields, w);

  return {
    score,
    label,
    suggestions,
    normalizedScore,
    normalizationMessage,
  };
}

/**
 * Generate positive suggestions for improving the visibility score.
 * Returns suggestions sorted by highest potential boost first.
 */
function generateSuggestions(
  input: VisibilityScoreInput,
  filledFields: Record<string, boolean>,
  weights: VisibilityScoreWeights,
): ScoreSuggestion[] {
  const maxPossible = calculateMaxPossible(weights);
  if (maxPossible === 0) return [];

  const suggestions: ScoreSuggestion[] = [];

  // Suggest missing listing fields
  for (const field of LISTING_FIELDS) {
    if (!filledFields[field.fieldName]) {
      const weight =
        field.fieldType === "certifiable"
          ? weights.certifiedFieldWeight
          : weights.declaredFieldWeight;
      const boost = Math.round((weight / maxPossible) * 100);
      if (boost > 0) {
        const message =
          VISIBILITY_SUGGESTIONS[field.fieldName] ||
          `Renseignez ${field.labelFr.toLowerCase()} pour gagner en visibilité`;
        suggestions.push({ field: field.fieldName, message, boost });
      }
    }
  }

  // Suggest more photos if below max
  if (input.photoCount < weights.photoMax) {
    const additionalPhotos = weights.photoMax - input.photoCount;
    const boost = Math.round(((additionalPhotos * weights.photoWeight) / maxPossible) * 100);
    if (boost > 0) {
      suggestions.push({
        field: "photo",
        message: VISIBILITY_SUGGESTIONS.photo || "Ajoutez des photos",
        boost,
      });
    }
  }

  // Suggest history report if missing
  if (!input.hasHistoryReport) {
    const boost = Math.round((weights.historyReportWeight / maxPossible) * 100);
    if (boost > 0) {
      suggestions.push({
        field: "historyReport",
        message: VISIBILITY_SUGGESTIONS.historyReport || "Ajoutez un rapport d'historique",
        boost,
      });
    }
  }

  // Suggest longer description if below threshold
  const descValue = input.listing.description;
  const descLen = typeof descValue === "string" ? descValue.length : 0;
  if (descLen < weights.descriptionMinLength) {
    const boost = Math.round((weights.descriptionBonusWeight / maxPossible) * 100);
    if (boost > 0) {
      suggestions.push({
        field: "descriptionBonus",
        message: VISIBILITY_SUGGESTIONS.descriptionBonus || "Enrichissez votre description",
        boost,
      });
    }
  }

  // Sort by highest boost first
  suggestions.sort((a, b) => b.boost - a.boost);

  return suggestions;
}

/**
 * Calculate the maximum possible score points.
 */
function calculateMaxPossible(weights: VisibilityScoreWeights): number {
  const maxCertified = CERTIFIABLE_FIELDS.length * weights.certifiedFieldWeight;
  const maxDeclared = DECLARED_ONLY_FIELDS.length * weights.declaredFieldWeight;
  const maxPhoto = weights.photoMax * weights.photoWeight;
  return (
    maxCertified +
    maxDeclared +
    maxPhoto +
    weights.historyReportWeight +
    weights.descriptionBonusWeight
  );
}
