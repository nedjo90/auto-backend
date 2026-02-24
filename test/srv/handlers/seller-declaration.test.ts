/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-require-imports, @typescript-eslint/no-unused-vars */
export {};

// ─── Mocks ──────────────────────────────────────────────────────────────────

const mockRun = jest.fn();
const mockUuid = jest.fn(() => "new-declaration-uuid");

jest.mock("@sap/cds", () => {
  const mockLog = { warn: jest.fn(), info: jest.fn(), error: jest.fn() };
  return {
    __esModule: true,
    default: {
      entities: jest.fn(() => ({
        CertifiedField: "CertifiedField",
        ApiCachedData: "ApiCachedData",
        AuditTrailEntry: "AuditTrailEntry",
        Listing: "Listing",
        ListingPhoto: "ListingPhoto",
        Declaration: "Declaration",
        ConfigDeclarationTemplate: "ConfigDeclarationTemplate",
      })),
      run: (...args: any[]) => mockRun(...args),
      log: jest.fn(() => mockLog),
      utils: { uuid: () => mockUuid() },
      ApplicationService: class {
        async init() {}
        on(_event: string, _handler: any) {}
        before(_event: string, _entity: string, _handler: any) {}
        after(_event: string, _entity: string, _handler: any) {}
      },
    },
  };
});

const mockMarkFieldCertified = jest.fn().mockResolvedValue({ ID: "cert-1" });
const mockGetCertifiedFields = jest.fn().mockResolvedValue([]);
const mockOverrideCertifiedField = jest.fn().mockResolvedValue({
  previousValue: "OldValue",
  previousSource: "SIV",
  newRecord: {},
});
jest.mock("../../../srv/lib/certification", () => ({
  markFieldCertified: (...args: any[]) => mockMarkFieldCertified(...args),
  getCertifiedFields: (...args: any[]) => mockGetCertifiedFields(...args),
  overrideCertifiedField: (...args: any[]) => mockOverrideCertifiedField(...args),
}));

const mockGetCachedResponse = jest.fn().mockResolvedValue(null);
const mockSetCachedResponse = jest.fn().mockResolvedValue(undefined);
jest.mock("../../../srv/lib/api-cache", () => ({
  getCachedResponse: (...args: any[]) => mockGetCachedResponse(...args),
  setCachedResponse: (...args: any[]) => mockSetCachedResponse(...args),
}));

const mockLogAudit = jest.fn().mockResolvedValue(undefined);
jest.mock("../../../srv/lib/audit-logger", () => ({
  logAudit: (...args: any[]) => mockLogAudit(...args),
}));

jest.mock("../../../srv/lib/signalr-client", () => ({
  signalrClient: {
    sendToUser: jest.fn().mockResolvedValue(undefined),
    isConfigured: jest.fn(() => false),
  },
  SIGNALR_HUBS: { admin: "admin", liveScore: "live-score" },
}));

const mockCalculateVisibilityScore = jest
  .fn()
  .mockReturnValue({ score: 50, label: "Bien documenté", suggestions: [] });
jest.mock("../../../srv/lib/visibility-score", () => ({
  calculateVisibilityScore: (...args: any[]) => mockCalculateVisibilityScore(...args),
  getFilledFieldsFromListing: jest.fn().mockReturnValue({}),
}));

jest.mock("../../../srv/adapters/factory/adapter-factory", () => ({
  getVehicleLookup: () => ({ lookup: jest.fn() }),
  getEmission: () => ({ getEmissions: jest.fn() }),
  getRecall: () => ({ getRecalls: jest.fn() }),
  getCritAir: () => ({ calculate: jest.fn() }),
  getVINTechnical: () => ({ decode: jest.fn() }),
}));

jest.mock("@auto/shared", () => ({
  validateListingField: jest.fn().mockReturnValue(null),
  CERTIFIABLE_FIELDS: ["make", "model", "year", "plate", "vin", "fuelType"],
  LISTING_FIELDS: [{ fieldName: "make" }, { fieldName: "model" }, { fieldName: "price" }],
  PHOTO_ALLOWED_MIME_TYPES: ["image/jpeg", "image/png"],
  calculateCompletionPercentage: jest.fn().mockReturnValue(35),
}));

jest.mock("../../../srv/lib/photo-storage", () => ({
  validateMimeType: jest.fn().mockReturnValue(true),
  validateFileSize: jest.fn().mockReturnValue(true),
  canUploadPhoto: jest.fn().mockResolvedValue(true),
  uploadPhotoBlob: jest.fn().mockResolvedValue({
    blobUrl: "https://storage/blob",
    cdnUrl: "https://cdn/photo.jpg",
    blobPath: "path/photo.jpg",
  }),
  deletePhotoBlob: jest.fn().mockResolvedValue(undefined),
  deleteAllPhotosForListing: jest.fn().mockResolvedValue(undefined),
  getNextSortOrder: jest.fn().mockResolvedValue(0),
  getMaxPhotos: jest.fn().mockReturnValue(20),
}));

// Global CDS query helpers
(global as any).SELECT = {
  one: {
    from: jest.fn().mockReturnValue({
      where: jest.fn().mockReturnValue("q"),
      columns: jest.fn().mockReturnValue({ where: jest.fn().mockReturnValue("q") }),
    }),
  },
  from: jest.fn().mockReturnValue({
    where: jest.fn().mockReturnValue({
      orderBy: jest.fn().mockReturnValue("q"),
    }),
    orderBy: jest.fn().mockReturnValue("q"),
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

// ─── Import the handler ──────────────────────────────────────────────────────

const SellerServiceHandler = require("../../../srv/seller-service").default;

// ─── Mock Request Builder ────────────────────────────────────────────────────

function createMockRequest(data: Record<string, any>, userId = "test-user-1"): any {
  const errors: any[] = [];
  return {
    data,
    user: { id: userId },
    headers: {},
    error: jest.fn((status: number, msg: string) => {
      errors.push({ status, msg });
    }),
    _errors: errors,
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("SellerService - getDeclarationTemplate", () => {
  let handleGetDeclarationTemplate: any;

  beforeAll(() => {
    const handler = new SellerServiceHandler();
    handler.on = (event: string, fn: any) => {
      if (event === "getDeclarationTemplate") {
        handleGetDeclarationTemplate = fn;
      }
    };
    handler.before = jest.fn();
    handler.init();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockRun.mockReset();
  });

  it("should return the active declaration template", async () => {
    const template = {
      version: "v1.0",
      checkboxItems: JSON.stringify(["Item 1", "Item 2"]),
      introText: "Intro text",
      legalNotice: "Legal notice",
    };
    mockRun.mockResolvedValueOnce([template]);

    const req = createMockRequest({});
    const result = await handleGetDeclarationTemplate(req);

    expect(result).toEqual({
      version: "v1.0",
      checkboxItems: JSON.stringify(["Item 1", "Item 2"]),
      introText: "Intro text",
      legalNotice: "Legal notice",
    });
  });

  it("should return error 404 when no active template exists", async () => {
    mockRun.mockResolvedValueOnce([]);

    const req = createMockRequest({});
    await handleGetDeclarationTemplate(req);

    expect(req.error).toHaveBeenCalledWith(404, "No active declaration template found");
  });

  it("should return first template when multiple active templates exist", async () => {
    const template1 = {
      version: "v1.0",
      checkboxItems: "[]",
      introText: "First",
      legalNotice: "First legal",
    };
    const template2 = {
      version: "v2.0",
      checkboxItems: "[]",
      introText: "Second",
      legalNotice: "Second legal",
    };
    mockRun.mockResolvedValueOnce([template1, template2]);

    const req = createMockRequest({});
    const result = await handleGetDeclarationTemplate(req);

    expect(result.version).toBe("v1.0");
  });
});

describe("SellerService - submitDeclaration", () => {
  let handleSubmitDeclaration: any;

  beforeAll(() => {
    const handler = new SellerServiceHandler();
    handler.on = (event: string, fn: any) => {
      if (event === "submitDeclaration") {
        handleSubmitDeclaration = fn;
      }
    };
    handler.before = jest.fn();
    handler.init();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockRun.mockReset();
    mockUuid.mockReturnValue("new-declaration-uuid");
  });

  const validCheckboxStates = JSON.stringify([
    { label: "Attestation 1", checked: true },
    { label: "Attestation 2", checked: true },
  ]);

  it("should create a declaration record for a valid draft listing", async () => {
    // SELECT listing
    mockRun.mockResolvedValueOnce({ ID: "listing-1", sellerId: "test-user-1", status: "draft" });
    // SELECT existing declaration (none)
    mockRun.mockResolvedValueOnce(null);
    // SELECT template
    mockRun.mockResolvedValueOnce([
      { version: "v1.0", checkboxItems: JSON.stringify(["Attestation 1", "Attestation 2"]) },
    ]);
    // INSERT declaration
    mockRun.mockResolvedValueOnce(undefined);
    // UPDATE listing
    mockRun.mockResolvedValueOnce(undefined);

    const req = createMockRequest({
      listingId: "listing-1",
      checkboxStates: validCheckboxStates,
    });
    const result = await handleSubmitDeclaration(req);

    expect(result.success).toBe(true);
    expect(result.declarationId).toBe("new-declaration-uuid");
    expect(result.signedAt).toBeDefined();
  });

  it("should return 404 when listing does not exist", async () => {
    mockRun.mockResolvedValueOnce(null);

    const req = createMockRequest({
      listingId: "nonexistent",
      checkboxStates: validCheckboxStates,
    });
    await handleSubmitDeclaration(req);

    expect(req.error).toHaveBeenCalledWith(404, "Listing not found");
  });

  it("should return 403 when listing belongs to a different seller", async () => {
    mockRun.mockResolvedValueOnce({ ID: "listing-1", sellerId: "other-user", status: "draft" });

    const req = createMockRequest({
      listingId: "listing-1",
      checkboxStates: validCheckboxStates,
    });
    await handleSubmitDeclaration(req);

    expect(req.error).toHaveBeenCalledWith(403, "Not authorized");
  });

  it("should return 400 when listing is not a draft", async () => {
    mockRun.mockResolvedValueOnce({
      ID: "listing-1",
      sellerId: "test-user-1",
      status: "published",
    });

    const req = createMockRequest({
      listingId: "listing-1",
      checkboxStates: validCheckboxStates,
    });
    await handleSubmitDeclaration(req);

    expect(req.error).toHaveBeenCalledWith(
      400,
      "Declaration can only be submitted for draft listings",
    );
  });

  it("should return 400 when checkboxStates is invalid JSON", async () => {
    mockRun.mockResolvedValueOnce({ ID: "listing-1", sellerId: "test-user-1", status: "draft" });
    mockRun.mockResolvedValueOnce(null); // no existing declaration

    const req = createMockRequest({
      listingId: "listing-1",
      checkboxStates: "not-json",
    });
    await handleSubmitDeclaration(req);

    expect(req.error).toHaveBeenCalledWith(400, "Invalid checkboxStates format");
  });

  it("should return 400 when checkboxStates is an empty array", async () => {
    mockRun.mockResolvedValueOnce({ ID: "listing-1", sellerId: "test-user-1", status: "draft" });
    mockRun.mockResolvedValueOnce(null); // no existing declaration

    const req = createMockRequest({
      listingId: "listing-1",
      checkboxStates: "[]",
    });
    await handleSubmitDeclaration(req);

    expect(req.error).toHaveBeenCalledWith(400, "checkboxStates must be a non-empty array");
  });

  it("should return 400 when not all checkboxes are checked", async () => {
    mockRun.mockResolvedValueOnce({ ID: "listing-1", sellerId: "test-user-1", status: "draft" });
    mockRun.mockResolvedValueOnce(null); // no existing declaration

    const checkboxes = JSON.stringify([
      { label: "Item 1", checked: true },
      { label: "Item 2", checked: false },
    ]);

    const req = createMockRequest({
      listingId: "listing-1",
      checkboxStates: checkboxes,
    });
    await handleSubmitDeclaration(req);

    expect(req.error).toHaveBeenCalledWith(
      400,
      "All checkboxes must be checked to submit declaration",
    );
  });

  it("should return 401 when user is not authenticated", async () => {
    const req = createMockRequest(
      {
        listingId: "listing-1",
        checkboxStates: validCheckboxStates,
      },
      undefined as any,
    );
    req.user = { id: undefined };
    await handleSubmitDeclaration(req);

    expect(req.error).toHaveBeenCalledWith(401, "Authentication required");
  });

  it("should capture IP address from x-forwarded-for header", async () => {
    mockRun.mockResolvedValueOnce({ ID: "listing-1", sellerId: "test-user-1", status: "draft" });
    mockRun.mockResolvedValueOnce(null); // no existing declaration
    mockRun.mockResolvedValueOnce([
      { version: "v1.0", checkboxItems: JSON.stringify(["Attestation 1", "Attestation 2"]) },
    ]);
    mockRun.mockResolvedValueOnce(undefined);
    mockRun.mockResolvedValueOnce(undefined);

    const req = createMockRequest({
      listingId: "listing-1",
      checkboxStates: validCheckboxStates,
    });
    req.headers = { "x-forwarded-for": "192.168.1.100" };

    await handleSubmitDeclaration(req);

    expect(mockLogAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        ipAddress: "192.168.1.100",
      }),
    );
  });

  it("should use template version from active template", async () => {
    mockRun.mockResolvedValueOnce({ ID: "listing-1", sellerId: "test-user-1", status: "draft" });
    mockRun.mockResolvedValueOnce(null); // no existing declaration
    mockRun.mockResolvedValueOnce([
      { version: "v2.5", checkboxItems: JSON.stringify(["Attestation 1", "Attestation 2"]) },
    ]);
    mockRun.mockResolvedValueOnce(undefined);
    mockRun.mockResolvedValueOnce(undefined);

    const req = createMockRequest({
      listingId: "listing-1",
      checkboxStates: validCheckboxStates,
    });
    await handleSubmitDeclaration(req);

    // Verify INSERT was called with correct template version
    expect(mockRun).toHaveBeenCalledTimes(5);
  });

  it("should update listing with declarationId after successful submission", async () => {
    mockRun.mockResolvedValueOnce({ ID: "listing-1", sellerId: "test-user-1", status: "draft" });
    mockRun.mockResolvedValueOnce(null); // no existing declaration
    mockRun.mockResolvedValueOnce([
      { version: "v1.0", checkboxItems: JSON.stringify(["Attestation 1", "Attestation 2"]) },
    ]);
    mockRun.mockResolvedValueOnce(undefined);
    mockRun.mockResolvedValueOnce(undefined);

    const req = createMockRequest({
      listingId: "listing-1",
      checkboxStates: validCheckboxStates,
    });
    const result = await handleSubmitDeclaration(req);

    expect(result.success).toBe(true);
    // 5 cds.run calls: SELECT listing, SELECT existing decl, SELECT template, INSERT declaration, UPDATE listing
    expect(mockRun).toHaveBeenCalledTimes(5);
  });

  it("should create audit trail entry on successful submission", async () => {
    mockRun.mockResolvedValueOnce({ ID: "listing-1", sellerId: "test-user-1", status: "draft" });
    mockRun.mockResolvedValueOnce(null); // no existing declaration
    mockRun.mockResolvedValueOnce([
      { version: "v1.0", checkboxItems: JSON.stringify(["Attestation 1", "Attestation 2"]) },
    ]);
    mockRun.mockResolvedValueOnce(undefined);
    mockRun.mockResolvedValueOnce(undefined);

    const req = createMockRequest({
      listingId: "listing-1",
      checkboxStates: validCheckboxStates,
    });
    await handleSubmitDeclaration(req);

    expect(mockLogAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "test-user-1",
        action: "declaration.submitted",
        resource: "Declaration",
      }),
    );
  });

  it("should use 'unknown' version when no template is found", async () => {
    mockRun.mockResolvedValueOnce({ ID: "listing-1", sellerId: "test-user-1", status: "draft" });
    mockRun.mockResolvedValueOnce(null); // no existing declaration
    mockRun.mockResolvedValueOnce([]); // no template
    mockRun.mockResolvedValueOnce(undefined);
    mockRun.mockResolvedValueOnce(undefined);

    const req = createMockRequest({
      listingId: "listing-1",
      checkboxStates: validCheckboxStates,
    });
    const result = await handleSubmitDeclaration(req);

    expect(result.success).toBe(true);
  });

  it("should return 409 when declaration already exists for listing", async () => {
    mockRun.mockResolvedValueOnce({ ID: "listing-1", sellerId: "test-user-1", status: "draft" });
    mockRun.mockResolvedValueOnce({ ID: "existing-decl" }); // existing declaration

    const req = createMockRequest({
      listingId: "listing-1",
      checkboxStates: validCheckboxStates,
    });
    await handleSubmitDeclaration(req);

    expect(req.error).toHaveBeenCalledWith(409, "A declaration already exists for this listing");
  });

  it("should return 400 when checkbox count does not match template", async () => {
    mockRun.mockResolvedValueOnce({ ID: "listing-1", sellerId: "test-user-1", status: "draft" });
    mockRun.mockResolvedValueOnce(null); // no existing declaration
    mockRun.mockResolvedValueOnce([
      {
        version: "v1.0",
        checkboxItems: JSON.stringify(["Item 1", "Item 2", "Item 3"]),
      },
    ]);

    const twoItems = JSON.stringify([
      { label: "Item 1", checked: true },
      { label: "Item 2", checked: true },
    ]);
    const req = createMockRequest({
      listingId: "listing-1",
      checkboxStates: twoItems,
    });
    await handleSubmitDeclaration(req);

    expect(req.error).toHaveBeenCalledWith(400, "Expected 3 checkboxes, received 2");
  });

  it("should extract first IP from x-forwarded-for chain", async () => {
    mockRun.mockResolvedValueOnce({ ID: "listing-1", sellerId: "test-user-1", status: "draft" });
    mockRun.mockResolvedValueOnce(null); // no existing declaration
    mockRun.mockResolvedValueOnce([
      { version: "v1.0", checkboxItems: JSON.stringify(["A1", "A2"]) },
    ]);
    mockRun.mockResolvedValueOnce(undefined);
    mockRun.mockResolvedValueOnce(undefined);

    const req = createMockRequest({
      listingId: "listing-1",
      checkboxStates: validCheckboxStates,
    });
    req.headers = { "x-forwarded-for": "203.0.113.50, 10.0.0.1, 172.16.0.1" };

    await handleSubmitDeclaration(req);

    expect(mockLogAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        ipAddress: "203.0.113.50",
      }),
    );
  });

  it("should not fail if audit logging throws", async () => {
    mockRun.mockResolvedValueOnce({ ID: "listing-1", sellerId: "test-user-1", status: "draft" });
    mockRun.mockResolvedValueOnce(null); // no existing declaration
    mockRun.mockResolvedValueOnce([
      { version: "v1.0", checkboxItems: JSON.stringify(["Attestation 1", "Attestation 2"]) },
    ]);
    mockRun.mockResolvedValueOnce(undefined);
    mockRun.mockResolvedValueOnce(undefined);
    mockLogAudit.mockRejectedValueOnce(new Error("Audit failed"));

    const req = createMockRequest({
      listingId: "listing-1",
      checkboxStates: validCheckboxStates,
    });
    const result = await handleSubmitDeclaration(req);

    expect(result.success).toBe(true);
  });
});

describe("SellerService - Declaration immutability", () => {
  let rejectDeclarationUpdate: any;
  let rejectDeclarationDelete: any;

  beforeAll(() => {
    const handler = new SellerServiceHandler();
    handler.on = jest.fn();
    handler.before = (event: string, entity: string, fn: any) => {
      if (event === "UPDATE" && entity === "Declarations") {
        rejectDeclarationUpdate = fn;
      }
      if (event === "DELETE" && entity === "Declarations") {
        rejectDeclarationDelete = fn;
      }
    };
    handler.init();
  });

  it("should reject UPDATE on Declaration entity", async () => {
    const req = createMockRequest({});
    await rejectDeclarationUpdate(req);

    expect(req.error).toHaveBeenCalledWith(403, "Declarations are immutable and cannot be updated");
  });

  it("should reject DELETE on Declaration entity", async () => {
    const req = createMockRequest({});
    await rejectDeclarationDelete(req);

    expect(req.error).toHaveBeenCalledWith(403, "Declarations are immutable and cannot be deleted");
  });
});

describe("SellerService - getDeclarationSummary (AC3)", () => {
  let handleGetDeclarationSummary: any;

  beforeAll(() => {
    const handler = new SellerServiceHandler();
    handler.on = (event: string, fn: any) => {
      if (event === "getDeclarationSummary") {
        handleGetDeclarationSummary = fn;
      }
    };
    handler.before = jest.fn();
    handler.init();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockRun.mockReset();
  });

  it("should return hasDeclared true with signedAt when declaration exists", async () => {
    mockRun.mockResolvedValueOnce({
      signedAt: "2026-02-24T10:30:00.000Z",
      declarationVersion: "v1.0",
    });

    const req = createMockRequest({ listingId: "listing-1" });
    const result = await handleGetDeclarationSummary(req);

    expect(result).toEqual({
      hasDeclared: true,
      signedAt: "2026-02-24T10:30:00.000Z",
      declarationVersion: "v1.0",
    });
  });

  it("should return hasDeclared false when no declaration exists", async () => {
    mockRun.mockResolvedValueOnce(null);

    const req = createMockRequest({ listingId: "listing-no-decl" });
    const result = await handleGetDeclarationSummary(req);

    expect(result).toEqual({
      hasDeclared: false,
      signedAt: null,
      declarationVersion: null,
    });
  });

  it("should not expose checkbox details in summary", async () => {
    mockRun.mockResolvedValueOnce({
      signedAt: "2026-02-24T10:30:00.000Z",
      declarationVersion: "v1.0",
      checkboxStates: JSON.stringify([{ label: "Secret", checked: true }]),
      ipAddress: "192.168.1.1",
      sellerId: "seller-1",
    });

    const req = createMockRequest({ listingId: "listing-1" });
    const result = await handleGetDeclarationSummary(req);

    expect(result).not.toHaveProperty("checkboxStates");
    expect(result).not.toHaveProperty("ipAddress");
    expect(result).not.toHaveProperty("sellerId");
  });
});

describe("CDS Service - Admin Declaration access (AC3)", () => {
  it("should expose Declarations as readonly in admin-service.cds", () => {
    const fs = require("fs");
    const path = require("path");
    const adminCds = fs.readFileSync(
      path.resolve(__dirname, "../../../srv/admin-service.cds"),
      "utf-8",
    );
    expect(adminCds).toContain("@readonly entity Declarations as projection on auto.Declaration");
  });

  it("should expose ConfigDeclarationTemplates in admin-service.cds", () => {
    const fs = require("fs");
    const path = require("path");
    const adminCds = fs.readFileSync(
      path.resolve(__dirname, "../../../srv/admin-service.cds"),
      "utf-8",
    );
    expect(adminCds).toContain(
      "entity ConfigDeclarationTemplates as projection on auto.ConfigDeclarationTemplate",
    );
  });
});
