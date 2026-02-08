import cds from "@sap/cds";

export default class ConsentServiceHandler extends cds.ApplicationService {
  async init() {
    this.on("READ", "ActiveConsentTypes", this.getActiveConsentTypes);
    this.on("recordConsent", this.handleRecordConsent);
    this.on("recordConsents", this.handleRecordConsents);
    this.on("getUserConsents", this.handleGetUserConsents);
    this.on("getPendingConsents", this.handleGetPendingConsents);

    // Enforce append-only on UserConsent
    const { UserConsent } = cds.entities("auto");
    this.before(["UPDATE", "DELETE"], UserConsent, (req: cds.Request) => {
      return req.reject(403, "UserConsent records are immutable");
    });

    await super.init();
  }

  private getActiveConsentTypes = async () => {
    const { ConfigConsentType } = cds.entities("auto");
    return cds.run(
      SELECT.from(ConfigConsentType)
        .where({ isActive: true })
        .orderBy("displayOrder asc"),
    );
  };

  private handleRecordConsent = async (req: cds.Request) => {
    const { consentTypeId, decision } = req.data.input;
    const { ConfigConsentType, UserConsent } = cds.entities("auto");

    // Validate consent type exists and is active
    const consentType = await cds.run(
      SELECT.one.from(ConfigConsentType).where({ ID: consentTypeId, isActive: true }),
    );
    if (!consentType) {
      return req.reject(404, "Consent type not found or inactive");
    }

    // Validate decision value
    if (decision !== "granted" && decision !== "revoked") {
      return req.reject(400, "Decision must be 'granted' or 'revoked'");
    }

    const id = cds.utils.uuid();
    await cds.run(
      INSERT.into(UserConsent).entries({
        ID: id,
        user_ID: req.user?.id || null,
        consentType_ID: consentTypeId,
        consentTypeVersion: consentType.version,
        decision,
        timestamp: new Date().toISOString(),
        ipAddress: req.headers?.["x-forwarded-for"] || null,
        userAgent: req.headers?.["user-agent"] || null,
      }),
    );

    return { success: true, id };
  };

  private handleRecordConsents = async (req: cds.Request) => {
    const { consents } = req.data.input;
    const { ConfigConsentType, UserConsent } = cds.entities("auto");

    if (!Array.isArray(consents) || consents.length === 0) {
      return req.reject(400, "Consents array is required and must not be empty");
    }

    // Load all referenced consent types in one query
    const consentTypeIds = consents.map((c: { consentTypeId: string }) => c.consentTypeId);
    const consentTypes = await cds.run(
      SELECT.from(ConfigConsentType).where({ ID: { in: consentTypeIds }, isActive: true }),
    );
    const consentTypeMap = new Map(
      consentTypes.map((ct: { ID: string; version: number }) => [ct.ID, ct]),
    );

    // Validate all consent types exist
    for (const consent of consents) {
      if (!consentTypeMap.has(consent.consentTypeId)) {
        return req.reject(404, `Consent type ${consent.consentTypeId} not found or inactive`);
      }
      if (consent.decision !== "granted" && consent.decision !== "revoked") {
        return req.reject(400, "Decision must be 'granted' or 'revoked'");
      }
    }

    const now = new Date().toISOString();
    const entries = consents.map((consent: { consentTypeId: string; decision: string }) => {
      const ct = consentTypeMap.get(consent.consentTypeId) as { version: number };
      return {
        ID: cds.utils.uuid(),
        user_ID: req.user?.id || null,
        consentType_ID: consent.consentTypeId,
        consentTypeVersion: ct.version,
        decision: consent.decision,
        timestamp: now,
        ipAddress: req.headers?.["x-forwarded-for"] || null,
        userAgent: req.headers?.["user-agent"] || null,
      };
    });

    await cds.run(INSERT.into(UserConsent).entries(entries));

    return { success: true, count: entries.length };
  };

  private handleGetUserConsents = async (req: cds.Request) => {
    const { userId } = req.data;
    const { UserConsent } = cds.entities("auto");

    return cds.run(
      SELECT.from(UserConsent)
        .where({ user_ID: userId })
        .orderBy("timestamp desc"),
    );
  };

  private handleGetPendingConsents = async (req: cds.Request) => {
    const { userId } = req.data;
    const { ConfigConsentType, UserConsent } = cds.entities("auto");

    // Get all active consent types
    const activeTypes = await cds.run(
      SELECT.from(ConfigConsentType).where({ isActive: true }),
    );

    // Get user's latest consent per type
    const userConsents = await cds.run(
      SELECT.from(UserConsent)
        .where({ user_ID: userId })
        .orderBy("timestamp desc"),
    );

    // Build map of latest consent per type
    const latestByType = new Map<string, { consentTypeVersion: number; decision: string }>();
    for (const uc of userConsents) {
      if (!latestByType.has(uc.consentType_ID)) {
        latestByType.set(uc.consentType_ID, uc);
      }
    }

    // Return consent types that need re-consent:
    // - No prior consent at all
    // - Or version is newer than what user consented to
    return activeTypes.filter((ct: { ID: string; version: number }) => {
      const latest = latestByType.get(ct.ID);
      if (!latest) return true;
      return ct.version > latest.consentTypeVersion;
    });
  };
}
