import type { Request, Response, NextFunction } from "express";
import type { IUserContext, RoleCode } from "@auto/shared";
import { ROLES, expandRolesWithHierarchy } from "@auto/shared";
import { validateToken, JwtValidationError } from "../lib/jwt-validator";

// Re-export for consumers
export type { IUserContext };

// L6: Express type augmentation for req.user
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: IUserContext;
    }
  }
}

/**
 * RFC 7807 problem details response for auth errors.
 * M8: Includes required Content-Type header.
 */
function sendUnauthorized(res: Response, detail: string, instance?: string) {
  res
    .setHeader("Content-Type", "application/problem+json")
    .status(401)
    .json({
      type: "https://httpstatuses.com/401",
      title: "Unauthorized",
      status: 401,
      detail,
      ...(instance ? { instance } : {}),
    });
}

/**
 * Check if Azure AD B2C is configured.
 * When not configured in non-production, we allow CDS mock auth to pass through.
 */
function isAzureConfigured(): boolean {
  return !!(
    process.env.AZURE_AD_B2C_TENANT_NAME &&
    process.env.AZURE_AD_B2C_CLIENT_ID &&
    process.env.AZURE_AD_B2C_TENANT_ID
  );
}

/**
 * Creates Express middleware that validates JWT tokens from Azure AD B2C.
 * On valid token: injects user context into req.user.
 * On invalid/missing token: returns 401 Unauthorized (RFC 7807).
 *
 * In development without Azure AD B2C configuration, falls back to CDS mock basic auth.
 */
export function createAuthMiddleware() {
  const azureConfigured = isAzureConfigured();

  return async (req: Request, res: Response, next: NextFunction) => {
    const authHeader = req.headers.authorization;

    // Dev mode fallback: when Azure is not configured, pass through to CDS mock auth
    // Skip in test mode to preserve JWT validation test coverage
    if (
      !azureConfigured &&
      process.env.NODE_ENV !== "production" &&
      process.env.NODE_ENV !== "test"
    ) {
      next();
      return;
    }

    if (!authHeader) {
      sendUnauthorized(res, "Missing Authorization header", req.originalUrl);
      return;
    }

    if (!authHeader.startsWith("Bearer ")) {
      sendUnauthorized(res, "Invalid Authorization header format", req.originalUrl);
      return;
    }

    const token = authHeader.slice(7);

    if (!token) {
      sendUnauthorized(res, "Empty Bearer token", req.originalUrl);
      return;
    }

    try {
      const decoded = await validateToken(token);

      // Build user context
      const userContext: IUserContext = {
        azureAdB2cId: decoded.sub,
        email: decoded.email,
        roles: [],
      };

      // Query UserRole table for roles via CDS (resolves role codes through Role association)
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const cds = require("@sap/cds");
        const { User, UserRole, Role } = cds.entities("auto");

        // Find user by azureAdB2cId
        const user = await cds.run(
          cds.ql.SELECT.one.from(User).where({ azureAdB2cId: decoded.sub }),
        );

        if (user) {
          userContext.id = user.ID;
          const userRoles = await cds.run(cds.ql.SELECT.from(UserRole).where({ user_ID: user.ID }));
          if (userRoles.length > 0) {
            const roleIds = userRoles.map((ur: { role_ID: string }) => ur.role_ID);
            const roles = await cds.run(cds.ql.SELECT.from(Role).where({ ID: roleIds }));
            const roleCodes = roles.map((r: { code: string }) => r.code);
            const validRoles = roleCodes.filter((code: string): code is RoleCode =>
              (ROLES as readonly string[]).includes(code),
            );
            // FR54: Expand roles with hierarchy so admin gains all lower-level capabilities
            userContext.roles = expandRolesWithHierarchy(validRoles);
          }
        }
      } catch (cdsError) {
        // H7: Log CDS errors instead of silently swallowing
        // eslint-disable-next-line no-console
        console.error("[auth-middleware] CDS role lookup failed:", cdsError);
        // In production, fail the request — roles are required for authorization
        if (process.env.NODE_ENV === "production") {
          res.setHeader("Content-Type", "application/problem+json").status(503).json({
            type: "https://httpstatuses.com/503",
            title: "Service Unavailable",
            status: 503,
            detail: "Authorization service temporarily unavailable",
          });
          return;
        }
        // In dev/test: continue with empty roles to allow middleware testing without CDS
      }

      req.user = userContext;
      next();
    } catch (error) {
      if (error instanceof JwtValidationError) {
        sendUnauthorized(res, error.message, req.originalUrl);
        return;
      }
      sendUnauthorized(res, "Authentication failed", req.originalUrl);
    }
  };
}
