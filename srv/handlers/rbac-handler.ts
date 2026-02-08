import cds from "@sap/cds";
import { logAudit } from "../lib/audit-logger";
import { resolveUserPermissions, extractIpAddress } from "../lib/rbac-utils";

/** CDS Request with enriched user context from auth-middleware */
interface CdsRequestUser {
  user?: { id?: string; roles?: string[] };
}

function getCallerRoles(req: cds.Request): string[] {
  return (req as unknown as CdsRequestUser).user?.roles || [];
}

function getCallerId(req: cds.Request): string {
  return (req as unknown as CdsRequestUser).user?.id || "unknown";
}

export default class RbacService extends cds.ApplicationService {
  async init() {
    this.on("assignRole", this.assignRole);
    this.on("removeRole", this.removeRole);
    this.on("getUserPermissions", this.getUserPermissions);
    await super.init();
  }

  private assignRole = async (req: cds.Request) => {
    const { userId, roleCode } = req.data;
    const { Role, UserRole, User } = cds.entities("auto");

    // Admin-only check
    if (!getCallerRoles(req).includes("administrator")) {
      return req.reject(403, "Only administrators can assign roles");
    }

    // Validate target user exists
    const targetUser = await cds.run(SELECT.one.from(User).where({ ID: userId }));
    if (!targetUser) {
      return req.reject(404, "User not found");
    }

    // Validate role exists
    const role = await cds.run(SELECT.one.from(Role).where({ code: roleCode }));
    if (!role) {
      return req.reject(400, `Invalid role code: ${roleCode}`);
    }

    // Check if user already has this role
    const existing = await cds.run(
      SELECT.one.from(UserRole).where({ user_ID: userId, role_ID: role.ID }),
    );
    if (existing) {
      return { success: false, message: "User already has this role" };
    }

    // Create role assignment
    await cds.run(
      INSERT.into(UserRole).entries({
        ID: cds.utils.uuid(),
        user_ID: userId,
        role_ID: role.ID,
        assignedAt: new Date().toISOString(),
        assignedBy_ID: getCallerId(req) === "unknown" ? null : getCallerId(req),
      }),
    );

    // Audit trail
    await logAudit({
      userId: getCallerId(req),
      action: "role.assign",
      resource: `user/${userId}`,
      details: `Assigned role '${roleCode}' to user ${userId}`,
      ipAddress: extractIpAddress(req),
    });

    return { success: true, message: `Role '${roleCode}' assigned` };
  };

  private removeRole = async (req: cds.Request) => {
    const { userId, roleCode } = req.data;
    const { Role, UserRole, User } = cds.entities("auto");

    // Admin-only check
    if (!getCallerRoles(req).includes("administrator")) {
      return req.reject(403, "Only administrators can remove roles");
    }

    // Validate target user exists
    const targetUser = await cds.run(SELECT.one.from(User).where({ ID: userId }));
    if (!targetUser) {
      return req.reject(404, "User not found");
    }

    // Validate role exists
    const role = await cds.run(SELECT.one.from(Role).where({ code: roleCode }));
    if (!role) {
      return req.reject(400, `Invalid role code: ${roleCode}`);
    }

    // Find the assignment
    const assignment = await cds.run(
      SELECT.one.from(UserRole).where({ user_ID: userId, role_ID: role.ID }),
    );
    if (!assignment) {
      return { success: false, message: "User does not have this role" };
    }

    // Delete first, then verify remaining count (atomic within CDS transaction)
    await cds.run(DELETE.from(UserRole).where({ ID: assignment.ID }));

    // Verify user still has at least one role after deletion
    const remaining = await cds.run(SELECT.from(UserRole).where({ user_ID: userId }));
    if (remaining.length === 0) {
      // req.reject triggers transaction rollback
      return req.reject(400, "Cannot remove user's last role");
    }

    // Audit trail
    await logAudit({
      userId: getCallerId(req),
      action: "role.remove",
      resource: `user/${userId}`,
      details: `Removed role '${roleCode}' from user ${userId}`,
      ipAddress: extractIpAddress(req),
    });

    return { success: true, message: `Role '${roleCode}' removed` };
  };

  private getUserPermissions = async (req: cds.Request) => {
    const { userId } = req.data;
    return resolveUserPermissions(userId);
  };
}
