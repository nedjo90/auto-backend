/* eslint-disable @typescript-eslint/no-explicit-any */
import { MockVehicleLookupAdapter } from "../../../../srv/adapters/mock/mock-vehicle-lookup.adapter";
import { MockEmissionAdapter } from "../../../../srv/adapters/mock/mock-emission.adapter";
import { MockRecallAdapter } from "../../../../srv/adapters/mock/mock-recall.adapter";
import { MockCritAirAdapter } from "../../../../srv/adapters/mock/mock-critair.adapter";
import { MockVINTechnicalAdapter } from "../../../../srv/adapters/mock/mock-vin-technical.adapter";
import { MockHistoryAdapter } from "../../../../srv/adapters/mock/mock-history.adapter";
import { MockValuationAdapter } from "../../../../srv/adapters/mock/mock-valuation.adapter";
import { MockPaymentAdapter } from "../../../../srv/adapters/mock/mock-payment.adapter";

describe("MockVehicleLookupAdapter", () => {
  const adapter = new MockVehicleLookupAdapter();

  it("should have provider metadata", () => {
    expect(adapter.providerName).toBe("mock");
    expect(adapter.providerVersion).toBe("1.0.0");
  });

  it("should lookup vehicle by plate", async () => {
    const result = await adapter.lookup({ plate: "AB-123-CD" });
    expect(result.make).toBe("Renault");
    expect(result.model).toBe("Clio V");
    expect(result.vin).toBe("VF1RFB00X56789012");
  });

  it("should lookup vehicle by VIN", async () => {
    const result = await adapter.lookup({ vin: "VF3LCBHZ6JS123456" });
    expect(result.make).toBe("Peugeot");
    expect(result.model).toBe("308");
  });

  it("should return different vehicles for different plates", async () => {
    const renault = await adapter.lookup({ plate: "AB-123-CD" });
    const peugeot = await adapter.lookup({ plate: "EF-456-GH" });
    const vw = await adapter.lookup({ plate: "IJ-789-KL" });
    const bmw = await adapter.lookup({ plate: "MN-012-OP" });

    expect(renault.make).toBe("Renault");
    expect(peugeot.make).toBe("Peugeot");
    expect(vw.make).toBe("Volkswagen");
    expect(bmw.make).toBe("BMW");
  });

  it("should throw for unknown plate", async () => {
    await expect(adapter.lookup({ plate: "ZZ-999-ZZ" })).rejects.toThrow("Vehicle not found");
  });

  it("should throw when neither plate nor VIN provided", async () => {
    await expect(adapter.lookup({})).rejects.toThrow("Either plate or vin must be provided");
  });

  it("should return a copy (not reference) of vehicle data", async () => {
    const a = await adapter.lookup({ plate: "AB-123-CD" });
    const b = await adapter.lookup({ plate: "AB-123-CD" });
    expect(a).toEqual(b);
    expect(a).not.toBe(b);
  });
});

describe("MockEmissionAdapter", () => {
  const adapter = new MockEmissionAdapter();

  it("should have provider metadata", () => {
    expect(adapter.providerName).toBe("mock");
    expect(adapter.providerVersion).toBe("1.0.0");
  });

  it("should return emissions for known vehicle", async () => {
    const result = await adapter.getEmissions({
      make: "Renault",
      model: "Clio V",
      year: 2022,
      fuelType: "essence",
    });
    expect(result.co2GKm).toBe(128);
    expect(result.energyClass).toBe("B");
    expect(result.euroNorm).toBe("Euro 6d");
  });

  it("should return default emissions for unknown vehicle", async () => {
    const result = await adapter.getEmissions({
      make: "Unknown",
      model: "X",
      year: 2020,
      fuelType: "diesel",
    });
    expect(result.co2GKm).toBe(120);
    expect(result.fuelType).toBe("diesel");
  });

  it("should include pollutant data when available", async () => {
    const result = await adapter.getEmissions({
      make: "Peugeot",
      model: "308",
      year: 2023,
      fuelType: "diesel",
    });
    expect(result.pollutants).toBeDefined();
    expect(result.pollutants!.NOx).toBe(0.06);
  });
});

describe("MockRecallAdapter", () => {
  const adapter = new MockRecallAdapter();

  it("should have provider metadata", () => {
    expect(adapter.providerName).toBe("mock");
    expect(adapter.providerVersion).toBe("1.0.0");
  });

  it("should return recalls for vehicle with recalls", async () => {
    const result = await adapter.getRecalls({ make: "Peugeot", model: "308" });
    expect(result.recalls.length).toBe(2);
    expect(result.totalCount).toBe(2);
  });

  it("should return empty recalls for vehicle without recalls", async () => {
    const result = await adapter.getRecalls({ make: "Renault", model: "Clio V" });
    expect(result.recalls).toHaveLength(0);
    expect(result.totalCount).toBe(0);
  });

  it("should return empty for unknown vehicle", async () => {
    const result = await adapter.getRecalls({ make: "Tesla", model: "Model 3" });
    expect(result.recalls).toHaveLength(0);
  });

  it("should filter by year range", async () => {
    const result = await adapter.getRecalls({
      make: "Peugeot",
      model: "308",
      yearFrom: 2022,
      yearTo: 2023,
    });
    expect(result.recalls.length).toBeGreaterThanOrEqual(1);
  });
});

describe("MockCritAirAdapter", () => {
  const adapter = new MockCritAirAdapter();

  it("should have provider metadata", () => {
    expect(adapter.providerName).toBe("mock");
    expect(adapter.providerVersion).toBe("1.0.0");
  });

  it("should classify electric as Crit'Air 0", async () => {
    const result = await adapter.calculate({
      fuelType: "electrique",
      euroNorm: "N/A",
      registrationDate: "2023-01-01",
    });
    expect(result.level).toBe("0");
    expect(result.color).toBe("vert");
  });

  it("should classify essence Euro 6 as Crit'Air 1", async () => {
    const result = await adapter.calculate({
      fuelType: "essence",
      euroNorm: "Euro 6d",
      registrationDate: "2022-01-01",
    });
    expect(result.level).toBe("1");
    expect(result.color).toBe("violet");
  });

  it("should classify diesel Euro 6 as Crit'Air 2", async () => {
    const result = await adapter.calculate({
      fuelType: "diesel",
      euroNorm: "Euro 6d-FULL",
      registrationDate: "2023-01-01",
    });
    expect(result.level).toBe("2");
    expect(result.color).toBe("jaune");
  });

  it("should classify diesel Euro 5 as Crit'Air 3", async () => {
    const result = await adapter.calculate({
      fuelType: "diesel",
      euroNorm: "Euro 5",
      registrationDate: "2015-01-01",
    });
    expect(result.level).toBe("3");
    expect(result.color).toBe("orange");
  });

  it("should classify diesel Euro 3 as Crit'Air 4", async () => {
    const result = await adapter.calculate({
      fuelType: "diesel",
      euroNorm: "Euro 3",
      registrationDate: "2005-01-01",
    });
    expect(result.level).toBe("4");
    expect(result.color).toBe("bordeaux");
  });

  it("should classify old diesel as Crit'Air 5", async () => {
    const result = await adapter.calculate({
      fuelType: "diesel",
      euroNorm: "Euro 2",
      registrationDate: "2000-01-01",
    });
    expect(result.level).toBe("5");
    expect(result.color).toBe("gris");
  });

  it("should classify essence Euro 4 as Crit'Air 2", async () => {
    const result = await adapter.calculate({
      fuelType: "essence",
      euroNorm: "Euro 4",
      registrationDate: "2010-01-01",
    });
    expect(result.level).toBe("2");
    expect(result.color).toBe("jaune");
  });

  it("should return non-classe for unknown fuel types", async () => {
    const result = await adapter.calculate({
      fuelType: "unknown_fuel",
      euroNorm: "Euro 6",
      registrationDate: "2023-01-01",
    });
    expect(result.level).toBe("non-classe");
  });
});

describe("MockVINTechnicalAdapter", () => {
  const adapter = new MockVINTechnicalAdapter();

  it("should have provider metadata", () => {
    expect(adapter.providerName).toBe("mock");
    expect(adapter.providerVersion).toBe("1.0.0");
  });

  it("should decode known VIN", async () => {
    const result = await adapter.decode({ vin: "VF1RFB00X56789012" });
    expect(result.make).toBe("Renault");
    expect(result.model).toBe("Clio");
    expect(result.manufacturer).toBe("Renault SAS");
  });

  it("should throw for unknown VIN", async () => {
    await expect(adapter.decode({ vin: "UNKNOWN1234567890" })).rejects.toThrow("VIN not found");
  });

  it("should return different data for different VINs", async () => {
    const renault = await adapter.decode({ vin: "VF1RFB00X56789012" });
    const bmw = await adapter.decode({ vin: "WBA11AA010CH12345" });
    expect(renault.make).not.toBe(bmw.make);
  });
});

describe("MockHistoryAdapter", () => {
  const adapter = new MockHistoryAdapter();

  it("should have provider metadata", () => {
    expect(adapter.providerName).toBe("mock");
    expect(adapter.providerVersion).toBe("1.0.0");
  });

  it("should return history for known VIN", async () => {
    const result = await adapter.getHistory({ vin: "VF1RFB00X56789012" });
    expect(result.ownerCount).toBe(2);
    expect(result.stolen).toBe(false);
    expect(result.mileageRecords.length).toBe(2);
  });

  it("should return history with accidents", async () => {
    const result = await adapter.getHistory({ vin: "WVWZZZ3CZWE123456" });
    expect(result.accidents.length).toBe(1);
    expect(result.totalDamageCount).toBe(1);
  });

  it("should throw for unknown VIN", async () => {
    await expect(adapter.getHistory({ vin: "UNKNOWN" })).rejects.toThrow("No history found");
  });
});

describe("MockValuationAdapter", () => {
  const adapter = new MockValuationAdapter();

  it("should have provider metadata", () => {
    expect(adapter.providerName).toBe("mock");
    expect(adapter.providerVersion).toBe("1.0.0");
  });

  it("should return valuation for vehicle", async () => {
    const result = await adapter.evaluate({
      make: "BMW",
      model: "Série 3",
      year: 2020,
      mileageKm: 60000,
      fuelType: "diesel",
    });
    expect(result.estimatedValueEur).toBeGreaterThan(0);
    expect(result.minValueEur).toBeLessThan(result.estimatedValueEur);
    expect(result.maxValueEur).toBeGreaterThan(result.estimatedValueEur);
    expect(result.confidence).toBeGreaterThan(0);
    expect(result.confidence).toBeLessThanOrEqual(1);
  });

  it("should depreciate older vehicles more", async () => {
    const recent = await adapter.evaluate({
      make: "Renault",
      model: "Clio",
      year: 2024,
      mileageKm: 5000,
      fuelType: "essence",
    });
    const old = await adapter.evaluate({
      make: "Renault",
      model: "Clio",
      year: 2015,
      mileageKm: 120000,
      fuelType: "essence",
    });
    expect(recent.estimatedValueEur).toBeGreaterThan(old.estimatedValueEur);
  });

  it("should use default base value for unknown makes", async () => {
    const result = await adapter.evaluate({
      make: "UnknownBrand",
      model: "X",
      year: 2023,
      mileageKm: 10000,
      fuelType: "essence",
    });
    expect(result.estimatedValueEur).toBeGreaterThan(0);
  });
});

describe("MockPaymentAdapter", () => {
  let adapter: MockPaymentAdapter;

  beforeEach(() => {
    adapter = new MockPaymentAdapter();
  });

  it("should have provider metadata", () => {
    expect(adapter.providerName).toBe("mock");
    expect(adapter.providerVersion).toBe("1.0.0");
  });

  it("should create checkout session", async () => {
    const result = await adapter.createCheckoutSession({
      amountCents: 2990,
      currency: "eur",
      description: "Publication annonce",
      customerId: "user-123",
      successUrl: "https://auto.fr/success",
      cancelUrl: "https://auto.fr/cancel",
    });
    expect(result.sessionId).toContain("mock_cs_");
    expect(result.sessionUrl).toContain(result.sessionId);
    expect(result.status).toBe("pending");
  });

  it("should create unique session IDs", async () => {
    const req = {
      amountCents: 100,
      currency: "eur",
      description: "Test",
      customerId: "user-1",
      successUrl: "https://auto.fr/success",
      cancelUrl: "https://auto.fr/cancel",
    };
    const s1 = await adapter.createCheckoutSession(req);
    const s2 = await adapter.createCheckoutSession(req);
    expect(s1.sessionId).not.toBe(s2.sessionId);
  });

  it("should simulate payment failure", async () => {
    adapter.simulateFailure = true;
    await expect(
      adapter.createCheckoutSession({
        amountCents: 100,
        currency: "eur",
        description: "Test",
        customerId: "user-1",
        successUrl: "https://auto.fr/success",
        cancelUrl: "https://auto.fr/cancel",
      }),
    ).rejects.toThrow("Payment provider unavailable");
  });

  it("should handle webhook payload", async () => {
    const payload = JSON.stringify({
      type: "checkout.session.completed",
      sessionId: "mock_cs_123",
      amountCents: 2990,
      customerId: "user-123",
      metadata: { listingId: "listing-456" },
    });

    const event = await adapter.handleWebhook(payload, "sig_mock");
    expect(event.type).toBe("checkout.session.completed");
    expect(event.sessionId).toBe("mock_cs_123");
    expect(event.amountCents).toBe(2990);
    expect(event.metadata.listingId).toBe("listing-456");
  });

  it("should handle minimal webhook payload", async () => {
    const event = await adapter.handleWebhook("{}", "sig_mock");
    expect(event.type).toBe("checkout.session.completed");
    expect(event.sessionId).toBe("mock_cs_unknown");
  });
});
