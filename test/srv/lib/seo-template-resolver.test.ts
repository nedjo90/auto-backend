/* eslint-disable @typescript-eslint/no-explicit-any */

const mockCacheGet = jest.fn();
const mockLog = { warn: jest.fn(), info: jest.fn(), error: jest.fn(), debug: jest.fn() };

jest.mock("@sap/cds", () => ({
  __esModule: true,
  default: {
    log: jest.fn(() => mockLog),
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

import { resolve, resolveWithFallback } from "../../../srv/lib/seo-template-resolver";
// SeoMeta type is tested implicitly through resolve/resolveWithFallback return types

const mockTemplate = {
  metaTitleTemplate: "{{brand}} {{model}} {{year}} - Achat voiture occasion | Auto",
  metaDescriptionTemplate: "Achetez {{brand}} {{model}} {{year}} a {{city}} pour {{price}} EUR.",
  ogTitleTemplate: "{{brand}} {{model}} {{year}} | Auto",
  ogDescriptionTemplate: "Decouvrez cette {{brand}} {{model}} {{year}}.",
  canonicalUrlPattern: "/annonces/{{id}}",
  active: true,
};

describe("seo-template-resolver", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("resolve", () => {
    it("should resolve template with all placeholders replaced", () => {
      mockCacheGet.mockReturnValueOnce(mockTemplate);

      const result = resolve("listing_detail", {
        brand: "Peugeot",
        model: "308",
        year: "2020",
        city: "Paris",
        price: "15000",
        id: "abc123",
      });

      expect(result).not.toBeNull();
      expect(result!.metaTitle).toBe("Peugeot 308 2020 - Achat voiture occasion | Auto");
      expect(result!.metaDescription).toBe("Achetez Peugeot 308 2020 a Paris pour 15000 EUR.");
      expect(result!.ogTitle).toBe("Peugeot 308 2020 | Auto");
      expect(result!.ogDescription).toBe("Decouvrez cette Peugeot 308 2020.");
      expect(result!.canonicalUrl).toBe("/annonces/abc123");
    });

    it("should use composite key (pageType:language) for cache lookup", () => {
      mockCacheGet.mockReturnValueOnce(mockTemplate);

      resolve("listing_detail", { brand: "Test" }, "fr");

      expect(mockCacheGet).toHaveBeenCalledWith("ConfigSeoTemplate", "listing_detail:fr");
    });

    it("should support custom language parameter", () => {
      mockCacheGet.mockReturnValueOnce(mockTemplate);

      resolve("listing_detail", { brand: "Test" }, "en");

      expect(mockCacheGet).toHaveBeenCalledWith("ConfigSeoTemplate", "listing_detail:en");
    });

    it("should default language to fr", () => {
      mockCacheGet.mockReturnValueOnce(mockTemplate);

      resolve("listing_detail", { brand: "Test" });

      expect(mockCacheGet).toHaveBeenCalledWith("ConfigSeoTemplate", "listing_detail:fr");
    });

    it("should return null when template not found", () => {
      mockCacheGet.mockReturnValueOnce(undefined);

      const result = resolve("unknown_page", {});

      expect(result).toBeNull();
      expect(mockLog.warn).toHaveBeenCalledWith(expect.stringContaining("No SEO template found"));
    });

    it("should return null when template is inactive", () => {
      mockCacheGet.mockReturnValueOnce({ ...mockTemplate, active: false });

      const result = resolve("listing_detail", { brand: "Test" });

      expect(result).toBeNull();
      expect(mockLog.debug).toHaveBeenCalledWith(expect.stringContaining("inactive"));
    });

    it("should remove unreplaced placeholders", () => {
      mockCacheGet.mockReturnValueOnce(mockTemplate);

      const result = resolve("listing_detail", { brand: "Peugeot" });

      expect(result).not.toBeNull();
      expect(result!.metaTitle).toBe("Peugeot   - Achat voiture occasion | Auto");
      // Unreplaced {{model}}, {{year}} become empty strings
      expect(result!.metaTitle).not.toContain("{{");
    });

    it("should handle empty data object", () => {
      mockCacheGet.mockReturnValueOnce(mockTemplate);

      const result = resolve("listing_detail", {});

      expect(result).not.toBeNull();
      expect(result!.metaTitle).not.toContain("{{");
    });

    it("should handle empty template strings", () => {
      mockCacheGet.mockReturnValueOnce({
        ...mockTemplate,
        metaTitleTemplate: "",
        metaDescriptionTemplate: "",
        ogTitleTemplate: "",
        ogDescriptionTemplate: "",
        canonicalUrlPattern: "",
      });

      const result = resolve("listing_detail", { brand: "Test" });

      expect(result).not.toBeNull();
      expect(result!.metaTitle).toBe("");
      expect(result!.metaDescription).toBe("");
      expect(result!.ogTitle).toBe("");
      expect(result!.ogDescription).toBe("");
      expect(result!.canonicalUrl).toBe("");
    });

    it("should handle template with no placeholders", () => {
      mockCacheGet.mockReturnValueOnce({
        ...mockTemplate,
        metaTitleTemplate: "Static Title",
      });

      const result = resolve("listing_detail", { brand: "Test" });

      expect(result!.metaTitle).toBe("Static Title");
    });

    it("should handle multiple occurrences of same placeholder", () => {
      mockCacheGet.mockReturnValueOnce({
        ...mockTemplate,
        metaTitleTemplate: "{{brand}} - {{brand}} occasion",
      });

      const result = resolve("listing_detail", { brand: "Peugeot" });

      expect(result!.metaTitle).toBe("Peugeot - Peugeot occasion");
    });
  });

  describe("resolveWithFallback", () => {
    it("should return resolved template when available", () => {
      mockCacheGet.mockReturnValueOnce(mockTemplate);

      const result = resolveWithFallback("listing_detail", {
        brand: "Peugeot",
        model: "308",
        year: "2020",
        city: "Paris",
        price: "15000",
        id: "abc123",
      });

      expect(result.metaTitle).toBe("Peugeot 308 2020 - Achat voiture occasion | Auto");
    });

    it("should return fallback when template not found", () => {
      mockCacheGet.mockReturnValueOnce(undefined);

      const result = resolveWithFallback("unknown_page", { title: "Ma page" });

      expect(result.metaTitle).toBe("Ma page | Auto");
      expect(result.ogTitle).toBe("Ma page | Auto");
      expect(result.metaDescription).toBe("");
      expect(result.canonicalUrl).toBe("");
    });

    it("should use brand for fallback when title not available", () => {
      mockCacheGet.mockReturnValueOnce(undefined);

      const result = resolveWithFallback("unknown_page", { brand: "Peugeot" });

      expect(result.metaTitle).toBe("Peugeot | Auto");
    });

    it("should use 'Auto' as fallback when no useful data", () => {
      mockCacheGet.mockReturnValueOnce(undefined);

      const result = resolveWithFallback("unknown_page", {});

      expect(result.metaTitle).toBe("Auto | Auto");
    });

    it("should return fallback when template is inactive", () => {
      mockCacheGet.mockReturnValueOnce({ ...mockTemplate, active: false });

      const result = resolveWithFallback("listing_detail", { brand: "Peugeot" });

      expect(result.metaTitle).toBe("Peugeot | Auto");
    });
  });
});
