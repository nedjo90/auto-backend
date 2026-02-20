import type { CritAirRequest, CritAirResponse, CritAirLevel } from "@auto/shared";
import type { ICritAirCalculator } from "./interfaces/critair.interface";

/**
 * Local Crit'Air calculator based on French regulations (Arrêté du 21 juin 2016).
 * No external API call — pure computation from fuel type, Euro norm, and registration date.
 */
export class LocalCritAirCalculator implements ICritAirCalculator {
  readonly providerName = "local-critair";
  readonly providerVersion = "1.0.0";

  async calculate(request: CritAirRequest): Promise<CritAirResponse> {
    const fuel = normalizeFuelType(request.fuelType);
    const euroNum = parseEuroNorm(request.euroNorm);
    const regDate = new Date(request.registrationDate);

    const { level, color } = classify(fuel, euroNum, regDate);

    return {
      level,
      label: CRITAIR_LABELS[level],
      color,
      provider: { providerName: this.providerName, providerVersion: this.providerVersion },
    };
  }
}

type FuelCategory = "electric" | "essence" | "diesel" | "unknown";

function normalizeFuelType(fuelType: string): FuelCategory {
  const lower = fuelType.toLowerCase().trim();
  if (
    lower === "electrique" ||
    lower === "electric" ||
    lower === "hydrogene" ||
    lower === "hydrogen"
  ) {
    return "electric";
  }
  if (
    lower === "essence" ||
    lower === "gasoline" ||
    lower === "petrol" ||
    lower === "gpl" ||
    lower === "gnv" ||
    lower === "e85"
  ) {
    return "essence";
  }
  if (lower === "diesel" || lower === "gazole") {
    return "diesel";
  }
  return "unknown";
}

function parseEuroNorm(euroNorm: string): number | null {
  // Match patterns like "Euro 6d", "Euro 6d-FULL", "Euro 5", "6", "EURO6"
  const match = euroNorm.match(/(\d+)/);
  if (!match) return null;
  return parseInt(match[1], 10);
}

function classify(
  fuel: FuelCategory,
  euroNum: number | null,
  regDate: Date,
): { level: CritAirLevel; color: string } {
  // Electric & hydrogen → always Crit'Air 0
  if (fuel === "electric") {
    return { level: "0", color: "vert" };
  }

  // Essence (petrol, LPG, CNG)
  if (fuel === "essence") {
    if (euroNum !== null) {
      if (euroNum >= 5) return { level: "1", color: "violet" };
      if (euroNum === 4) return { level: "2", color: "jaune" };
      if (euroNum === 3 || euroNum === 2) return { level: "3", color: "orange" };
    }
    // Fallback on registration date for very old vehicles
    const year = regDate.getFullYear();
    if (year >= 2011) return { level: "1", color: "violet" };
    if (year >= 2006) return { level: "2", color: "jaune" };
    if (year >= 1997) return { level: "3", color: "orange" };
    return { level: "non-classe", color: "gris" };
  }

  // Diesel
  if (fuel === "diesel") {
    if (euroNum !== null) {
      if (euroNum >= 6) return { level: "2", color: "jaune" };
      if (euroNum === 5 || euroNum === 4) return { level: "3", color: "orange" };
      if (euroNum === 3) return { level: "4", color: "bordeaux" };
      if (euroNum === 2) return { level: "5", color: "gris" };
    }
    // Fallback on registration date
    const year = regDate.getFullYear();
    if (year >= 2011) return { level: "2", color: "jaune" };
    if (year >= 2006) return { level: "3", color: "orange" };
    if (year >= 2001) return { level: "4", color: "bordeaux" };
    if (year >= 1997) return { level: "5", color: "gris" };
    return { level: "non-classe", color: "gris" };
  }

  return { level: "non-classe", color: "gris" };
}

const CRITAIR_LABELS: Record<CritAirLevel, string> = {
  "0": "Crit'Air 0 – Zéro émission",
  "1": "Crit'Air 1",
  "2": "Crit'Air 2",
  "3": "Crit'Air 3",
  "4": "Crit'Air 4",
  "5": "Crit'Air 5",
  "non-classe": "Non classé",
};
