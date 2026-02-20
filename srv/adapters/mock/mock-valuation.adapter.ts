import type { ValuationRequest, ValuationResponse } from "@auto/shared";
import type { IValuationAdapter } from "../interfaces/valuation.interface";

/** Simple mock valuation based on vehicle attributes. */
function computeMockValuation(request: ValuationRequest): {
  estimated: number;
  min: number;
  max: number;
  confidence: number;
} {
  // Base values by segment (rough French market)
  const baseValues: Record<string, number> = {
    Renault: 18000,
    Peugeot: 20000,
    Citroën: 17000,
    Volkswagen: 24000,
    BMW: 35000,
    Mercedes: 37000,
    Audi: 32000,
    Toyota: 22000,
    Ford: 19000,
  };

  const base = baseValues[request.make] || 20000;

  // Depreciation: ~12% year 1, ~8% per year after
  const currentYear = new Date().getFullYear();
  const age = currentYear - request.year;
  let depreciation = 1;
  if (age >= 1) depreciation -= 0.12;
  if (age > 1) depreciation -= 0.08 * (age - 1);
  depreciation = Math.max(depreciation, 0.15);

  // Mileage factor: penalize above 15k km/year
  const expectedKm = age * 15000;
  const mileageFactor =
    request.mileageKm <= expectedKm ? 1 : 1 - (request.mileageKm - expectedKm) / 200000;

  const estimated = Math.round(base * depreciation * Math.max(mileageFactor, 0.5));
  const spread = 0.12;

  return {
    estimated,
    min: Math.round(estimated * (1 - spread)),
    max: Math.round(estimated * (1 + spread)),
    confidence: age <= 5 ? 0.85 : 0.7,
  };
}

export class MockValuationAdapter implements IValuationAdapter {
  readonly providerName = "mock";
  readonly providerVersion = "1.0.0";

  constructor(private delayMs = 0) {}

  async evaluate(request: ValuationRequest): Promise<ValuationResponse> {
    if (this.delayMs > 0) await delay(this.delayMs);

    const valuation = computeMockValuation(request);

    return {
      estimatedValueEur: valuation.estimated,
      minValueEur: valuation.min,
      maxValueEur: valuation.max,
      confidence: valuation.confidence,
      valuationDate: new Date().toISOString().split("T")[0],
      provider: { providerName: "mock", providerVersion: "1.0.0" },
    };
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
