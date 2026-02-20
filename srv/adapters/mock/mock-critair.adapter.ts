import type { CritAirRequest, CritAirResponse, CritAirLevel } from "@auto/shared";
import type { ICritAirCalculator } from "../interfaces/critair.interface";
import { delay } from "../../lib/async-utils";

/** Crit'Air classification based on French regulations. */
function classifyCritAir(
  fuelType: string,
  euroNorm: string,
): { level: CritAirLevel; color: string } {
  const fuel = fuelType.toLowerCase();
  const norm = euroNorm.toLowerCase();

  // Electric / hydrogen → Crit'Air 0
  if (fuel === "electrique" || fuel === "electric" || fuel === "hydrogene") {
    return { level: "0", color: "vert" };
  }

  // Gas + Euro 5/6 or Essence Euro 5/6 → Crit'Air 1
  if (fuel === "essence" || fuel === "gpl" || fuel === "gnv") {
    if (norm.includes("euro 6") || norm.includes("euro 5")) return { level: "1", color: "violet" };
    if (norm.includes("euro 4")) return { level: "2", color: "jaune" };
    if (norm.includes("euro 3") || norm.includes("euro 2")) return { level: "3", color: "orange" };
    return { level: "non-classe", color: "gris" };
  }

  // Diesel
  if (fuel === "diesel" || fuel === "gazole") {
    if (norm.includes("euro 6")) return { level: "2", color: "jaune" };
    if (norm.includes("euro 5") || norm.includes("euro 4")) return { level: "3", color: "orange" };
    if (norm.includes("euro 3")) return { level: "4", color: "bordeaux" };
    if (norm.includes("euro 2")) return { level: "5", color: "gris" };
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

export class MockCritAirAdapter implements ICritAirCalculator {
  readonly providerName = "mock";
  readonly providerVersion = "1.0.0";

  constructor(private delayMs = 0) {}

  async calculate(request: CritAirRequest): Promise<CritAirResponse> {
    if (this.delayMs > 0) await delay(this.delayMs);

    const { level, color } = classifyCritAir(request.fuelType, request.euroNorm);

    return {
      level,
      label: CRITAIR_LABELS[level],
      color,
      provider: { providerName: "mock", providerVersion: "1.0.0" },
    };
  }
}
