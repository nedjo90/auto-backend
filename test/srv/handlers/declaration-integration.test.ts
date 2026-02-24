/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-require-imports, @typescript-eslint/no-unused-vars */
export {};

// ─── Mocks ──────────────────────────────────────────────────────────────────

const mockRun = jest.fn();
const mockUuid = jest.fn(() => "integration-uuid");

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

const mockLogAudit = jest.fn().mockResolvedValue(undefined);
jest.mock("../../../srv/lib/audit-logger", () => ({
  logAudit: (...args: any[]) => mockLogAudit(...args),
}));

jest.mock("../../../srv/lib/certification", () => ({
  markFieldCertified: jest.fn().mockResolvedValue({ ID: "cert-1" }),
  getCertifiedFields: jest.fn().mockResolvedValue([]),
  overrideCertifiedField: jest.fn(),
}));

jest.mock("../../../srv/lib/api-cache", () => ({
  getCachedResponse: jest.fn().mockResolvedValue(null),
  setCachedResponse: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("../../../srv/lib/signalr-client", () => ({
  signalrClient: {
    sendToUser: jest.fn().mockResolvedValue(undefined),
    isConfigured: jest.fn(() => false),
  },
  SIGNALR_HUBS: { admin: "admin", liveScore: "live-score" },
}));

jest.mock("../../../srv/lib/visibility-score", () => ({
  calculateVisibilityScore: jest
    .fn()
    .mockReturnValue({ score: 50, label: "Bien documenté", suggestions: [] }),
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
  CERTIFIABLE_FIELDS: ["make", "model"],
  LISTING_FIELDS: [{ fieldName: "make" }, { fieldName: "model" }, { fieldName: "price" }],
  PHOTO_ALLOWED_MIME_TYPES: ["image/jpeg"],
  calculateCompletionPercentage: jest.fn().mockReturnValue(35),
}));

jest.mock("../../../srv/lib/photo-storage", () => ({
  validateMimeType: jest.fn(),
  validateFileSize: jest.fn(),
  canUploadPhoto: jest.fn(),
  uploadPhotoBlob: jest.fn(),
  deletePhotoBlob: jest.fn(),
  deleteAllPhotosForListing: jest.fn(),
  getNextSortOrder: jest.fn(),
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

// ─── Import ─────────────────────────────────────────────────────────────────

const SellerServiceHandler = require("../../../srv/seller-service").default;

// ─── Helpers ────────────────────────────────────────────────────────────────

function createMockRequest(data: Record<string, any>, userId = "seller-1"): any {
  const errors: any[] = [];
  return {
    data,
    user: { id: userId },
    headers: { "x-forwarded-for": "10.0.0.1" },
    error: jest.fn((status: number, msg: string) => {
      errors.push({ status, msg });
    }),
    _errors: errors,
  };
}

// ─── Integration Tests ──────────────────────────────────────────────────────

describe("Declaration Integration - Full Flow", () => {
  let handleGetTemplate: any;
  let handleSubmitDeclaration: any;
  let handleGetSummary: any;
  let rejectUpdate: any;
  let rejectDelete: any;

  beforeAll(() => {
    const handler = new SellerServiceHandler();
    handler.on = (event: string, fn: any) => {
      if (event === "getDeclarationTemplate") handleGetTemplate = fn;
      if (event === "submitDeclaration") handleSubmitDeclaration = fn;
      if (event === "getDeclarationSummary") handleGetSummary = fn;
    };
    handler.before = (event: string, entity: string, fn: any) => {
      if (event === "UPDATE" && entity === "Declarations") rejectUpdate = fn;
      if (event === "DELETE" && entity === "Declarations") rejectDelete = fn;
    };
    handler.init();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockRun.mockReset();
  });

  it("7.1 Full flow: load template -> submit declaration -> verify record creation", async () => {
    // Step 1: Get template
    mockRun.mockResolvedValueOnce([
      {
        version: "v1.0",
        checkboxItems: JSON.stringify(["Item 1", "Item 2"]),
        introText: "Intro",
        legalNotice: "Legal",
      },
    ]);

    const templateReq = createMockRequest({});
    const template = await handleGetTemplate(templateReq);
    expect(template.version).toBe("v1.0");

    // Step 2: Submit declaration
    const allChecked = JSON.stringify([
      { label: "Item 1", checked: true },
      { label: "Item 2", checked: true },
    ]);

    mockRun.mockResolvedValueOnce({ ID: "listing-1", sellerId: "seller-1", status: "draft" }); // SELECT listing
    mockRun.mockResolvedValueOnce(null); // SELECT existing declaration (none)
    mockRun.mockResolvedValueOnce([
      { version: "v1.0", checkboxItems: JSON.stringify(["Item 1", "Item 2"]) },
    ]); // SELECT template
    mockRun.mockResolvedValueOnce(undefined); // INSERT declaration
    mockRun.mockResolvedValueOnce(undefined); // UPDATE listing

    const submitReq = createMockRequest({
      listingId: "listing-1",
      checkboxStates: allChecked,
    });
    const result = await handleSubmitDeclaration(submitReq);

    expect(result.success).toBe(true);
    expect(result.declarationId).toBeDefined();
    expect(result.signedAt).toBeDefined();

    // Step 3: Verify audit was logged
    expect(mockLogAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "declaration.submitted",
        resource: "Declaration",
      }),
    );
  });

  it("7.2 Immutability: reject UPDATE on Declaration", async () => {
    const req = createMockRequest({});
    await rejectUpdate(req);
    expect(req.error).toHaveBeenCalledWith(403, "Declarations are immutable and cannot be updated");
  });

  it("7.2 Immutability: reject DELETE on Declaration", async () => {
    const req = createMockRequest({});
    await rejectDelete(req);
    expect(req.error).toHaveBeenCalledWith(403, "Declarations are immutable and cannot be deleted");
  });

  it("7.3 Incomplete declaration: reject when checkbox unchecked", async () => {
    mockRun.mockResolvedValueOnce({ ID: "listing-1", sellerId: "seller-1", status: "draft" });
    mockRun.mockResolvedValueOnce(null); // no existing declaration

    const partialChecked = JSON.stringify([
      { label: "Item 1", checked: true },
      { label: "Item 2", checked: false },
    ]);

    const req = createMockRequest({
      listingId: "listing-1",
      checkboxStates: partialChecked,
    });
    await handleSubmitDeclaration(req);

    expect(req.error).toHaveBeenCalledWith(
      400,
      "All checkboxes must be checked to submit declaration",
    );
  });

  it("7.4 Summary returns only public fields (no checkbox details)", async () => {
    mockRun.mockResolvedValueOnce({
      signedAt: "2026-02-24T10:00:00Z",
      declarationVersion: "v1.0",
      checkboxStates: JSON.stringify([{ label: "Secret", checked: true }]),
      ipAddress: "10.0.0.1",
    });

    const req = createMockRequest({ listingId: "listing-1" });
    const summary = await handleGetSummary(req);

    expect(summary.hasDeclared).toBe(true);
    expect(summary.signedAt).toBe("2026-02-24T10:00:00Z");
    expect(summary).not.toHaveProperty("checkboxStates");
    expect(summary).not.toHaveProperty("ipAddress");
  });

  it("7.5 Cross-seller prevention: reject declaration for other seller's listing", async () => {
    mockRun.mockResolvedValueOnce({ ID: "listing-1", sellerId: "other-seller", status: "draft" });

    const allChecked = JSON.stringify([{ label: "Item 1", checked: true }]);
    const req = createMockRequest({
      listingId: "listing-1",
      checkboxStates: allChecked,
    });
    await handleSubmitDeclaration(req);

    expect(req.error).toHaveBeenCalledWith(403, "Not authorized");
  });

  it("7.6 Non-draft listing: reject declaration for published listing", async () => {
    mockRun.mockResolvedValueOnce({ ID: "listing-1", sellerId: "seller-1", status: "published" });

    const allChecked = JSON.stringify([{ label: "Item 1", checked: true }]);
    const req = createMockRequest({
      listingId: "listing-1",
      checkboxStates: allChecked,
    });
    await handleSubmitDeclaration(req);

    expect(req.error).toHaveBeenCalledWith(
      400,
      "Declaration can only be submitted for draft listings",
    );
  });

  it("7.6 Template configurability: load v1 template, then submit with v2 template", async () => {
    // Step 1: Load v1 template
    mockRun.mockResolvedValueOnce([
      {
        version: "v1.0",
        checkboxItems: JSON.stringify(["Old item 1", "Old item 2"]),
        introText: "Old intro",
        legalNotice: "Old legal",
      },
    ]);

    const templateReq1 = createMockRequest({});
    const template1 = await handleGetTemplate(templateReq1);
    expect(template1.version).toBe("v1.0");

    // Step 2: Template changes to v2 with 3 items
    mockRun.mockResolvedValueOnce([
      {
        version: "v2.0",
        checkboxItems: JSON.stringify(["New item A", "New item B", "New item C"]),
        introText: "New intro",
        legalNotice: "New legal",
      },
    ]);

    const templateReq2 = createMockRequest({});
    const template2 = await handleGetTemplate(templateReq2);
    expect(template2.version).toBe("v2.0");

    // Step 3: Submit with v2 template (3 items)
    mockRun.mockResolvedValueOnce({ ID: "listing-1", sellerId: "seller-1", status: "draft" });
    mockRun.mockResolvedValueOnce(null); // no existing declaration
    mockRun.mockResolvedValueOnce([
      {
        version: "v2.0",
        checkboxItems: JSON.stringify(["New item A", "New item B", "New item C"]),
      },
    ]);
    mockRun.mockResolvedValueOnce(undefined); // INSERT
    mockRun.mockResolvedValueOnce(undefined); // UPDATE

    const allChecked = JSON.stringify([
      { label: "New item A", checked: true },
      { label: "New item B", checked: true },
      { label: "New item C", checked: true },
    ]);
    const req = createMockRequest({
      listingId: "listing-1",
      checkboxStates: allChecked,
    });
    const result = await handleSubmitDeclaration(req);

    expect(result.success).toBe(true);
    expect(mockLogAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        details: expect.stringContaining("v2.0"),
      }),
    );
  });

  it("7.7 Duplicate declaration prevention: reject second declaration for same listing", async () => {
    mockRun.mockResolvedValueOnce({ ID: "listing-1", sellerId: "seller-1", status: "draft" });
    mockRun.mockResolvedValueOnce({ ID: "existing-decl-id" }); // existing declaration found

    const allChecked = JSON.stringify([{ label: "Item 1", checked: true }]);
    const req = createMockRequest({
      listingId: "listing-1",
      checkboxStates: allChecked,
    });
    await handleSubmitDeclaration(req);

    expect(req.error).toHaveBeenCalledWith(409, "A declaration already exists for this listing");
  });
});
