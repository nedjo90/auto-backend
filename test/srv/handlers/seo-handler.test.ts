/* eslint-disable @typescript-eslint/no-explicit-any */

const mockCacheGet = jest.fn();
const mockLog = { warn: jest.fn(), info: jest.fn(), error: jest.fn(), debug: jest.fn() };

jest.mock("@sap/cds", () => ({
  __esModule: true,
  default: {
    log: jest.fn(() => mockLog),
    entities: jest.fn(() => ({
      Listing: "Listing",
      ListingPhoto: "ListingPhoto",
    })),
    run: jest.fn(),
    utils: { uuid: jest.fn(() => "mock-uuid") },
  },
}));

jest.mock("../../../srv/lib/config-cache", () => ({
  configCache: {
    get: (...args: any[]) => mockCacheGet(...args),
    getAll: jest.fn(() => []),
    invalidate: jest.fn(),
    refresh: jest.fn(),
    refreshTable: jest.fn(),
    isReady: jest.fn(() => true),
  },
}));

jest.mock("../../../srv/lib/market-price", () => ({
  computeMarketComparison: jest.fn(() => null),
}));

import cds from "@sap/cds";
import {
  handleGetListingSeoData,
  handleGetListingSlugs,
} from "../../../srv/handlers/catalog-handler";

// Mock SEO template
const mockTemplate = {
  metaTitleTemplate: "{{brand}} {{model}} {{year}} - Achat voiture occasion | Auto",
  metaDescriptionTemplate: "Achetez {{brand}} {{model}} {{year}} a {{city}} pour {{price}} EUR.",
  ogTitleTemplate: "{{brand}} {{model}} {{year}} | Auto",
  ogDescriptionTemplate: "Decouvrez cette {{brand}} {{model}} {{year}}.",
  canonicalUrlPattern: "/annonces/{{id}}",
  active: true,
};

function createMockRequest(data: any) {
  return {
    data,
    error: jest.fn((code: number, msg: string) => ({ code, message: msg })),
    reject: jest.fn(),
  } as unknown as cds.Request;
}

describe("SEO handlers", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Setup SELECT chainable mock
    (global as any).SELECT = {
      one: {
        from: jest.fn().mockReturnValue({
          columns: jest.fn().mockReturnValue({
            where: jest.fn(),
          }),
          where: jest.fn(),
        }),
      },
      from: jest.fn().mockReturnValue({
        columns: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            orderBy: jest.fn().mockReturnValue({
              limit: jest.fn(),
            }),
          }),
        }),
      }),
    };
  });

  describe("handleGetListingSeoData", () => {
    const publishedListing = {
      ID: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      make: "Peugeot",
      model: "3008",
      year: 2022,
      price: 25000,
      mileage: 45000,
      fuelType: "Diesel",
      gearbox: "Automatique",
      color: "Gris",
      description: "Superbe SUV",
      status: "published",
      city: "Marseille",
    };

    it("should return SEO data for a published listing", async () => {
      mockCacheGet.mockReturnValueOnce(mockTemplate);

      // Mock listing query
      (cds.run as jest.Mock)
        .mockResolvedValueOnce(publishedListing) // listing
        .mockResolvedValueOnce({ cdnUrl: "https://cdn.example.com/photo.jpg" }); // photo

      const req = createMockRequest({
        listingId: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      });

      const result = (await handleGetListingSeoData(req)) as any;

      expect(result.slug).toBe("peugeot-3008-2022-marseille-a1b2c3d4-e5f6-7890-abcd-ef1234567890");
      expect(result.metaTitle).toBe("Peugeot 3008 2022 - Achat voiture occasion | Auto");
      expect(result.metaDescription).toBe("Achetez Peugeot 3008 2022 a Marseille pour 25000 EUR.");
      expect(result.ogTitle).toBe("Peugeot 3008 2022 | Auto");
      expect(result.ogImage).toBe("https://cdn.example.com/photo.jpg");
      expect(result.canonicalUrl).toBe(
        "/listing/peugeot-3008-2022-marseille-a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      );

      const structuredData = JSON.parse(result.structuredData);
      expect(structuredData["@context"]).toBe("https://schema.org");
      expect(structuredData["@graph"]).toHaveLength(2);
    });

    it("should return 400 for invalid listing ID", async () => {
      const req = createMockRequest({ listingId: "invalid" });
      await handleGetListingSeoData(req);
      expect(req.error).toHaveBeenCalledWith(400, expect.any(String));
    });

    it("should return 400 for empty listing ID", async () => {
      const req = createMockRequest({ listingId: "" });
      await handleGetListingSeoData(req);
      expect(req.error).toHaveBeenCalledWith(400, expect.any(String));
    });

    it("should return 404 for non-existent listing", async () => {
      (cds.run as jest.Mock).mockResolvedValueOnce(null);

      const req = createMockRequest({
        listingId: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      });

      await handleGetListingSeoData(req);
      expect(req.error).toHaveBeenCalledWith(404, expect.any(String));
    });

    it("should return 404 for draft listing", async () => {
      (cds.run as jest.Mock).mockResolvedValueOnce({ ...publishedListing, status: "draft" });

      const req = createMockRequest({
        listingId: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      });

      await handleGetListingSeoData(req);
      expect(req.error).toHaveBeenCalledWith(404, expect.any(String));
    });

    it("should use fallback meta when no SEO template found", async () => {
      mockCacheGet.mockReturnValueOnce(undefined); // no template

      (cds.run as jest.Mock).mockResolvedValueOnce(publishedListing).mockResolvedValueOnce(null); // no photo

      const req = createMockRequest({
        listingId: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      });

      const result = (await handleGetListingSeoData(req)) as any;

      expect(result.slug).toContain("peugeot-3008-2022-marseille");
      expect(result.metaTitle).toContain("Peugeot");
      expect(result.ogImage).toBe("");
    });

    it("should work for sold listings", async () => {
      mockCacheGet.mockReturnValueOnce(mockTemplate);

      (cds.run as jest.Mock)
        .mockResolvedValueOnce({ ...publishedListing, status: "sold" })
        .mockResolvedValueOnce(null);

      const req = createMockRequest({
        listingId: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      });

      const result = (await handleGetListingSeoData(req)) as any;

      expect(result.slug).toBeDefined();
      const structuredData = JSON.parse(result.structuredData);
      const product = structuredData["@graph"][1];
      expect(product.offers.availability).toBe("https://schema.org/SoldOut");
    });
  });

  describe("handleGetListingSlugs", () => {
    it("should return paginated listing slugs", async () => {
      (cds.run as jest.Mock)
        .mockResolvedValueOnce({ count: 2 }) // count
        .mockResolvedValueOnce([
          {
            ID: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
            make: "Peugeot",
            model: "3008",
            year: 2022,
            city: "Marseille",
            modifiedAt: "2026-02-20T10:00:00Z",
          },
          {
            ID: "b2c3d4e5-f6a7-8901-bcde-f12345678901",
            make: "Renault",
            model: "Clio",
            year: 2021,
            city: "Paris",
            modifiedAt: "2026-02-19T10:00:00Z",
          },
        ]);

      const req = createMockRequest({ skip: 0, top: 10 });
      const result = (await handleGetListingSlugs(req)) as any;

      expect(result.total).toBe(2);
      expect(result.hasMore).toBe(false);

      const slugs = JSON.parse(result.slugs);
      expect(slugs).toHaveLength(2);
      expect(slugs[0].slug).toContain("peugeot-3008-2022-marseille");
      expect(slugs[0].lastModified).toBe("2026-02-20T10:00:00Z");
      expect(slugs[1].slug).toContain("renault-clio-2021-paris");
    });

    it("should indicate hasMore when more results exist", async () => {
      (cds.run as jest.Mock).mockResolvedValueOnce({ count: 100 }).mockResolvedValueOnce([]);

      const req = createMockRequest({ skip: 0, top: 10 });
      const result = (await handleGetListingSlugs(req)) as any;

      expect(result.total).toBe(100);
      expect(result.hasMore).toBe(true);
    });

    it("should default skip=0 and top=1000", async () => {
      (cds.run as jest.Mock).mockResolvedValueOnce({ count: 0 }).mockResolvedValueOnce([]);

      const req = createMockRequest({});
      const result = (await handleGetListingSlugs(req)) as any;

      expect(result.total).toBe(0);
      expect(result.hasMore).toBe(false);
    });
  });
});
