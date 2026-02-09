/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-require-imports */

jest.mock("@sap/cds", () => {
  const mockLog = { warn: jest.fn(), info: jest.fn(), error: jest.fn(), debug: jest.fn() };
  return {
    __esModule: true,
    default: {
      log: jest.fn(() => mockLog),
    },
  };
});

const { signalrClient } = require("../../../srv/lib/signalr-client");

describe("SignalRClient", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...originalEnv };
    global.fetch = jest.fn();
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it("should warn when SIGNALR_CONNECTION_STRING is not set", () => {
    delete process.env.SIGNALR_CONNECTION_STRING;
    signalrClient.initialize();
    expect(signalrClient.isConfigured()).toBe(false);
  });

  it("should initialize with valid connection string", () => {
    process.env.SIGNALR_CONNECTION_STRING =
      "Endpoint=https://test.service.signalr.net;AccessKey=testkey123;Version=1.0";
    signalrClient.initialize();
    expect(signalrClient.isConfigured()).toBe(true);
  });

  it("should broadcast to SignalR REST API", async () => {
    process.env.SIGNALR_CONNECTION_STRING =
      "Endpoint=https://test.service.signalr.net;AccessKey=testkey123;Version=1.0";
    signalrClient.initialize();

    (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: true });

    await signalrClient.broadcast("kpiUpdate", { metric: "visitors", value: 100 });

    expect(global.fetch).toHaveBeenCalledWith(
      "https://test.service.signalr.net/api/v1/hubs/admin",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "Content-Type": "application/json",
        }),
      }),
    );
  });

  it("should skip broadcast when not configured", async () => {
    process.env.SIGNALR_CONNECTION_STRING = "";
    signalrClient.initialize();

    await signalrClient.broadcast("kpiUpdate", { metric: "visitors" });

    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("should handle broadcast errors gracefully", async () => {
    process.env.SIGNALR_CONNECTION_STRING =
      "Endpoint=https://test.service.signalr.net;AccessKey=testkey123;Version=1.0";
    signalrClient.initialize();

    (global.fetch as jest.Mock).mockRejectedValueOnce(new Error("Network error"));

    // Should not throw
    await signalrClient.broadcast("kpiUpdate", { metric: "visitors" });
  });

  it("should handle non-ok response", async () => {
    process.env.SIGNALR_CONNECTION_STRING =
      "Endpoint=https://test.service.signalr.net;AccessKey=testkey123;Version=1.0";
    signalrClient.initialize();

    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: false,
      status: 401,
      statusText: "Unauthorized",
    });

    // Should not throw
    await signalrClient.broadcast("kpiUpdate", { metric: "visitors" });
  });

  it("should use custom hub name from env", () => {
    process.env.SIGNALR_CONNECTION_STRING =
      "Endpoint=https://test.service.signalr.net;AccessKey=testkey123;Version=1.0";
    process.env.SIGNALR_HUB_NAME = "custom-hub";
    signalrClient.initialize();

    expect(signalrClient.isConfigured()).toBe(true);
  });
});
