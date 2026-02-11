import cds from "@sap/cds";
import type { IIdentityProviderAdapter } from "../adapters/interfaces/identity-provider.interface";
import { getIdentityProvider } from "../adapters/factory/adapter-factory";

export function validateRegistrationInput(
  input: Record<string, unknown>,
  fields: Array<{
    fieldName: string;
    isRequired: boolean;
    validationPattern: string | null;
  }>,
): string[] {
  const errors: string[] = [];
  for (const field of fields) {
    const value = input[field.fieldName];
    if (field.isRequired && (!value || (typeof value === "string" && value.trim() === ""))) {
      errors.push(`${field.fieldName} is required`);
    }
    if (field.validationPattern && value) {
      try {
        const regex = new RegExp(field.validationPattern);
        const str = String(value);
        // Guard against ReDoS: limit input length for regex validation
        if (str.length > 1000) {
          errors.push(`${field.fieldName} value is too long`);
        } else if (!regex.test(str)) {
          errors.push(`${field.fieldName} format is invalid`);
        }
      } catch {
        // Invalid regex pattern in config — skip validation, log would go here
        errors.push(`${field.fieldName} has invalid validation configuration`);
      }
    }
  }
  return errors;
}

export default class RegistrationService extends cds.ApplicationService {
  private _identityProvider: IIdentityProviderAdapter | null = null;

  get identityProvider(): IIdentityProviderAdapter {
    if (!this._identityProvider) {
      this._identityProvider = getIdentityProvider();
    }
    return this._identityProvider;
  }

  set identityProvider(adapter: IIdentityProviderAdapter | null) {
    this._identityProvider = adapter;
  }

  async init() {
    this.on("READ", "ConfigRegistrationFields", this.getRegistrationFields);
    this.on("register", this.registerUser);
    await super.init();
  }

  private getRegistrationFields = async () => {
    const { ConfigRegistrationField } = cds.entities("auto");
    return cds.run(
      SELECT.from(ConfigRegistrationField).where({ isVisible: true }).orderBy("displayOrder asc"),
    );
  };

  private registerUser = async (req: cds.Request) => {
    const input = req.data.input;
    const { ConfigRegistrationField, User, UserRole, Role } = cds.entities("auto");

    // Step a: Validate input against config field rules
    const fields = await cds.run(SELECT.from(ConfigRegistrationField).where({ isVisible: true }));
    const validationErrors = validateRegistrationInput(input, fields);

    // Server-side password validation (fixed field, not config-driven)
    if (!input.password || typeof input.password !== "string") {
      validationErrors.push("password is required");
    } else if (input.password.length < 8) {
      validationErrors.push("password must be at least 8 characters");
    }

    if (validationErrors.length > 0) {
      return req.reject(400, validationErrors.join("; "));
    }

    // Step b-check: Duplicate email
    const existing = await cds.run(SELECT.one.from(User).where({ email: input.email }));
    if (existing) {
      return req.reject(409, "Email already registered");
    }

    // Step b: Create user in Azure AD B2C
    if (!this.identityProvider) {
      return req.reject(503, "Identity provider not configured");
    }

    let externalId: string;
    try {
      externalId = await this.identityProvider.createUser({
        email: input.email,
        firstName: input.firstName,
        lastName: input.lastName,
        password: input.password,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unknown error";
      return req.reject(502, `Identity provider error: ${message}`);
    }

    // Step c+d: Create user record + assign Buyer role (rollback on failure)
    const userId = cds.utils.uuid();
    try {
      await cds.run(
        INSERT.into(User).entries({
          ID: userId,
          azureAdB2cId: externalId,
          email: input.email,
          firstName: input.firstName,
          lastName: input.lastName,
          phone: input.phone || null,
          address: null,
          siret: input.siret || null,
          isAnonymized: false,
          status: "active",
        }),
      );
      const buyerRole = await cds.run(SELECT.one.from(Role).where({ code: "buyer" }));
      if (!buyerRole) {
        throw new Error("Buyer role not found in database");
      }
      await cds.run(
        INSERT.into(UserRole).entries({
          ID: cds.utils.uuid(),
          user_ID: userId,
          role_ID: buyerRole.ID,
          assignedAt: new Date().toISOString(),
          assignedBy_ID: null,
        }),
      );
    } catch {
      // Rollback: disable AD B2C user on DB failure
      try {
        await this.identityProvider.disableUser(externalId);
      } catch {
        // Best-effort rollback
      }
      return req.reject(500, "Registration failed");
    }

    // Step e: Return success
    return {
      success: true,
      userId,
      email: input.email,
      redirectUrl: "/auth/callback",
    };
  };
}
