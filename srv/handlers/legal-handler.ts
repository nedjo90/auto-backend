import cds from "@sap/cds";
import { acceptLegalDocumentInputSchema } from "@auto/shared";
import { logAudit } from "../lib/audit-logger";

const LOG = cds.log("legal");

export default class LegalServiceHandler extends cds.ApplicationService {
  async init() {
    this.on("getCurrentVersion", this.handleGetCurrentVersion);
    this.on("acceptLegalDocument", this.handleAcceptLegalDocument);
    this.on("checkLegalAcceptance", this.handleCheckLegalAcceptance);

    await super.init();
  }

  /**
   * Get the current (non-archived) version content for a document by key.
   */
  private handleGetCurrentVersion = async (req: cds.Request) => {
    const { documentKey } = req.data as { documentKey: string };
    if (!documentKey?.trim()) {
      return req.reject(400, "documentKey is required");
    }

    try {
      const entities = cds.entities("auto");
      const LegalDocument = entities["LegalDocument"];
      const LegalDocumentVersion = entities["LegalDocumentVersion"];
      if (!LegalDocument || !LegalDocumentVersion) {
        return req.reject(500, "Legal entities not found");
      }

      // Find the active document by key
      const doc = (await cds.run(
        SELECT.one.from(LegalDocument).where({ key: documentKey, active: true }),
      )) as { ID: string; currentVersion: number } | null;

      if (!doc) {
        return req.reject(404, "Document legal non trouve");
      }

      // Get the current version (non-archived)
      const version = (await cds.run(
        SELECT.one
          .from(LegalDocumentVersion)
          .where({ document_ID: doc.ID, version: doc.currentVersion, archived: false }),
      )) as {
        ID: string;
        document_ID: string;
        version: number;
        content: string;
        summary: string;
        publishedAt: string;
      } | null;

      if (!version) {
        return req.reject(404, "Version du document non trouvee");
      }

      return {
        ID: version.ID,
        document_ID: version.document_ID,
        version: version.version,
        content: version.content,
        summary: version.summary,
        publishedAt: version.publishedAt,
      };
    } catch (err) {
      LOG.error("Failed to get current legal version:", err);
      return req.reject(500, "Failed to get legal document version");
    }
  };

  /**
   * Accept a legal document version for the authenticated user.
   */
  private handleAcceptLegalDocument = async (req: cds.Request) => {
    const { documentId, version } = req.data as {
      documentId: string;
      version: number;
    };

    // Validate input
    const validation = acceptLegalDocumentInputSchema.safeParse({ documentId, version });
    if (!validation.success) {
      const errors = validation.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
      return req.reject(400, `Invalid input: ${errors.join("; ")}`);
    }

    try {
      const entities = cds.entities("auto");
      const LegalDocument = entities["LegalDocument"];
      const LegalAcceptance = entities["LegalAcceptance"];
      if (!LegalDocument || !LegalAcceptance) {
        return req.reject(500, "Legal entities not found");
      }

      // Verify document exists
      const doc = (await cds.run(SELECT.one.from(LegalDocument).where({ ID: documentId }))) as {
        ID: string;
        key: string;
        currentVersion: number;
      } | null;

      if (!doc) {
        return req.reject(404, "Document legal non trouve");
      }

      // Verify version matches current
      if (version !== doc.currentVersion) {
        return req.reject(
          400,
          `Version ${version} ne correspond pas a la version actuelle ${doc.currentVersion}`,
        );
      }

      const userId = req.user?.id;
      if (!userId) {
        return req.reject(401, "Utilisateur non authentifie");
      }

      // Check for existing acceptance (prevent duplicates)
      const existing = (await cds.run(
        SELECT.one
          .from(LegalAcceptance)
          .where({ user_ID: userId, document_ID: documentId, version }),
      )) as { ID: string } | null;

      if (existing) {
        return { success: true, message: "Document deja accepte." };
      }

      const now = new Date().toISOString();
      const acceptanceId = cds.utils.uuid();

      // Extract first IP from x-forwarded-for header (may contain comma-separated list)
      const forwardedFor = req.headers?.["x-forwarded-for"];
      const clientIp = forwardedFor
        ? Array.isArray(forwardedFor)
          ? forwardedFor[0]
          : forwardedFor.split(",")[0].trim()
        : null;

      await cds.run(
        INSERT.into(LegalAcceptance).entries({
          ID: acceptanceId,
          user_ID: userId,
          document_ID: documentId,
          documentKey: doc.key,
          version,
          acceptedAt: now,
          ipAddress: clientIp?.substring(0, 45) || null,
          userAgent: req.headers?.["user-agent"]?.substring(0, 500) || null,
        }),
      );

      // Log to audit trail
      await logAudit({
        userId,
        action: "LEGAL_ACCEPTED",
        resource: "LegalAcceptance",
        details: JSON.stringify({
          documentId,
          documentKey: doc.key,
          version,
        }),
      });

      return { success: true, message: "Document accepte." };
    } catch (err) {
      LOG.error("Failed to record legal acceptance:", err);
      return req.reject(500, "Failed to record acceptance");
    }
  };

  /**
   * Check which legal documents need re-acceptance for the current user.
   * Returns an array of documents where the user hasn't accepted the current version.
   */
  private handleCheckLegalAcceptance = async (req: cds.Request) => {
    const userId = req.user?.id;
    if (!userId) {
      return req.reject(401, "Utilisateur non authentifie");
    }

    try {
      const entities = cds.entities("auto");
      const LegalDocument = entities["LegalDocument"];
      const LegalDocumentVersion = entities["LegalDocumentVersion"];
      const LegalAcceptance = entities["LegalAcceptance"];
      if (!LegalDocument || !LegalDocumentVersion || !LegalAcceptance) {
        return [];
      }

      // Get all active documents that require re-acceptance
      const docs = (await cds.run(
        SELECT.from(LegalDocument).where({ active: true, requiresReacceptance: true }),
      )) as { ID: string; key: string; title: string; currentVersion: number }[];

      if (!docs || docs.length === 0) {
        return [];
      }

      // Batch: fetch all acceptances for this user across all relevant documents
      const documentIds = docs.map((d) => d.ID);
      const acceptances = (await cds.run(
        SELECT.from(LegalAcceptance).where({ user_ID: userId, document_ID: { in: documentIds } }),
      )) as { document_ID: string; version: number }[];

      const acceptedMap = new Map(acceptances.map((a) => [`${a.document_ID}_${a.version}`, true]));

      // Batch: fetch all current versions in one query
      const allVersions = (await cds.run(
        SELECT.from(LegalDocumentVersion).where({
          document_ID: { in: documentIds },
          archived: false,
        }),
      )) as { document_ID: string; version: number; summary: string }[];

      const versionMap = new Map(allVersions.map((v) => [v.document_ID, v]));

      // Build pending list without additional queries
      const pending: {
        documentId: string;
        documentKey: string;
        title: string;
        version: number;
        summary: string;
      }[] = [];

      for (const doc of docs) {
        const key = `${doc.ID}_${doc.currentVersion}`;
        if (!acceptedMap.has(key)) {
          const ver = versionMap.get(doc.ID);
          pending.push({
            documentId: doc.ID,
            documentKey: doc.key,
            title: doc.title,
            version: doc.currentVersion,
            summary: ver?.summary || "",
          });
        }
      }

      return pending;
    } catch (err) {
      LOG.error("Failed to check legal acceptance:", err);
      return req.reject(500, "Failed to check legal acceptance");
    }
  };
}
