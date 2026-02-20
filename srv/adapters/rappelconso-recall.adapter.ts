import type { RecallRequest, RecallResponse, RecallCampaign } from "@auto/shared";
import type { IRecallAdapter } from "./interfaces/recall.interface";
import { delay } from "../lib/async-utils";

const DEFAULT_TIMEOUT_MS = 10000;
const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 1000;

interface RappelConsoRecord {
  reference_fiche?: string;
  nom_de_la_marque_du_produit?: string;
  noms_des_modeles_ou_references?: string;
  nature_du_risque_encouru_par_le_consommateur?: string;
  motif_du_rappel?: string;
  date_de_publication?: string;
  sous_categorie_de_produit?: string;
}

interface RappelConsoApiResponse {
  total_count?: number;
  results: RappelConsoRecord[];
}

/** RappelConso adapter for French vehicle recall data. */
export class RappelConsoRecallAdapter implements IRecallAdapter {
  readonly providerName = "rappelconso";
  readonly providerVersion = "1.0.0";

  constructor(
    private baseUrl = "https://data.economie.gouv.fr/api/explore/v2.1/catalog/datasets/rappelconso0/records",
    private timeoutMs = DEFAULT_TIMEOUT_MS,
  ) {}

  async getRecalls(request: RecallRequest): Promise<RecallResponse> {
    const whereClause = buildWhereClause(request);
    const params = new URLSearchParams();
    params.set("where", whereClause);
    params.set("limit", "50");
    params.set(
      "select",
      "reference_fiche,nom_de_la_marque_du_produit,noms_des_modeles_ou_references,nature_du_risque_encouru_par_le_consommateur,motif_du_rappel,date_de_publication,sous_categorie_de_produit",
    );
    params.set("order_by", "date_de_publication DESC");

    const url = `${this.baseUrl}?${params.toString()}`;
    const data = (await this.fetchWithRetry(url)) as RappelConsoApiResponse;

    const recalls: RecallCampaign[] = (data.results || []).map(
      (r: RappelConsoRecord): RecallCampaign => ({
        id: r.reference_fiche || "unknown",
        title: r.motif_du_rappel || "Rappel véhicule",
        description: r.nature_du_risque_encouru_par_le_consommateur || "",
        publishedDate: r.date_de_publication || "",
        riskLevel: mapRiskLevel(r.nature_du_risque_encouru_par_le_consommateur),
        manufacturer: r.nom_de_la_marque_du_produit || request.make,
        affectedModels: r.noms_des_modeles_ou_references ? [r.noms_des_modeles_ou_references] : [],
      }),
    );

    return {
      recalls,
      totalCount: data.total_count ?? recalls.length,
      provider: { providerName: this.providerName, providerVersion: this.providerVersion },
    };
  }

  private async fetchWithRetry(url: string, attempt = 0): Promise<unknown> {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

      try {
        const response = await fetch(url, { signal: controller.signal });
        if (!response.ok) {
          throw new Error(`RappelConso API error: ${response.status} ${response.statusText}`);
        }
        return await response.json();
      } finally {
        clearTimeout(timeout);
      }
    } catch (err) {
      if (attempt < MAX_RETRIES) {
        await delay(RETRY_DELAY_MS * (attempt + 1));
        return this.fetchWithRetry(url, attempt + 1);
      }
      throw new Error(
        `RappelConso API request failed after ${MAX_RETRIES + 1} attempts: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}

/** Escape double quotes and backslashes for OData string literals. */
function escapeODataValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function buildWhereClause(request: RecallRequest): string {
  const parts: string[] = [];
  // Filter for automobile category
  parts.push(`sous_categorie_de_produit = "Automobiles"`);

  if (request.make) {
    parts.push(`nom_de_la_marque_du_produit like "${escapeODataValue(request.make)}"`);
  }
  if (request.model) {
    parts.push(`noms_des_modeles_ou_references like "*${escapeODataValue(request.model)}*"`);
  }

  return parts.join(" AND ");
}

function mapRiskLevel(riskDescription: string | undefined): string {
  if (!riskDescription) return "unknown";
  const lower = riskDescription.toLowerCase();
  if (lower.includes("incendie") || lower.includes("blessure grave")) return "high";
  if (lower.includes("blessure") || lower.includes("accident")) return "medium";
  return "low";
}
