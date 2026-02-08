import * as jose from "jose";
import type { IDecodedToken } from "@auto/shared";

export class JwtValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "JwtValidationError";
  }
}

// Re-export IDecodedToken so consumers don't need to import from shared directly
export type { IDecodedToken };

// H5: Lazy env var access with fail-fast validation
function getConfig() {
  const tenantName = process.env.AZURE_AD_B2C_TENANT_NAME;
  const policyName = process.env.AZURE_AD_B2C_SIGN_UP_SIGN_IN_FLOW || "B2C_1_signupsignin";
  const clientId = process.env.AZURE_AD_B2C_CLIENT_ID;
  const tenantId = process.env.AZURE_AD_B2C_TENANT_ID;

  if (!tenantName || !clientId || !tenantId) {
    throw new JwtValidationError(
      "Missing required Azure AD B2C configuration: AZURE_AD_B2C_TENANT_NAME, AZURE_AD_B2C_CLIENT_ID, and AZURE_AD_B2C_TENANT_ID must be set",
    );
  }

  return { tenantName, policyName, clientId, tenantId };
}

let jwks: ReturnType<typeof jose.createRemoteJWKSet> | null = null;
let cachedJwksUrl: string | null = null;

function getJWKS() {
  const { tenantName, policyName } = getConfig();
  const jwksUrl = `https://${tenantName}.b2clogin.com/${tenantName}.onmicrosoft.com/${policyName}/discovery/v2.0/keys`;

  // Rebuild if URL changed (env vars updated)
  if (!jwks || cachedJwksUrl !== jwksUrl) {
    jwks = jose.createRemoteJWKSet(new URL(jwksUrl), {
      cooldownDuration: 30_000,
    });
    cachedJwksUrl = jwksUrl;
  }
  return jwks;
}

/**
 * Validates a JWT token against Azure AD B2C JWKS endpoint.
 * Returns decoded payload on success, throws JwtValidationError on failure.
 */
export async function validateToken(token: string): Promise<IDecodedToken> {
  if (!token) {
    throw new JwtValidationError("Token is required");
  }

  const { tenantName, clientId, tenantId } = getConfig();

  try {
    // H8: Pin algorithms to RS256 per RFC 8725
    const { payload } = await jose.jwtVerify(token, getJWKS(), {
      issuer: `https://${tenantName}.b2clogin.com/${tenantId}/v2.0/`,
      audience: clientId,
      algorithms: ["RS256"],
    });

    if (!payload.sub) {
      throw new JwtValidationError("Token missing subject claim");
    }

    return {
      sub: payload.sub,
      email: payload.email as string | undefined,
      name: payload.name as string | undefined,
      iss: payload.iss,
      aud: typeof payload.aud === "string" ? payload.aud : undefined,
      exp: payload.exp,
      nbf: payload.nbf,
      iat: payload.iat,
    };
  } catch (error) {
    if (error instanceof JwtValidationError) {
      throw error;
    }
    if (error instanceof jose.errors.JWTExpired) {
      throw new JwtValidationError("Token expired");
    }
    if (error instanceof jose.errors.JWTClaimValidationFailed) {
      throw new JwtValidationError(`Token claim validation failed: ${error.message}`);
    }
    throw new JwtValidationError(
      `Token validation failed: ${error instanceof Error ? error.message : "Unknown error"}`,
    );
  }
}

/** @internal Reset JWKS cache (for testing only) */
export function resetJWKSCache(): void {
  if (process.env.NODE_ENV !== "test") return;
  jwks = null;
  cachedJwksUrl = null;
}
