/* eslint-disable @typescript-eslint/no-explicit-any */

// Mock jose before importing jwt-validator
const mockJwtVerify = jest.fn();
const mockCreateRemoteJWKSet = jest.fn().mockReturnValue("mock-jwks");

jest.mock("jose", () => ({
  jwtVerify: mockJwtVerify,
  createRemoteJWKSet: mockCreateRemoteJWKSet,
  errors: {
    JWTExpired: class JWTExpired extends Error {
      constructor(message?: string) {
        super(message || "Token expired");
        this.name = "JWTExpired";
      }
    },
    JWTClaimValidationFailed: class JWTClaimValidationFailed extends Error {
      constructor(message?: string) {
        super(message || "Claim validation failed");
        this.name = "JWTClaimValidationFailed";
      }
    },
  },
}));

import { validateToken, JwtValidationError, resetJWKSCache } from "../../../srv/lib/jwt-validator";

const jose = jest.requireMock("jose");

describe("jwt-validator", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    resetJWKSCache();
    // Set required env vars for most tests
    process.env = {
      ...originalEnv,
      NODE_ENV: "test",
      AZURE_AD_B2C_TENANT_NAME: "test-tenant",
      AZURE_AD_B2C_CLIENT_ID: "test-client-id",
      AZURE_AD_B2C_TENANT_ID: "test-tenant-id",
      AZURE_AD_B2C_SIGN_UP_SIGN_IN_FLOW: "B2C_1_test_flow",
    };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe("JwtValidationError", () => {
    it("should export JwtValidationError class", () => {
      expect(JwtValidationError).toBeDefined();
      const err = new JwtValidationError("test");
      expect(err).toBeInstanceOf(Error);
      expect(err.message).toBe("test");
      expect(err.name).toBe("JwtValidationError");
    });
  });

  describe("validateToken", () => {
    it("should reject an empty token", async () => {
      await expect(validateToken("")).rejects.toThrow(JwtValidationError);
      await expect(validateToken("")).rejects.toThrow("Token is required");
    });

    it("should reject null/undefined token", async () => {
      await expect(validateToken(null as unknown as string)).rejects.toThrow(JwtValidationError);
    });

    // L27: getConfig() success return path
    // L34-44: getJWKS() function
    // L58-79: validateToken try block — success path
    it("should return decoded token on successful validation", async () => {
      mockJwtVerify.mockResolvedValue({
        payload: {
          sub: "user-123",
          email: "user@example.com",
          name: "Test User",
          iss: "https://test-tenant.b2clogin.com/test-tenant-id/v2.0/",
          aud: "test-client-id",
          exp: 1999999999,
          nbf: 1000000000,
          iat: 1000000000,
        },
      });

      const result = await validateToken("valid-token");

      expect(result).toEqual({
        sub: "user-123",
        email: "user@example.com",
        name: "Test User",
        iss: "https://test-tenant.b2clogin.com/test-tenant-id/v2.0/",
        aud: "test-client-id",
        exp: 1999999999,
        nbf: 1000000000,
        iat: 1000000000,
      });

      // Verify jwtVerify was called with correct parameters
      expect(mockJwtVerify).toHaveBeenCalledWith(
        "valid-token",
        "mock-jwks",
        expect.objectContaining({
          issuer: "https://test-tenant.b2clogin.com/test-tenant-id/v2.0/",
          audience: "test-client-id",
          algorithms: ["RS256"],
        }),
      );

      // Verify createRemoteJWKSet was called with the right URL
      expect(mockCreateRemoteJWKSet).toHaveBeenCalledWith(
        expect.objectContaining({
          href: "https://test-tenant.b2clogin.com/test-tenant.onmicrosoft.com/B2C_1_test_flow/discovery/v2.0/keys",
        }),
        expect.objectContaining({ cooldownDuration: 30000 }),
      );
    });

    // L66-68: payload missing subject claim
    it("should reject token missing subject claim", async () => {
      mockJwtVerify.mockResolvedValue({
        payload: {
          email: "user@example.com",
          // sub is missing
        },
      });

      await expect(validateToken("token-no-sub")).rejects.toThrow(JwtValidationError);
      await expect(validateToken("token-no-sub")).rejects.toThrow("Token missing subject claim");
    });

    // L75: aud as array (not string)
    it("should handle aud as array by setting undefined", async () => {
      mockJwtVerify.mockResolvedValue({
        payload: {
          sub: "user-456",
          aud: ["aud1", "aud2"],
        },
      });

      const result = await validateToken("token-array-aud");
      expect(result.aud).toBeUndefined();
    });

    // L80-82: re-throw JwtValidationError as-is
    it("should re-throw JwtValidationError from missing sub without wrapping", async () => {
      mockJwtVerify.mockResolvedValue({
        payload: {
          /* no sub */
        },
      });

      try {
        await validateToken("token-no-sub");
        fail("Expected JwtValidationError");
      } catch (err: any) {
        expect(err).toBeInstanceOf(JwtValidationError);
        expect(err.message).toBe("Token missing subject claim");
      }
    });

    // L84-86: JWTExpired error
    it("should throw JwtValidationError with 'Token expired' for JWTExpired error", async () => {
      mockJwtVerify.mockRejectedValue(new jose.errors.JWTExpired("jwt expired"));

      await expect(validateToken("expired-token")).rejects.toThrow(JwtValidationError);
      await expect(validateToken("expired-token")).rejects.toThrow("Token expired");
    });

    // L87-89: JWTClaimValidationFailed error
    it("should throw JwtValidationError with claim details for JWTClaimValidationFailed", async () => {
      mockJwtVerify.mockRejectedValue(new jose.errors.JWTClaimValidationFailed("aud mismatch"));

      await expect(validateToken("bad-claims-token")).rejects.toThrow(JwtValidationError);
      await expect(validateToken("bad-claims-token")).rejects.toThrow(
        "Token claim validation failed: aud mismatch",
      );
    });

    // L90-92: generic Error catch
    it("should wrap generic Error into JwtValidationError", async () => {
      mockJwtVerify.mockRejectedValue(new Error("network timeout"));

      await expect(validateToken("network-error-token")).rejects.toThrow(JwtValidationError);
      await expect(validateToken("network-error-token")).rejects.toThrow(
        "Token validation failed: network timeout",
      );
    });

    // L91: non-Error throw (e.g. a string)
    it("should handle non-Error thrown objects", async () => {
      mockJwtVerify.mockRejectedValue("some string error");

      await expect(validateToken("string-error-token")).rejects.toThrow(JwtValidationError);
      await expect(validateToken("string-error-token")).rejects.toThrow(
        "Token validation failed: Unknown error",
      );
    });
  });

  describe("getConfig", () => {
    it("should throw JwtValidationError when AZURE_AD_B2C_TENANT_NAME is missing", async () => {
      delete process.env.AZURE_AD_B2C_TENANT_NAME;

      await expect(validateToken("any-token")).rejects.toThrow(JwtValidationError);
      await expect(validateToken("any-token")).rejects.toThrow(
        "Missing required Azure AD B2C configuration",
      );
    });

    it("should throw JwtValidationError when AZURE_AD_B2C_CLIENT_ID is missing", async () => {
      delete process.env.AZURE_AD_B2C_CLIENT_ID;

      await expect(validateToken("any-token")).rejects.toThrow(
        "Missing required Azure AD B2C configuration",
      );
    });

    it("should throw JwtValidationError when AZURE_AD_B2C_TENANT_ID is missing", async () => {
      delete process.env.AZURE_AD_B2C_TENANT_ID;

      await expect(validateToken("any-token")).rejects.toThrow(
        "Missing required Azure AD B2C configuration",
      );
    });

    // L17: default policyName when env var not set
    it("should use default policy name when AZURE_AD_B2C_SIGN_UP_SIGN_IN_FLOW is not set", async () => {
      delete process.env.AZURE_AD_B2C_SIGN_UP_SIGN_IN_FLOW;
      mockJwtVerify.mockResolvedValue({
        payload: { sub: "user-789" },
      });

      await validateToken("valid-token");

      expect(mockCreateRemoteJWKSet).toHaveBeenCalledWith(
        expect.objectContaining({
          href: expect.stringContaining("B2C_1_signupsignin"),
        }),
        expect.anything(),
      );
    });
  });

  describe("getJWKS caching", () => {
    // L38-44: JWKS caching — reuse when URL hasn't changed
    it("should reuse cached JWKS when env hasn't changed", async () => {
      mockJwtVerify.mockResolvedValue({
        payload: { sub: "user-1" },
      });

      await validateToken("token-1");
      await validateToken("token-2");

      // createRemoteJWKSet should be called only once (cached)
      expect(mockCreateRemoteJWKSet).toHaveBeenCalledTimes(1);
    });

    // L38: JWKS rebuild when URL changes
    it("should rebuild JWKS when env vars change", async () => {
      mockJwtVerify.mockResolvedValue({
        payload: { sub: "user-1" },
      });

      await validateToken("token-1");

      // Change tenant name to force new URL
      process.env.AZURE_AD_B2C_TENANT_NAME = "other-tenant";
      resetJWKSCache();

      await validateToken("token-2");

      // createRemoteJWKSet called twice
      expect(mockCreateRemoteJWKSet).toHaveBeenCalledTimes(2);
    });
  });

  describe("resetJWKSCache", () => {
    // L98-100: resetJWKSCache only works in test mode
    it("should reset JWKS cache in test environment", async () => {
      mockJwtVerify.mockResolvedValue({
        payload: { sub: "user-1" },
      });

      await validateToken("token-1");
      expect(mockCreateRemoteJWKSet).toHaveBeenCalledTimes(1);

      resetJWKSCache();

      await validateToken("token-2");
      expect(mockCreateRemoteJWKSet).toHaveBeenCalledTimes(2);
    });

    // L98: no-op when NODE_ENV is not test
    it("should be a no-op when NODE_ENV is not test", async () => {
      mockJwtVerify.mockResolvedValue({
        payload: { sub: "user-1" },
      });

      await validateToken("token-1");
      expect(mockCreateRemoteJWKSet).toHaveBeenCalledTimes(1);

      process.env.NODE_ENV = "production";
      resetJWKSCache();
      process.env.NODE_ENV = "test";

      await validateToken("token-2");
      // Still 1 because the cache wasn't actually cleared
      expect(mockCreateRemoteJWKSet).toHaveBeenCalledTimes(1);
    });
  });
});
