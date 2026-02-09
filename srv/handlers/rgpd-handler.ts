import cds from "@sap/cds";
import { ANONYMIZATION_FIELDS } from "@auto/shared";
import type { IIdentityProviderAdapter } from "../adapters/interfaces/identity-provider.interface";
import type { IBlobStorageAdapter } from "../adapters/interfaces/blob-storage.interface";
import { getIdentityProvider } from "../adapters/factory/adapter-factory";
import { getBlobStorage } from "../adapters/factory/adapter-factory";

const LOG = cds.log("rgpd");
const EXPORT_CONTAINER = "rgpd-exports";

/**
 * Generates a random 6-digit confirmation code.
 */
export function generateConfirmationCode(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}

/**
 * Collects all personal data for a user into a structured export.
 */
export async function collectUserData(
  userId: string,
  entities: Record<string, unknown>,
): Promise<Array<{ section: string; data: unknown }>> {
  const { User, UserConsent, AuditLog } = entities as Record<string, string>;
  const sections: Array<{ section: string; data: unknown }> = [];

  // Profile data
  const user = await cds.run(SELECT.one.from(User).where({ ID: userId }));
  sections.push({ section: "profile", data: user || {} });

  // Consent records
  const consents = await cds.run(SELECT.from(UserConsent).where({ user_ID: userId }));
  sections.push({ section: "consents", data: consents || [] });

  // Audit trail
  const audits = await cds.run(SELECT.from(AuditLog).where({ userId }));
  sections.push({ section: "auditTrail", data: audits || [] });

  // Placeholder sections for future entities
  sections.push({ section: "listings", data: [] });
  sections.push({ section: "messages", data: [] });
  sections.push({ section: "declarations", data: [] });

  return sections;
}

/**
 * Anonymizes a user's personal data in the database.
 */
export function buildAnonymizedData(userId: string): Record<string, unknown> {
  const hash = userId.substring(0, 8);
  return {
    firstName: "Anonyme",
    lastName: "Utilisateur",
    email: `anonymized-${hash}@anonymized.auto`,
    displayName: "Utilisateur anonymisé",
    phone: null,
    address: null,
    addressStreet: null,
    addressCity: null,
    addressPostalCode: null,
    addressCountry: null,
    siret: null,
    companyName: null,
    avatarUrl: null,
    bio: null,
    isAnonymized: true,
    status: "anonymized",
  };
}

export default class RgpdService extends cds.ApplicationService {
  identityProvider: IIdentityProviderAdapter | null = null;
  blobStorage: IBlobStorageAdapter | null = null;

  async init() {
    try {
      this.identityProvider = getIdentityProvider();
    } catch {
      LOG.warn("Identity provider not configured");
    }
    try {
      this.blobStorage = getBlobStorage();
    } catch {
      LOG.warn("Blob storage not configured");
    }

    this.on("requestDataExport", this.requestDataExport);
    this.on("getExportStatus", this.getExportStatus);
    this.on("downloadExport", this.downloadExport);
    this.on("requestAnonymization", this.requestAnonymization);
    this.on("confirmAnonymization", this.confirmAnonymization);
    await super.init();
  }

  private requestDataExport = async (req: cds.Request) => {
    const azureUserId = req.user?.id;
    if (!azureUserId) return req.reject(401, "Authentication required");

    const { User, DataExportRequest, AuditLog } = cds.entities("auto");

    const user = await cds.run(SELECT.one.from(User).where({ azureAdB2cId: azureUserId }));
    if (!user) return req.reject(404, "User not found");

    // Check for existing pending/processing export
    const existingExport = await cds.run(
      SELECT.one
        .from(DataExportRequest)
        .where({ user_ID: user.ID, status: { in: ["pending", "processing"] } }),
    );
    if (existingExport) {
      return {
        requestId: existingExport.ID,
        status: existingExport.status,
        estimatedCompletionMinutes: 5,
      };
    }

    const requestId = cds.utils.uuid();
    const now = new Date().toISOString();

    await cds.run(
      INSERT.into(DataExportRequest).entries({
        ID: requestId,
        user_ID: user.ID,
        status: "pending",
        requestedAt: now,
      }),
    );

    // Log in audit trail
    await cds.run(
      INSERT.into(AuditLog).entries({
        ID: cds.utils.uuid(),
        userId: user.ID,
        action: "DATA_EXPORT_REQUESTED",
        resource: "DataExportRequest",
        details: JSON.stringify({ requestId }),
        timestamp: now,
      }),
    );

    // Trigger async export generation
    this.generateDataExport(requestId, user.ID).catch((err) => {
      LOG.error("Export generation failed:", err);
    });

    return {
      requestId,
      status: "pending",
      estimatedCompletionMinutes: 5,
    };
  };

  private generateDataExport = async (requestId: string, userId: string) => {
    const entities = cds.entities("auto");
    const { DataExportRequest } = entities;

    // Update status to processing
    await cds.run(UPDATE(DataExportRequest).set({ status: "processing" }).where({ ID: requestId }));

    // Collect all user data
    const sections = await collectUserData(userId, entities);
    const exportContent = {
      exportedAt: new Date().toISOString(),
      userId,
      sections,
    };

    const jsonContent = JSON.stringify(exportContent, null, 2);
    const fileSizeBytes = Buffer.byteLength(jsonContent, "utf-8");

    // Upload to blob storage
    let downloadUrl: string | null = null;
    const expiryHours = 48;
    const expiresAt = new Date(Date.now() + expiryHours * 60 * 60 * 1000).toISOString();

    if (this.blobStorage) {
      const filePath = `${userId}/${requestId}.json`;
      await this.blobStorage.uploadFile(EXPORT_CONTAINER, filePath, jsonContent);
      downloadUrl = await this.blobStorage.generateSignedUrl(
        EXPORT_CONTAINER,
        filePath,
        expiryHours * 60,
      );
    }

    // Update request as ready
    await cds.run(
      UPDATE(DataExportRequest)
        .set({
          status: "ready",
          completedAt: new Date().toISOString(),
          downloadUrl,
          expiresAt,
          fileSizeBytes,
        })
        .where({ ID: requestId }),
    );
  };

  private getExportStatus = async (req: cds.Request) => {
    const azureUserId = req.user?.id;
    if (!azureUserId) return req.reject(401, "Authentication required");

    const requestId = req.data.requestId;
    if (!requestId) return req.reject(400, "requestId is required");

    const { User, DataExportRequest } = cds.entities("auto");

    const user = await cds.run(SELECT.one.from(User).where({ azureAdB2cId: azureUserId }));
    if (!user) return req.reject(404, "User not found");

    const exportReq = await cds.run(
      SELECT.one.from(DataExportRequest).where({ ID: requestId, user_ID: user.ID }),
    );
    if (!exportReq) return req.reject(404, "Export request not found");

    return {
      requestId: exportReq.ID,
      status: exportReq.status,
      estimatedCompletionMinutes: exportReq.status === "ready" ? 0 : 5,
    };
  };

  private downloadExport = async (req: cds.Request) => {
    const azureUserId = req.user?.id;
    if (!azureUserId) return req.reject(401, "Authentication required");

    const requestId = req.data.requestId;
    if (!requestId) return req.reject(400, "requestId is required");

    const { User, DataExportRequest } = cds.entities("auto");

    const user = await cds.run(SELECT.one.from(User).where({ azureAdB2cId: azureUserId }));
    if (!user) return req.reject(404, "User not found");

    const exportReq = await cds.run(
      SELECT.one.from(DataExportRequest).where({ ID: requestId, user_ID: user.ID }),
    );
    if (!exportReq) return req.reject(404, "Export request not found");

    if (exportReq.status !== "ready") {
      return req.reject(400, "Export is not ready for download");
    }

    // Check expiry
    if (exportReq.expiresAt && new Date(exportReq.expiresAt) < new Date()) {
      await cds.run(UPDATE(DataExportRequest).set({ status: "expired" }).where({ ID: requestId }));
      return req.reject(410, "Export download has expired");
    }

    // Mark as downloaded
    await cds.run(UPDATE(DataExportRequest).set({ status: "downloaded" }).where({ ID: requestId }));

    return {
      downloadUrl: exportReq.downloadUrl,
      expiresAt: exportReq.expiresAt,
      fileSizeBytes: exportReq.fileSizeBytes,
    };
  };

  private requestAnonymization = async (req: cds.Request) => {
    const azureUserId = req.user?.id;
    if (!azureUserId) return req.reject(401, "Authentication required");

    const { User, AnonymizationRequest, AuditLog } = cds.entities("auto");

    const user = await cds.run(SELECT.one.from(User).where({ azureAdB2cId: azureUserId }));
    if (!user) return req.reject(404, "User not found");

    if (user.isAnonymized) return req.reject(400, "Account is already anonymized");

    // Check for existing pending request
    const existingReq = await cds.run(
      SELECT.one
        .from(AnonymizationRequest)
        .where({ user_ID: user.ID, status: { in: ["requested", "confirmed"] } }),
    );
    if (existingReq) {
      return {
        requestId: existingReq.ID,
        status: existingReq.status,
        message: "Une demande d'anonymisation est déjà en cours",
      };
    }

    const requestId = cds.utils.uuid();
    const confirmationCode = generateConfirmationCode();
    const now = new Date().toISOString();

    await cds.run(
      INSERT.into(AnonymizationRequest).entries({
        ID: requestId,
        user_ID: user.ID,
        status: "requested",
        requestedAt: now,
        anonymizedFields: JSON.stringify({ confirmationCode }),
      }),
    );

    // Log in audit trail
    await cds.run(
      INSERT.into(AuditLog).entries({
        ID: cds.utils.uuid(),
        userId: user.ID,
        action: "ANONYMIZATION_REQUESTED",
        resource: "AnonymizationRequest",
        details: JSON.stringify({ requestId }),
        timestamp: now,
      }),
    );

    return {
      requestId,
      status: "requested",
      message: "Veuillez confirmer l'anonymisation avec le code de confirmation",
    };
  };

  private confirmAnonymization = async (req: cds.Request) => {
    const azureUserId = req.user?.id;
    if (!azureUserId) return req.reject(401, "Authentication required");

    const { requestId, confirmationCode } = req.data;
    if (!requestId || !confirmationCode) {
      return req.reject(400, "requestId and confirmationCode are required");
    }

    const { User, AnonymizationRequest, AuditLog } = cds.entities("auto");

    const user = await cds.run(SELECT.one.from(User).where({ azureAdB2cId: azureUserId }));
    if (!user) return req.reject(404, "User not found");

    const anonReq = await cds.run(
      SELECT.one
        .from(AnonymizationRequest)
        .where({ ID: requestId, user_ID: user.ID, status: "requested" }),
    );
    if (!anonReq) return req.reject(404, "Anonymization request not found");

    // Verify confirmation code
    const storedData = JSON.parse(anonReq.anonymizedFields || "{}");
    if (storedData.confirmationCode !== confirmationCode) {
      return req.reject(400, "Invalid confirmation code");
    }

    const now = new Date().toISOString();

    // Update status to confirmed then processing
    await cds.run(
      UPDATE(AnonymizationRequest)
        .set({ status: "processing", confirmedAt: now })
        .where({ ID: requestId }),
    );

    // Execute anonymization
    try {
      const anonymizedData = buildAnonymizedData(user.ID);
      await cds.run(UPDATE(User).set(anonymizedData).where({ ID: user.ID }));

      // Disable AD B2C account
      if (this.identityProvider && user.azureAdB2cId) {
        try {
          await this.identityProvider.disableUser(user.azureAdB2cId);
        } catch {
          LOG.warn("Failed to disable AD B2C account, continuing with anonymization");
        }
      }

      // Update anonymization request as completed
      await cds.run(
        UPDATE(AnonymizationRequest)
          .set({
            status: "completed",
            completedAt: new Date().toISOString(),
            anonymizedFields: JSON.stringify(ANONYMIZATION_FIELDS),
          })
          .where({ ID: requestId }),
      );

      // Log completion
      await cds.run(
        INSERT.into(AuditLog).entries({
          ID: cds.utils.uuid(),
          userId: user.ID,
          action: "ANONYMIZATION_COMPLETED",
          resource: "AnonymizationRequest",
          details: JSON.stringify({
            requestId,
            anonymizedFields: ANONYMIZATION_FIELDS,
          }),
          timestamp: new Date().toISOString(),
        }),
      );

      return { success: true, message: "Compte anonymisé avec succès" };
    } catch (err) {
      // Mark as failed
      await cds.run(
        UPDATE(AnonymizationRequest).set({ status: "failed" }).where({ ID: requestId }),
      );
      LOG.error("Anonymization failed:", err);
      return req.reject(500, "Anonymization failed");
    }
  };
}
