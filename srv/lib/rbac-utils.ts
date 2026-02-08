/**
 * Shared RBAC utility functions.
 * Used by both rbac-handler and rbac-middleware to avoid logic duplication.
 */

/**
 * Resolves all permission codes for a user based on their roles.
 * Queries UserRole -> RolePermission -> Permission chain.
 */
export async function resolveUserPermissions(userId: string): Promise<string[]> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const cds = require("@sap/cds");
  const { UserRole, RolePermission, Permission } = cds.entities("auto");

  const userRoles = await cds.run(cds.ql.SELECT.from(UserRole).where({ user_ID: userId }));
  if (userRoles.length === 0) return [];

  const roleIds = userRoles.map((ur: { role_ID: string }) => ur.role_ID);

  const rolePermissions = await cds.run(
    cds.ql.SELECT.from(RolePermission).where({ role_ID: roleIds }),
  );
  if (rolePermissions.length === 0) return [];

  const permissionIds = [
    ...new Set(rolePermissions.map((rp: { permission_ID: string }) => rp.permission_ID)),
  ];

  const permissions = await cds.run(cds.ql.SELECT.from(Permission).where({ ID: permissionIds }));

  return permissions.map((p: { code: string }) => p.code);
}

/**
 * Extracts client IP address from request headers.
 * Works with both Express Request and CDS Request objects.
 */
export function extractIpAddress(req: unknown): string | undefined {
  const r = req as Record<string, unknown>;
  const headers = (r.headers ?? {}) as Record<string, unknown>;
  const forwarded = headers["x-forwarded-for"];
  if (typeof forwarded === "string") return forwarded.split(",")[0].trim();
  if (typeof (r as { ip?: unknown }).ip === "string") return (r as { ip: string }).ip;
  return undefined;
}
