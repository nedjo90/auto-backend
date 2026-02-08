import { Client } from "@microsoft/microsoft-graph-client";
import { ClientSecretCredential } from "@azure/identity";
import { TokenCredentialAuthenticationProvider } from "@microsoft/microsoft-graph-client/authProviders/azureTokenCredentials/index.js";
import type {
  IIdentityProviderAdapter,
  CreateUserData,
} from "./interfaces/identity-provider.interface";

export class AzureAdB2cAdapter implements IIdentityProviderAdapter {
  private client: Client;
  private tenantName: string;

  constructor(
    client?: Client,
    tenantName?: string,
  ) {
    this.tenantName =
      tenantName || process.env.AZURE_AD_B2C_TENANT_NAME || "";

    if (client) {
      this.client = client;
    } else {
      const tenantId = process.env.AZURE_AD_B2C_TENANT_ID || "";
      const clientId = process.env.AZURE_AD_B2C_CLIENT_ID || "";
      const clientSecret = process.env.AZURE_AD_B2C_CLIENT_SECRET || "";

      const credential = new ClientSecretCredential(
        tenantId,
        clientId,
        clientSecret,
      );
      const authProvider = new TokenCredentialAuthenticationProvider(
        credential,
        { scopes: ["https://graph.microsoft.com/.default"] },
      );
      this.client = Client.initWithMiddleware({ authProvider });
    }
  }

  async createUser(userData: CreateUserData): Promise<string> {
    const user = await this.client.api("/users").post({
      accountEnabled: true,
      displayName: `${userData.firstName} ${userData.lastName}`,
      givenName: userData.firstName,
      surname: userData.lastName,
      identities: [
        {
          signInType: "emailAddress",
          issuer: `${this.tenantName}.onmicrosoft.com`,
          issuerAssignedId: userData.email,
        },
      ],
      passwordProfile: {
        password: userData.password,
        forceChangePasswordNextSignIn: false,
      },
    });

    return user.id;
  }

  async disableUser(externalId: string): Promise<void> {
    await this.client.api(`/users/${externalId}`).update({
      accountEnabled: false,
    });
  }

  async updateUser(
    externalId: string,
    userData: Record<string, unknown>,
  ): Promise<void> {
    await this.client.api(`/users/${externalId}`).update(userData);
  }
}
