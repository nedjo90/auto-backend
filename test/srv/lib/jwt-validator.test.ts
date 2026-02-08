import { validateToken, JwtValidationError } from "../../../srv/lib/jwt-validator";

// We test validateToken with a crafted setup
// In unit tests, we mock the JWKS endpoint behavior

describe("jwt-validator", () => {
  describe("validateToken", () => {
    it("should reject an empty token", async () => {
      await expect(validateToken("")).rejects.toThrow(JwtValidationError);
    });

    it("should reject a malformed token", async () => {
      await expect(validateToken("not.a.jwt")).rejects.toThrow(
        JwtValidationError,
      );
    });

    it("should reject null/undefined token", async () => {
      await expect(validateToken(null as unknown as string)).rejects.toThrow(
        JwtValidationError,
      );
    });

    it("should export JwtValidationError class", () => {
      expect(JwtValidationError).toBeDefined();
      const err = new JwtValidationError("test");
      expect(err).toBeInstanceOf(Error);
      expect(err.message).toBe("test");
    });
  });
});
