/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-require-imports, @typescript-eslint/no-unused-vars */

/**
 * Visibility Score Integration Tests (Story 3-5, Task 7)
 * Tests: progressive fill, age normalization, suggestion accuracy, SignalR push.
 */

const mockRun = jest.fn();

jest.mock("@sap/cds", () => {
  const mockLog = { warn: jest.fn(), info: jest.fn(), error: jest.fn() };
  return {
    __esModule: true,
    default: {
      entities: jest.fn(() => ({
        Listing: "Listing",
        ListingPhoto: "ListingPhoto",
      })),
      run: (...args: any[]) => mockRun(...args),
      log: jest.fn(() => mockLog),
      utils: { uuid: jest.fn(() => "uuid-1") },
      ApplicationService: class {
        async init() {}
        on(_event: string, _handler: any) {}
      },
    },
  };
});

jest.mock("../../../srv/lib/config-cache", () => ({
  configCache: {
    isReady: jest.fn(() => false),
    get: jest.fn(() => undefined),
    getAll: jest.fn(() => []),
  },
}));

const mockSignalRSendToUser = jest.fn().mockResolvedValue(undefined);
jest.mock("../../../srv/lib/signalr-client", () => ({
  signalrClient: {
    sendToUser: (...args: any[]) => mockSignalRSendToUser(...args),
    isConfigured: jest.fn(() => true),
  },
  SIGNALR_HUBS: { admin: "admin", liveScore: "live-score" },
}));

jest.mock("../../../srv/lib/certification", () => ({
  getCertifiedFields: jest.fn().mockResolvedValue([]),
  overrideCertifiedField: jest.fn(),
}));
jest.mock("../../../srv/lib/api-cache", () => ({
  getCachedResponse: jest.fn(),
  setCachedResponse: jest.fn(),
}));
jest.mock("../../../srv/lib/audit-logger", () => ({
  logAudit: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("../../../srv/lib/photo-storage", () => ({
  validateMimeType: jest.fn(() => true),
  validateFileSize: jest.fn(() => true),
  canUploadPhoto: jest.fn().mockResolvedValue(true),
  uploadPhotoBlob: jest.fn().mockResolvedValue({ blobUrl: "b", cdnUrl: "c" }),
  deletePhotoBlob: jest.fn().mockResolvedValue(undefined),
  getNextSortOrder: jest.fn().mockResolvedValue(0),
  getPhotoCount: jest.fn(),
  getMaxPhotos: jest.fn(() => 20),
}));

jest.mock("@auto/shared", () => ({
  validateListingField: jest.fn(() => null),
  CERTIFIABLE_FIELDS: ["make", "model", "year", "fuelType", "color", "co2GKm"],
  DECLARED_ONLY_FIELDS: ["price", "mileage"],
  LISTING_FIELDS: [
    {
      fieldName: "make",
      fieldType: "certifiable",
      category: "vehicle_identity",
      labelFr: "Marque",
      required: true,
    },
    {
      fieldName: "model",
      fieldType: "certifiable",
      category: "vehicle_identity",
      labelFr: "Modèle",
      required: true,
    },
    {
      fieldName: "year",
      fieldType: "certifiable",
      category: "vehicle_identity",
      labelFr: "Année",
      required: false,
    },
    {
      fieldName: "fuelType",
      fieldType: "certifiable",
      category: "technical_details",
      labelFr: "Carburant",
      required: false,
    },
    {
      fieldName: "color",
      fieldType: "certifiable",
      category: "appearance",
      labelFr: "Couleur",
      required: false,
    },
    {
      fieldName: "co2GKm",
      fieldType: "certifiable",
      category: "emissions",
      labelFr: "CO2 g/km",
      required: false,
    },
    {
      fieldName: "price",
      fieldType: "declaredOnly",
      category: "pricing",
      labelFr: "Prix",
      required: true,
    },
    {
      fieldName: "mileage",
      fieldType: "declaredOnly",
      category: "technical_details",
      labelFr: "Kilométrage",
      required: true,
    },
  ],
  DEFAULT_VISIBILITY_WEIGHTS: {
    certifiedFieldWeight: 5,
    declaredFieldWeight: 2,
    photoWeight: 3,
    photoMax: 10,
    historyReportWeight: 10,
    descriptionBonusWeight: 5,
    descriptionMinLength: 100,
    ageThreshold: 15,
    ageNormalizationFactor: 0.8,
    labelThresholdLow: 34,
    labelThresholdHigh: 67,
  },
  VISIBILITY_LABELS: {
    low: "Partiellement documenté",
    medium: "Bien documenté",
    high: "Très documenté",
  },
  VISIBILITY_SUGGESTIONS: {
    make: "Indiquez la marque",
    model: "Renseignez le modèle",
    price: "Indiquez le prix",
    mileage: "Renseignez le kilométrage",
    photo: "Ajoutez des photos",
    historyReport: "Ajoutez un rapport d'historique",
    descriptionBonus: "Enrichissez votre description",
  },
  VISIBILITY_CONFIG_KEYS: {
    certifiedFieldWeight: "visibility.certifiedField",
    declaredFieldWeight: "visibility.declaredField",
    photoWeight: "visibility.photo",
    photoMax: "visibility.photoMax",
    historyReportWeight: "visibility.historyReport",
    descriptionBonusWeight: "visibility.descriptionBonus",
    descriptionMinLength: "visibility.descriptionMinLength",
    ageThreshold: "visibility.ageThreshold",
    ageNormalizationFactor: "visibility.ageNormFactor",
    labelThresholdLow: "visibility.labelThresholdLow",
    labelThresholdHigh: "visibility.labelThresholdHigh",
  },
  PHOTO_ALLOWED_MIME_TYPES: ["image/jpeg", "image/png", "image/webp", "image/heic"],
}));

// CDS query globals
(global as any).SELECT = {
  one: { from: jest.fn().mockReturnValue({ where: jest.fn().mockReturnValue("q") }) },
  from: jest.fn().mockReturnValue({
    where: jest.fn().mockReturnValue({
      orderBy: jest.fn().mockReturnValue("q"),
    }),
  }),
};
(global as any).INSERT = {
  into: jest.fn().mockReturnValue({ entries: jest.fn().mockReturnValue("q") }),
};
(global as any).UPDATE = jest.fn().mockReturnValue({
  set: jest.fn().mockReturnValue({ where: jest.fn().mockReturnValue("q") }),
});
(global as any).DELETE = {
  from: jest.fn().mockReturnValue({ where: jest.fn().mockReturnValue("q") }),
};

import { calculateVisibilityScore } from "../../../srv/lib/visibility-score";
import type { VisibilityScoreInput, VisibilityScoreWeights } from "@auto/shared";

const W: VisibilityScoreWeights = {
  certifiedFieldWeight: 5,
  declaredFieldWeight: 2,
  photoWeight: 3,
  photoMax: 10,
  historyReportWeight: 10,
  descriptionBonusWeight: 5,
  descriptionMinLength: 100,
  ageThreshold: 15,
  ageNormalizationFactor: 0.8,
  labelThresholdLow: 34,
  labelThresholdHigh: 67,
};

// ─── 7.1 Progressive Fill E2E ──────────────────────────────────────────────

describe("7.1 Progressive fill → score increases at each step", () => {
  it("should increase score as fields are progressively filled", () => {
    const scores: number[] = [];

    // Step 0: empty listing
    const s0 = calculateVisibilityScore({ listing: {}, photoCount: 0, hasHistoryReport: false }, W);
    scores.push(s0.score);
    expect(s0.score).toBe(0);

    // Step 1: add make (certified, 5pts)
    const s1 = calculateVisibilityScore(
      { listing: { make: "Renault" }, photoCount: 0, hasHistoryReport: false },
      W,
    );
    scores.push(s1.score);
    expect(s1.score).toBeGreaterThan(s0.score);

    // Step 2: add model + price
    const s2 = calculateVisibilityScore(
      {
        listing: { make: "Renault", model: "Clio", price: 15000 },
        photoCount: 0,
        hasHistoryReport: false,
      },
      W,
    );
    scores.push(s2.score);
    expect(s2.score).toBeGreaterThan(s1.score);

    // Step 3: add 3 photos
    const s3 = calculateVisibilityScore(
      {
        listing: { make: "Renault", model: "Clio", price: 15000 },
        photoCount: 3,
        hasHistoryReport: false,
      },
      W,
    );
    scores.push(s3.score);
    expect(s3.score).toBeGreaterThan(s2.score);

    // Step 4: add history report
    const s4 = calculateVisibilityScore(
      {
        listing: { make: "Renault", model: "Clio", price: 15000 },
        photoCount: 3,
        hasHistoryReport: true,
      },
      W,
    );
    scores.push(s4.score);
    expect(s4.score).toBeGreaterThan(s3.score);

    // Step 5: fill all fields + max photos + description
    const s5 = calculateVisibilityScore(
      {
        listing: {
          make: "Renault",
          model: "Clio",
          year: 2022,
          fuelType: "essence",
          color: "Rouge",
          co2GKm: 128,
          price: 15000,
          mileage: 50000,
          description: "A".repeat(100),
        },
        photoCount: 10,
        hasHistoryReport: true,
      },
      W,
    );
    scores.push(s5.score);
    expect(s5.score).toBe(100);

    // Verify monotonic increase
    for (let i = 1; i < scores.length; i++) {
      expect(scores[i]).toBeGreaterThanOrEqual(scores[i - 1]);
    }
  });

  it("should complete score calculation in < 500ms", () => {
    const input: VisibilityScoreInput = {
      listing: {
        make: "Renault",
        model: "Clio",
        year: 2022,
        fuelType: "essence",
        color: "Rouge",
        co2GKm: 128,
        price: 15000,
        mileage: 50000,
      },
      photoCount: 5,
      hasHistoryReport: false,
    };

    const start = Date.now();
    for (let i = 0; i < 1000; i++) {
      calculateVisibilityScore(input, W);
    }
    const elapsed = Date.now() - start;

    // 1000 calculations in under 500ms → each one is < 0.5ms
    expect(elapsed).toBeLessThan(500);
  });
});

// ─── 7.2 Age Normalization ──────────────────────────────────────────────────

describe("7.2 Age normalization for older vehicles", () => {
  it("should show normalization message for vehicle older than threshold", () => {
    const currentYear = new Date().getFullYear();
    const oldYear = currentYear - 20; // 20 years old, threshold is 15

    const result = calculateVisibilityScore(
      {
        listing: { make: "Peugeot", model: "206", year: oldYear, price: 3000, mileage: 200000 },
        photoCount: 2,
        hasHistoryReport: false,
      },
      W,
    );

    expect(result.normalizedScore).toBeDefined();
    expect(result.normalizedScore).toBeGreaterThan(result.score);
    expect(result.normalizationMessage).toContain(`${oldYear}`);
    expect(result.normalizationMessage).toContain("Bon score");
  });

  it("should NOT normalize for vehicles within threshold", () => {
    const currentYear = new Date().getFullYear();
    const recentYear = currentYear - 5; // 5 years old, threshold is 15

    const result = calculateVisibilityScore(
      {
        listing: { make: "Renault", model: "Clio", year: recentYear, price: 12000 },
        photoCount: 3,
        hasHistoryReport: false,
      },
      W,
    );

    expect(result.normalizedScore).toBeUndefined();
    expect(result.normalizationMessage).toBeUndefined();
  });

  it("should cap normalized score at 100", () => {
    const currentYear = new Date().getFullYear();
    const oldYear = currentYear - 20;

    // Fill everything to maximize score, then normalization factor boosts it
    const result = calculateVisibilityScore(
      {
        listing: {
          make: "Peugeot",
          model: "206",
          year: oldYear,
          fuelType: "essence",
          color: "Bleu",
          co2GKm: 150,
          price: 3000,
          mileage: 200000,
          description: "A".repeat(100),
        },
        photoCount: 10,
        hasHistoryReport: true,
      },
      W,
    );

    expect(result.normalizedScore).toBeLessThanOrEqual(100);
  });

  it("should use normalized score for label determination", () => {
    const currentYear = new Date().getFullYear();
    const oldYear = currentYear - 20;

    // Give a medium base score that gets boosted by normalization
    const result = calculateVisibilityScore(
      {
        listing: {
          make: "Peugeot",
          model: "206",
          year: oldYear,
          fuelType: "essence",
          price: 3000,
          mileage: 200000,
        },
        photoCount: 5,
        hasHistoryReport: false,
      },
      W,
    );

    // The normalized score should be higher than base, potentially changing the label
    if (result.normalizedScore! >= W.labelThresholdHigh) {
      expect(result.label).toBe("Très documenté");
    } else if (result.normalizedScore! >= W.labelThresholdLow) {
      expect(result.label).toBe("Bien documenté");
    } else {
      expect(result.label).toBe("Partiellement documenté");
    }
  });
});

// ─── 7.3 Suggestion Accuracy ───────────────────────────────────────────────

describe("7.3 Suggestions match missing fields and disappear when filled", () => {
  it("should suggest all missing fields for empty listing", () => {
    const result = calculateVisibilityScore(
      { listing: {}, photoCount: 0, hasHistoryReport: false },
      W,
    );

    const fields = result.suggestions.map((s) => s.field);
    // Should suggest missing listing fields
    expect(fields).toContain("make");
    expect(fields).toContain("model");
    expect(fields).toContain("price");
    // Should suggest photos and history report
    expect(fields).toContain("photo");
    expect(fields).toContain("historyReport");
    expect(fields).toContain("descriptionBonus");
  });

  it("should remove suggestion for filled field", () => {
    const result = calculateVisibilityScore(
      { listing: { make: "Renault" }, photoCount: 0, hasHistoryReport: false },
      W,
    );

    const fields = result.suggestions.map((s) => s.field);
    expect(fields).not.toContain("make");
    // Other fields still suggested
    expect(fields).toContain("model");
    expect(fields).toContain("price");
  });

  it("should remove photo suggestion when max photos reached", () => {
    const result = calculateVisibilityScore(
      { listing: {}, photoCount: 10, hasHistoryReport: false },
      W,
    );

    const fields = result.suggestions.map((s) => s.field);
    expect(fields).not.toContain("photo");
  });

  it("should remove historyReport suggestion when present", () => {
    const result = calculateVisibilityScore(
      { listing: {}, photoCount: 0, hasHistoryReport: true },
      W,
    );

    const fields = result.suggestions.map((s) => s.field);
    expect(fields).not.toContain("historyReport");
  });

  it("should remove descriptionBonus when description is long enough", () => {
    const result = calculateVisibilityScore(
      { listing: { description: "A".repeat(100) }, photoCount: 0, hasHistoryReport: false },
      W,
    );

    const fields = result.suggestions.map((s) => s.field);
    expect(fields).not.toContain("descriptionBonus");
  });

  it("should return empty suggestions for fully-filled listing", () => {
    const result = calculateVisibilityScore(
      {
        listing: {
          make: "Renault",
          model: "Clio",
          year: 2022,
          fuelType: "essence",
          color: "Rouge",
          co2GKm: 128,
          price: 15000,
          mileage: 50000,
          description: "A".repeat(100),
        },
        photoCount: 10,
        hasHistoryReport: true,
      },
      W,
    );

    expect(result.suggestions).toHaveLength(0);
  });

  it("should sort suggestions by highest boost first", () => {
    const result = calculateVisibilityScore(
      { listing: {}, photoCount: 0, hasHistoryReport: false },
      W,
    );

    for (let i = 1; i < result.suggestions.length; i++) {
      expect(result.suggestions[i].boost).toBeLessThanOrEqual(result.suggestions[i - 1].boost);
    }
  });

  it("should have positive boost values for all suggestions", () => {
    const result = calculateVisibilityScore(
      { listing: {}, photoCount: 0, hasHistoryReport: false },
      W,
    );

    for (const s of result.suggestions) {
      expect(s.boost).toBeGreaterThan(0);
    }
  });
});

// ─── 7.4 SignalR Real-Time Push ─────────────────────────────────────────────

describe("7.4 SignalR score broadcast on recalculateScore", () => {
  let handleRecalculateScore: any;

  beforeAll(() => {
    const SellerServiceHandler = require("../../../srv/seller-service").default;
    const handler = new SellerServiceHandler();
    handler.on = (event: string, fn: any) => {
      if (event === "recalculateScore") handleRecalculateScore = fn;
    };
    handler.init();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockRun.mockReset();
    mockSignalRSendToUser.mockReset().mockResolvedValue(undefined);
  });

  it("should broadcast score via SignalR to the live-score hub", async () => {
    // listing lookup
    mockRun.mockResolvedValueOnce({ ID: "listing-1", sellerId: "user-1" });
    // photo SELECT
    mockRun.mockResolvedValueOnce([{ ID: "p1" }, { ID: "p2" }]);
    // UPDATE score
    mockRun.mockResolvedValueOnce(undefined);

    const req = {
      data: { listingId: "listing-1" },
      user: { id: "user-1" },
      error: jest.fn(),
    };

    const result = await handleRecalculateScore(req);

    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.label).toBeDefined();

    // SignalR should have been called with live-score hub and user-1
    expect(mockSignalRSendToUser).toHaveBeenCalledTimes(1);
    expect(mockSignalRSendToUser).toHaveBeenCalledWith(
      "live-score",
      "user-1",
      "scoreUpdate",
      expect.objectContaining({
        score: expect.any(Number),
        label: expect.any(String),
        suggestions: expect.any(Array),
      }),
    );
  });

  it("should still return result even if SignalR fails", async () => {
    mockRun.mockResolvedValueOnce({ ID: "listing-1", sellerId: "user-1" });
    mockRun.mockResolvedValueOnce([]);
    mockRun.mockResolvedValueOnce(undefined);
    mockSignalRSendToUser.mockRejectedValue(new Error("SignalR down"));

    const req = {
      data: { listingId: "listing-1" },
      user: { id: "user-1" },
      error: jest.fn(),
    };

    const result = await handleRecalculateScore(req);

    // Should still return a score even though SignalR failed
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.label).toBeDefined();
  });

  it("should include normalizedScore and normalizationMessage in broadcast", async () => {
    const currentYear = new Date().getFullYear();
    const oldYear = currentYear - 20;

    mockRun.mockResolvedValueOnce({
      ID: "listing-1",
      sellerId: "user-1",
      make: "Peugeot",
      model: "206",
      year: oldYear,
      price: 3000,
      mileage: 200000,
    });
    mockRun.mockResolvedValueOnce([{ ID: "p1" }]);
    mockRun.mockResolvedValueOnce(undefined);

    const req = {
      data: { listingId: "listing-1" },
      user: { id: "user-1" },
      error: jest.fn(),
    };

    const result = await handleRecalculateScore(req);

    // For an old vehicle, normalizedScore should be set
    expect(result.normalizedScore).not.toBeNull();
    expect(result.normalizationMessage).not.toBeNull();

    // SignalR broadcast should include normalization data
    expect(mockSignalRSendToUser).toHaveBeenCalledWith(
      "live-score",
      "user-1",
      "scoreUpdate",
      expect.objectContaining({
        normalizedScore: expect.any(Number),
        normalizationMessage: expect.any(String),
      }),
    );
  });
});
