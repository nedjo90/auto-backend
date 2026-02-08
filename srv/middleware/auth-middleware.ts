import type { Request, Response, NextFunction } from "express";
import { validateToken, JwtValidationError } from "../lib/jwt-validator";

export interface UserContext {
  id?: string;
  azureAdB2cId: string;
  email?: string;
  roles: string[];
}

/**
 * RFC 7807 problem details response for auth errors.
 */
function sendUnauthorized(res: Response, detail: string) {
  res.status(401).json({
    type: "https://httpstatuses.com/401",
    title: "Unauthorized",
    status: 401,
    detail,
  });
}

/**
 * Creates Express middleware that validates JWT tokens from Azure AD B2C.
 * On valid token: injects user context into req.user.
 * On invalid/missing token: returns 401 Unauthorized (RFC 7807).
 */
export function createAuthMiddleware() {
  return async (req: Request, res: Response, next: NextFunction) => {
    const authHeader = req.headers.authorization;

    if (!authHeader) {
      sendUnauthorized(res, "Missing Authorization header");
      return;
    }

    if (!authHeader.startsWith("Bearer ")) {
      sendUnauthorized(res, "Invalid Authorization header format");
      return;
    }

    const token = authHeader.slice(7);

    if (!token) {
      sendUnauthorized(res, "Empty Bearer token");
      return;
    }

    try {
      const decoded = await validateToken(token);

      // Build user context
      const userContext: UserContext = {
        azureAdB2cId: decoded.sub,
        email: decoded.email,
        roles: [],
      };

      // Query UserRole table for roles via CDS
      try {
        const cds = require("@sap/cds");
        const { User, UserRole } = cds.entities("auto");

        // Find user by azureAdB2cId
        const user = await cds.run(
          cds.ql.SELECT.one.from(User).where({ azureAdB2cId: decoded.sub }),
        );

        if (user) {
          userContext.id = user.ID;
          const roles = await cds.run(
            cds.ql.SELECT.from(UserRole).where({ user_ID: user.ID }),
          );
          userContext.roles = roles.map(
            (r: { role: string }) => r.role,
          );
        }
      } catch {
        // CDS not available or DB query failed — continue with empty roles
        // This allows the middleware to work even during testing without CDS
      }

      (req as any).user = userContext;
      next();
    } catch (error) {
      if (error instanceof JwtValidationError) {
        sendUnauthorized(res, error.message);
        return;
      }
      sendUnauthorized(res, "Authentication failed");
    }
  };
}
