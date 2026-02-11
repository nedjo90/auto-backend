import crypto from "node:crypto";
import cds from "@sap/cds";

const LOG = cds.log("signalr");

/** SignalR event types for the /admin hub. */
export type SignalREvent =
  | "kpiUpdate"
  | "newListing"
  | "newSale"
  | "newRegistration"
  | "newContact"
  | "newAlert";

/** Payload for a SignalR event. */
export interface SignalRMessage {
  event: SignalREvent;
  data: Record<string, unknown>;
}

/**
 * Azure SignalR REST API client for server-side event emission.
 * Sends messages to the /admin hub targeting all connected admin clients.
 *
 * Requires env vars:
 *   SIGNALR_CONNECTION_STRING - Azure SignalR connection string
 *   SIGNALR_HUB_NAME - Hub name (defaults to "admin")
 */
class SignalRClient {
  private connectionString: string | null = null;
  private hubName: string = "admin";
  private endpoint: string = "";
  private accessKey: string = "";

  initialize(): void {
    this.connectionString = process.env.SIGNALR_CONNECTION_STRING || "";
    this.hubName = process.env.SIGNALR_HUB_NAME || "admin";
    this.endpoint = "";
    this.accessKey = "";

    if (!this.connectionString) {
      LOG.warn("SIGNALR_CONNECTION_STRING not set - real-time updates disabled");
      return;
    }

    // Parse connection string: Endpoint=https://...;AccessKey=...;Version=1.0;
    const parts = this.connectionString.split(";").reduce(
      (acc, part) => {
        const [key, ...vals] = part.split("=");
        if (key && vals.length) acc[key.trim()] = vals.join("=");
        return acc;
      },
      {} as Record<string, string>,
    );

    this.endpoint = parts["Endpoint"] || "";
    this.accessKey = parts["AccessKey"] || "";

    if (this.endpoint && this.accessKey) {
      LOG.info(`SignalR client initialized for hub '${this.hubName}'`);
    } else {
      LOG.warn("Invalid SIGNALR_CONNECTION_STRING format - real-time updates disabled");
    }
  }

  /**
   * Send a message to all connected clients on the admin hub.
   */
  async broadcast(event: SignalREvent, data: Record<string, unknown>): Promise<void> {
    if (!this.endpoint || !this.accessKey) {
      LOG.debug(`SignalR not configured - skipping broadcast of '${event}'`);
      return;
    }

    const url = `${this.endpoint}/api/v1/hubs/${this.hubName}`;

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.generateToken()}`,
        },
        body: JSON.stringify({
          target: event,
          arguments: [data],
        }),
      });

      if (!response.ok) {
        LOG.error(`SignalR broadcast failed: ${response.status} ${response.statusText}`);
      }
    } catch (err) {
      LOG.error("SignalR broadcast error:", err);
    }
  }

  /**
   * Generate an HS256-signed JWT for Azure SignalR REST API authentication.
   * Token includes audience (hub URL) and expiration (1 hour).
   */
  private generateToken(): string {
    const now = Math.floor(Date.now() / 1000);
    const hubUrl = `${this.endpoint}/api/v1/hubs/${this.hubName}`;

    const header = this.base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
    const payload = this.base64url(JSON.stringify({ aud: hubUrl, iat: now, exp: now + 3600 }));
    const signature = this.base64url(
      crypto.createHmac("sha256", this.accessKey).update(`${header}.${payload}`).digest(),
    );

    return `${header}.${payload}.${signature}`;
  }

  private base64url(input: string | Buffer): string {
    const buf = typeof input === "string" ? Buffer.from(input) : input;
    return buf.toString("base64url");
  }

  /** Check if SignalR is configured and available. */
  isConfigured(): boolean {
    return !!(this.endpoint && this.accessKey);
  }
}

export const signalrClient = new SignalRClient();
