/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-require-imports */

const mockRun = jest.fn();
const mockUuid = jest.fn(() => "test-uuid-123");

jest.mock("@sap/cds", () => {
  const mockLog = { warn: jest.fn(), info: jest.fn(), error: jest.fn() };
  return {
    __esModule: true,
    default: {
      entities: jest.fn(() => ({
        CertifiedField: "CertifiedField",
        CertifiedFieldHistory: "CertifiedFieldHistory",
      })),
      run: (...args: any[]) => mockRun(...args),
      log: jest.fn(() => mockLog),
      utils: { uuid: () => mockUuid() },
    },
  };
});

(global as any).SELECT = {
  one: {
    from: jest.fn().mockReturnValue({
      where: jest.fn().mockReturnValue("select-one-query"),
    }),
  },
  from: jest.fn().mockReturnValue({
    where: jest.fn().mockReturnValue("select-query"),
  }),
};

(global as any).INSERT = {
  into: jest.fn().mockReturnValue({
    entries: jest.fn().mockReturnValue("insert-query"),
  }),
};

(global as any).UPDATE = jest.fn().mockReturnValue({
  set: jest.fn().mockReturnValue({
    where: jest.fn().mockReturnValue("update-query"),
  }),
});

(global as any).DELETE = {
  from: jest.fn().mockReturnValue({
    where: jest.fn().mockReturnValue("delete-query"),
  }),
};

const {
  markFieldCertified,
  getCertifiedFields,
  isCertified,
  overrideCertifiedField,
} = require("../../../srv/lib/certification");

describe("certification", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRun.mockReset();
    mockUuid.mockReturnValue("test-uuid-123");
  });

  describe("markFieldCertified", () => {
    it("should create a new CertifiedField record when none exists", async () => {
      // First call: SELECT.one returns null (no existing record)
      mockRun.mockResolvedValueOnce(null);
      // Second call: INSERT succeeds
      mockRun.mockResolvedValueOnce(undefined);

      const result = await markFieldCertified("listing-1", "make", "Renault", "SIV");

      expect(result).toMatchObject({
        ID: "test-uuid-123",
        listingId: "listing-1",
        fieldName: "make",
        fieldValue: "Renault",
        source: "SIV",
        isCertified: true,
      });
      expect(result.sourceTimestamp).toBeDefined();
      // createdAt is managed by CDS `managed` aspect, not set manually
      expect(mockRun).toHaveBeenCalledTimes(2);
    });

    it("should update existing record when one exists for same listing+field", async () => {
      const existingRecord = {
        ID: "existing-id",
        listingId: "listing-1",
        fieldName: "make",
        fieldValue: "OldValue",
        source: "OldSource",
        createdAt: "2026-01-01T00:00:00.000Z",
      };

      // First call: SELECT.one returns existing
      mockRun.mockResolvedValueOnce(existingRecord);
      // Second call: UPDATE succeeds
      mockRun.mockResolvedValueOnce(undefined);

      const result = await markFieldCertified("listing-1", "make", "Renault", "SIV");

      expect(result).toMatchObject({
        ID: "existing-id",
        listingId: "listing-1",
        fieldName: "make",
        fieldValue: "Renault",
        source: "SIV",
        isCertified: true,
      });
      expect(mockRun).toHaveBeenCalledTimes(2);
    });

    it("should throw if CertifiedField entity is not found", async () => {
      const cds = require("@sap/cds").default;
      cds.entities.mockReturnValueOnce({});

      await expect(markFieldCertified("listing-1", "make", "Renault", "SIV")).rejects.toThrow(
        "CertifiedField entity not found",
      );
    });
  });

  describe("getCertifiedFields", () => {
    it("should return all certified fields for a listing", async () => {
      const mockFields = [
        {
          ID: "f1",
          listingId: "listing-1",
          fieldName: "make",
          fieldValue: "Renault",
          source: "SIV",
          sourceTimestamp: "2026-01-01T00:00:00.000Z",
          isCertified: true,
          createdAt: "2026-01-01T00:00:00.000Z",
        },
        {
          ID: "f2",
          listingId: "listing-1",
          fieldName: "model",
          fieldValue: "Clio",
          source: "SIV",
          sourceTimestamp: "2026-01-01T00:00:00.000Z",
          isCertified: true,
          createdAt: "2026-01-01T00:00:00.000Z",
        },
      ];

      mockRun.mockResolvedValueOnce(mockFields);

      const result = await getCertifiedFields("listing-1");

      expect(result).toHaveLength(2);
      expect(result[0].fieldName).toBe("make");
      expect(result[1].fieldName).toBe("model");
    });

    it("should return empty array when no certified fields exist", async () => {
      mockRun.mockResolvedValueOnce([]);
      const result = await getCertifiedFields("listing-none");
      expect(result).toEqual([]);
    });

    it("should return empty array when SELECT returns null", async () => {
      mockRun.mockResolvedValueOnce(null);
      const result = await getCertifiedFields("listing-none");
      expect(result).toEqual([]);
    });

    it("should throw if CertifiedField entity is not found", async () => {
      const cds = require("@sap/cds").default;
      cds.entities.mockReturnValueOnce({});

      await expect(getCertifiedFields("listing-1")).rejects.toThrow(
        "CertifiedField entity not found",
      );
    });
  });

  describe("isCertified", () => {
    it("should return true when certified field exists", async () => {
      mockRun.mockResolvedValueOnce({ ID: "f1", isCertified: true });
      const result = await isCertified("listing-1", "make");
      expect(result).toBe(true);
    });

    it("should return false when no certified field exists", async () => {
      mockRun.mockResolvedValueOnce(null);
      const result = await isCertified("listing-1", "unknown_field");
      expect(result).toBe(false);
    });

    it("should return false when field is undefined", async () => {
      mockRun.mockResolvedValueOnce(undefined);
      const result = await isCertified("listing-1", "unknown_field");
      expect(result).toBe(false);
    });

    it("should throw if CertifiedField entity is not found", async () => {
      const cds = require("@sap/cds").default;
      cds.entities.mockReturnValueOnce({});

      await expect(isCertified("listing-1", "make")).rejects.toThrow(
        "CertifiedField entity not found",
      );
    });
  });

  describe("overrideCertifiedField", () => {
    it("should override a certified field and create history record", async () => {
      const existingCertified = {
        ID: "cert-1",
        listingId: "listing-1",
        fieldName: "mileage",
        fieldValue: "50000",
        source: "SIV",
        isCertified: true,
      };

      // SELECT.one finds existing certified field
      mockRun.mockResolvedValueOnce(existingCertified);
      // UPDATE marks original as overridden
      mockRun.mockResolvedValueOnce(undefined);
      // DELETE previous non-certified records
      mockRun.mockResolvedValueOnce(undefined);
      // INSERT new seller_declared record
      mockRun.mockResolvedValueOnce(undefined);
      // INSERT history record
      mockRun.mockResolvedValueOnce(undefined);

      const result = await overrideCertifiedField("listing-1", "mileage", "55000", "seller-1");

      expect(result.previousValue).toBe("50000");
      expect(result.previousSource).toBe("SIV");
      expect(result.newRecord).toMatchObject({
        listingId: "listing-1",
        fieldName: "mileage",
        fieldValue: "55000",
        source: "seller_declared",
        isCertified: false,
        isOverridden: false,
      });
      // 5 DB calls: SELECT, UPDATE, DELETE, INSERT cert, INSERT history
      expect(mockRun).toHaveBeenCalledTimes(5);
    });

    it("should preserve the original certified value in history", async () => {
      const existingCertified = {
        ID: "cert-2",
        listingId: "listing-2",
        fieldName: "color",
        fieldValue: "rouge",
        source: "ADEME",
        isCertified: true,
      };

      mockRun.mockResolvedValueOnce(existingCertified); // SELECT
      mockRun.mockResolvedValueOnce(undefined); // UPDATE
      mockRun.mockResolvedValueOnce(undefined); // DELETE
      mockRun.mockResolvedValueOnce(undefined); // INSERT cert
      mockRun.mockResolvedValueOnce(undefined); // INSERT history

      const result = await overrideCertifiedField("listing-2", "color", "bleu", "seller-2");

      expect(result.previousValue).toBe("rouge");
      expect(result.previousSource).toBe("ADEME");
      expect(result.newRecord.fieldValue).toBe("bleu");
    });

    it("should throw when no certified field exists for override", async () => {
      mockRun.mockResolvedValueOnce(null);

      await expect(
        overrideCertifiedField("listing-x", "unknown", "val", "seller-1"),
      ).rejects.toThrow("No certified field found for unknown on listing listing-x");
    });

    it("should throw if CertifiedField entity is not found", async () => {
      const cds = require("@sap/cds").default;
      cds.entities.mockReturnValueOnce({});

      await expect(overrideCertifiedField("listing-1", "make", "val", "seller-1")).rejects.toThrow(
        "CertifiedField entity not found",
      );
    });

    it("should throw if CertifiedFieldHistory entity is not found", async () => {
      const cds = require("@sap/cds").default;
      cds.entities.mockReturnValueOnce({ CertifiedField: "CertifiedField" });

      await expect(overrideCertifiedField("listing-1", "make", "val", "seller-1")).rejects.toThrow(
        "CertifiedFieldHistory entity not found",
      );
    });

    it("should set source as seller_declared for overridden field", async () => {
      const existingCertified = {
        ID: "cert-3",
        listingId: "listing-3",
        fieldName: "fuelType",
        fieldValue: "diesel",
        source: "SIV",
        isCertified: true,
      };

      mockRun.mockResolvedValueOnce(existingCertified); // SELECT
      mockRun.mockResolvedValueOnce(undefined); // UPDATE
      mockRun.mockResolvedValueOnce(undefined); // DELETE
      mockRun.mockResolvedValueOnce(undefined); // INSERT cert
      mockRun.mockResolvedValueOnce(undefined); // INSERT history

      const result = await overrideCertifiedField("listing-3", "fuelType", "essence", "seller-3");

      expect(result.newRecord.source).toBe("seller_declared");
      expect(result.newRecord.isCertified).toBe(false);
    });

    it("should remove previous non-certified record on double override", async () => {
      const existingCertified = {
        ID: "cert-4",
        listingId: "listing-4",
        fieldName: "color",
        fieldValue: "rouge",
        source: "SIV",
        isCertified: true,
      };

      // First override
      mockRun.mockResolvedValueOnce(existingCertified); // SELECT
      mockRun.mockResolvedValueOnce(undefined); // UPDATE
      mockRun.mockResolvedValueOnce(undefined); // DELETE previous non-certified
      mockRun.mockResolvedValueOnce(undefined); // INSERT new non-certified
      mockRun.mockResolvedValueOnce(undefined); // INSERT history

      await overrideCertifiedField("listing-4", "color", "bleu", "seller-1");

      // Second override - should find the first override's certified record
      mockRun.mockResolvedValueOnce(existingCertified); // SELECT (still finds original certified)
      mockRun.mockResolvedValueOnce(undefined); // UPDATE
      mockRun.mockResolvedValueOnce(undefined); // DELETE previous non-certified
      mockRun.mockResolvedValueOnce(undefined); // INSERT new non-certified
      mockRun.mockResolvedValueOnce(undefined); // INSERT history

      const result = await overrideCertifiedField("listing-4", "color", "vert", "seller-1");

      expect(result.previousValue).toBe("rouge");
      expect(result.newRecord.fieldValue).toBe("vert");
      // 10 DB calls total (5 per override)
      expect(mockRun).toHaveBeenCalledTimes(10);
    });
  });
});
