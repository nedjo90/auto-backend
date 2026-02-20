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

const {
  markFieldCertified,
  getCertifiedFields,
  isCertified,
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
      expect(result.createdAt).toBeDefined();
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
        createdAt: "2026-01-01T00:00:00.000Z",
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
});
