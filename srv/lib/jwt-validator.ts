import * as jose from "jose";

export class JwtValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "JwtValidationError";
  }
}

export interface DecodedToken {
  sub: string;
  email?: string;
  name?: string;
  [key: string]: unknown;
}

const tenantName = process.env.AZURE_AD_B2C_TENANT_NAME || "";
const policyName =
  process.env.AZURE_AD_B2C_SIGN_UP_SIGN_IN_FLOW || "B2C_1_signupsignin";
const clientId = process.env.AZURE_AD_B2C_CLIENT_ID || "";

const jwksUrl = `https://${tenantName}.b2clogin.com/${tenantName}.onmicrosoft.com/${policyName}/discovery/v2.0/keys`;

let jwks: ReturnType<typeof jose.createRemoteJWKSet> | null = null;

function getJWKS() {
  if (!jwks) {
    jwks = jose.createRemoteJWKSet(new URL(jwksUrl));
  }
  return jwks;
}

/**
 * Validates a JWT token against Azure AD B2C JWKS endpoint.
 * Returns decoded payload on success, throws JwtValidationError on failure.
 */
export async function validateToken(token: string): Promise<DecodedToken> {
  if (!token) {
    throw new JwtValidationError("Token is required");
  }

  try {
    const { payload } = await jose.jwtVerify(token, getJWKS(), {
      issuer: `https://${tenantName}.b2clogin.com/${process.env.AZURE_AD_B2C_TENANT_ID || ""}/v2.0/`,
      audience: clientId,
    });

    if (!payload.sub) {
      throw new JwtValidationError("Token missing subject claim");
    }

    return {
      sub: payload.sub,
      email: payload.email as string | undefined,
      name: payload.name as string | undefined,
      ...payload,
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

/** Reset JWKS cache (for testing) */
export function resetJWKSCache(): void {
  jwks = null;
}
