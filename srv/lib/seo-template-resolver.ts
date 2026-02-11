import { configCache } from "./config-cache";
import cds from "@sap/cds";

const LOG = cds.log("seo-resolver");

export interface SeoMeta {
  metaTitle: string;
  metaDescription: string;
  ogTitle: string;
  ogDescription: string;
  canonicalUrl: string;
}

/**
 * Replace {{placeholder}} tokens with values from data object.
 * Unreplaced tokens are removed (replaced with empty string).
 */
function renderTemplate(template: string, data: Record<string, string>): string {
  if (!template) return "";
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => data[key] ?? "");
}

/**
 * Resolve SEO meta data for a given page type and data context.
 *
 * Reads the template from config cache by pageType+language composite key,
 * replaces all {{placeholder}} tokens with provided data values.
 */
export function resolve(
  pageType: string,
  data: Record<string, string>,
  language = "fr",
): SeoMeta | null {
  const template = configCache.get<{
    metaTitleTemplate: string;
    metaDescriptionTemplate: string;
    ogTitleTemplate: string;
    ogDescriptionTemplate: string;
    canonicalUrlPattern: string;
    active: boolean;
  }>("ConfigSeoTemplate", `${pageType}:${language}`);

  if (!template) {
    LOG.warn(`No SEO template found for pageType=${pageType}, language=${language}`);
    return null;
  }

  if (!template.active) {
    LOG.debug(`SEO template for pageType=${pageType} is inactive`);
    return null;
  }

  return {
    metaTitle: renderTemplate(template.metaTitleTemplate, data),
    metaDescription: renderTemplate(template.metaDescriptionTemplate, data),
    ogTitle: renderTemplate(template.ogTitleTemplate, data),
    ogDescription: renderTemplate(template.ogDescriptionTemplate, data),
    canonicalUrl: renderTemplate(template.canonicalUrlPattern, data),
  };
}

/**
 * Resolve SEO meta with fallback: if template not found, return a minimal
 * default based on page title.
 */
export function resolveWithFallback(
  pageType: string,
  data: Record<string, string>,
  language = "fr",
): SeoMeta {
  const resolved = resolve(pageType, data, language);
  if (resolved) return resolved;

  // Fallback: generate minimal meta from data
  const title = data.title || data.brand || "Auto";
  return {
    metaTitle: `${title} | Auto`,
    metaDescription: "",
    ogTitle: `${title} | Auto`,
    ogDescription: "",
    canonicalUrl: "",
  };
}
