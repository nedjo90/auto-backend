import type { RecallRequest, RecallResponse, RecallCampaign } from "@auto/shared";
import type { IRecallAdapter } from "../interfaces/recall.interface";
import { delay } from "../../lib/async-utils";

const MOCK_RECALLS: Record<string, RecallCampaign[]> = {
  "Citroën|C3": [
    {
      id: "RC-2024-001",
      title: "Airbag conducteur défectueux",
      description: "Risque de non-déploiement de l'airbag en cas de choc frontal",
      publishedDate: "2024-01-15",
      riskLevel: "high",
      manufacturer: "Citroën",
      affectedModels: ["C3 2017-2020"],
    },
  ],
  "Renault|Clio V": [],
  "Peugeot|308": [
    {
      id: "RC-2023-042",
      title: "Ceinture de sécurité arrière",
      description: "Fixation insuffisante de la ceinture centrale arrière",
      publishedDate: "2023-09-20",
      riskLevel: "medium",
      manufacturer: "Peugeot",
      affectedModels: ["308 2021-2022"],
    },
    {
      id: "RC-2024-018",
      title: "Fuite circuit de refroidissement",
      description: "Risque de fuite de liquide de refroidissement sur moteur 1.5 BlueHDi",
      publishedDate: "2024-03-01",
      riskLevel: "low",
      manufacturer: "Peugeot",
      affectedModels: ["308 2022-2023"],
    },
  ],
};

export class MockRecallAdapter implements IRecallAdapter {
  readonly providerName = "mock";
  readonly providerVersion = "1.0.0";

  constructor(private delayMs = 0) {}

  async getRecalls(request: RecallRequest): Promise<RecallResponse> {
    if (this.delayMs > 0) await delay(this.delayMs);

    const key = `${request.make}|${request.model}`;
    const recalls = MOCK_RECALLS[key] || [];

    const filtered = recalls.filter((r) => {
      if (request.yearFrom || request.yearTo) {
        const yearMatch = r.affectedModels.some((m) => {
          const years = m.match(/\d{4}/g)?.map(Number) || [];
          return years.some(
            (y) =>
              (!request.yearFrom || y >= request.yearFrom) &&
              (!request.yearTo || y <= request.yearTo),
          );
        });
        return yearMatch;
      }
      return true;
    });

    return {
      recalls: filtered,
      totalCount: filtered.length,
      provider: { providerName: "mock", providerVersion: "1.0.0" },
    };
  }
}
