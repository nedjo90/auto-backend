import type { Request, Response, NextFunction } from "express";
import type { IUserContext } from "@auto/shared";
import { logAudit } from "../lib/audit-logger";
import { resolveUserPermissions, extractIpAddress } from "../lib/rbac-utils";

/**
 * RFC 7807 problem details response for 403 Forbidden.
 */
function sendForbidden(res: Response, detail: string, instance?: string) {
  res
    .setHeader("Content-Type", "application/problem+json")
    .status(403)
    .json({
      type: "https://httpstatuses.com/403",
      title: "Forbidden",
      status: 403,
      detail,
      ...(instance ? { instance } : {}),
    });
}

/**
 * Express middleware factory that checks if the user has the required permission.
 * Must be used after auth-middleware (requires req.user to be set).
 */
export function requirePermission(permissionCode: string) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const user = req.user as IUserContext | undefined;

    if (!user || !user.id) {
      sendForbidden(res, "Authentication required", req.originalUrl);
      return;
    }

    try {
      const permissions = await resolveUserPermissions(user.id);

      if (!permissions.includes(permissionCode)) {
        // Log unauthorized attempt
        await logAudit({
          userId: user.id,
          action: "permission.denied",
          resource: req.originalUrl,
          details: `Required permission '${permissionCode}' not found. User roles: [${user.roles.join(", ")}]`,
          ipAddress: extractIpAddress(req),
        });

        sendForbidden(
          res,
          `Insufficient permissions. Required: ${permissionCode}`,
          req.originalUrl,
        );
        return;
      }

      next();
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error("[rbac-middleware] Permission check failed:", error);
      res.setHeader("Content-Type", "application/problem+json").status(500).json({
        type: "https://httpstatuses.com/500",
        title: "Internal Server Error",
        status: 500,
        detail: "Permission check failed",
      });
    }
  };
}

/**
 * Utility function for checking permissions in CDS handlers.
 * Returns true if user has the required permission.
 */
export async function hasPermission(userId: string, permissionCode: string): Promise<boolean> {
  const permissions = await resolveUserPermissions(userId);
  return permissions.includes(permissionCode);
}
