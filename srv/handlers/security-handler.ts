import cds from "@sap/cds";
import { Client } from "@microsoft/microsoft-graph-client";
import { ClientSecretCredential } from "@azure/identity";

const SELLER_ROLES = ["private_seller", "professional_seller"];

export class SecurityHandler {
  /**
   * Handles toggle2FA action. Restricted to Seller role.
   * Calls Azure AD B2C Graph API to update MFA policy for the user.
   */
  async handleToggle2FA(req: any, cdsInstance?: any) {
    const userId = req.user?.id;
    if (!userId) {
      return req.reject(401, "Authentication required");
    }

    // RBAC check: only sellers can toggle 2FA
    const userRoles: string[] = req.user?.attr?.roles || [];
    const isSeller = userRoles.some((role: string) =>
      SELLER_ROLES.includes(role),
    );

    if (!isSeller) {
      return req.reject(403, "Only seller accounts can manage 2FA");
    }

    const { enable } = req.data;
    const db = cdsInstance || cds;

    try {
      // Get user's Azure AD B2C ID
      const { User } = db.entities("auto");
      const user = await db.run(
        cds.ql.SELECT.one.from(User).where({ ID: userId }),
      );

      if (!user?.azureAdB2cId) {
        return req.reject(404, "User not found or missing Azure AD B2C ID");
      }

      // Call Azure AD B2C Graph API to update MFA
      const graphClient = this.getGraphClient();
      const mfaRequirements = enable
        ? [{ perUserMfaState: "enforced" }]
        : [];

      await graphClient
        .api(`/users/${user.azureAdB2cId}`)
        .patch({
          strongAuthenticationRequirements: mfaRequirements,
        });

      return {
        success: true,
        mfaStatus: enable ? "enabled" : "disabled",
      };
    } catch (error) {
      if (error && typeof error === "object" && "code" in error) {
        throw error; // CDS errors (reject calls)
      }
      return req.reject(
        502,
        "Failed to update MFA settings in Azure AD B2C",
      );
    }
  }

  private getGraphClient(): Client {
    const credential = new ClientSecretCredential(
      process.env.AZURE_AD_B2C_TENANT_ID || "",
      process.env.AZURE_AD_B2C_CLIENT_ID || "",
      process.env.AZURE_AD_B2C_CLIENT_SECRET || "",
    );

    return Client.init({
      authProvider: async (done) => {
        try {
          const token = await credential.getToken(
            "https://graph.microsoft.com/.default",
          );
          done(null, token.token);
        } catch (error) {
          done(error as Error, null);
        }
      },
    });
  }
}

export default function (srv: any) {
  const handler = new SecurityHandler();

  srv.on("toggle2FA", async (req: any) => {
    return handler.handleToggle2FA(req);
  });
}
