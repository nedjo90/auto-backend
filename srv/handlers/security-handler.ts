import cds from "@sap/cds";
import { Client } from "@microsoft/microsoft-graph-client";
import { ClientSecretCredential } from "@azure/identity";

const SELLER_ROLES = ["private_seller", "professional_seller"];

let graphClient: Client | null = null;

export class SecurityHandler {
  /**
   * Handles toggle2FA action. Restricted to Seller role.
   * Calls Azure AD B2C Graph API to update MFA policy for the user.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async handleToggle2FA(req: any, cdsInstance?: any) {
    const userId = req.user?.id;
    if (!userId) {
      req.reject(401, "Authentication required");
      return;
    }

    // RBAC check: only sellers can toggle 2FA (H1: fix role path, H5: fix req.reject pattern)
    const userRoles: string[] = req.user?.roles || [];
    const isSeller = userRoles.some((role: string) => SELLER_ROLES.includes(role));

    if (!isSeller) {
      req.reject(403, "Only seller accounts can manage 2FA");
      return;
    }

    const { enable } = req.data;
    const db = cdsInstance || cds;

    try {
      // Get user's Azure AD B2C ID
      const { User } = db.entities("auto");
      const user = await db.run(cds.ql.SELECT.one.from(User).where({ ID: userId }));

      if (!user?.azureAdB2cId) {
        req.reject(404, "User not found or missing Azure AD B2C ID");
        return;
      }

      // Call Azure AD B2C Graph API to update MFA
      const client = this.getGraphClient();
      const mfaRequirements = enable ? [{ perUserMfaState: "enforced" }] : [];

      await client.api(`/users/${user.azureAdB2cId}`).patch({
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
      req.reject(502, "Failed to update MFA settings in Azure AD B2C");
    }
  }

  // M9: Lazy singleton Graph client
  private getGraphClient(): Client {
    if (graphClient) return graphClient;

    const tenantId = process.env.AZURE_AD_B2C_TENANT_ID || "";
    const clientId = process.env.AZURE_AD_B2C_GRAPH_CLIENT_ID || "";
    const clientSecret = process.env.AZURE_AD_B2C_CLIENT_SECRET || "";

    const credential = new ClientSecretCredential(tenantId, clientId, clientSecret);

    graphClient = Client.init({
      authProvider: async (done) => {
        try {
          const token = await credential.getToken("https://graph.microsoft.com/.default");
          done(null, token.token);
        } catch (error) {
          done(error as Error, null);
        }
      },
    });

    return graphClient;
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export default function (srv: any) {
  const handler = new SecurityHandler();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  srv.on("toggle2FA", async (req: any) => {
    return handler.handleToggle2FA(req);
  });
}
