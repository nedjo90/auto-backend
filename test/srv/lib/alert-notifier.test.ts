/* eslint-disable @typescript-eslint/no-explicit-any */

const mockBroadcast = jest.fn().mockResolvedValue(undefined);
const mockLog = { warn: jest.fn(), info: jest.fn(), error: jest.fn(), debug: jest.fn() };

jest.mock("@sap/cds", () => ({
  __esModule: true,
  default: {
    log: jest.fn(() => mockLog),
  },
}));

jest.mock("../../../srv/lib/signalr-client", () => ({
  signalrClient: {
    broadcast: (...args: any[]) => mockBroadcast(...args),
    initialize: jest.fn(),
    isConfigured: jest.fn().mockReturnValue(true),
  },
}));

import { sendAlertNotification, type AlertNotification } from "../../../srv/lib/alert-notifier";

describe("AlertNotifier", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  const baseNotification: AlertNotification = {
    alertEventId: "evt-1",
    alertName: "Low Margin",
    metric: "margin_per_listing",
    currentValue: 5,
    thresholdValue: 8,
    severity: "critical",
    message: "Margin below threshold",
    notificationMethod: "both",
  };

  describe("sendAlertNotification", () => {
    it("should send in-app notification via SignalR for in_app method", async () => {
      await sendAlertNotification({ ...baseNotification, notificationMethod: "in_app" });
      expect(mockBroadcast).toHaveBeenCalledTimes(1);
      expect(mockBroadcast).toHaveBeenCalledWith(
        "newAlert",
        expect.objectContaining({
          alertEventId: "evt-1",
          alertName: "Low Margin",
          severity: "critical",
        }),
      );
    });

    it("should log email notification for email method", async () => {
      await sendAlertNotification({ ...baseNotification, notificationMethod: "email" });
      expect(mockBroadcast).not.toHaveBeenCalled();
      expect(mockLog.info).toHaveBeenCalledWith(
        expect.stringContaining("Email alert notification queued"),
      );
    });

    it("should send both in-app and email for both method", async () => {
      await sendAlertNotification({ ...baseNotification, notificationMethod: "both" });
      expect(mockBroadcast).toHaveBeenCalledTimes(1);
      expect(mockLog.info).toHaveBeenCalledWith(
        expect.stringContaining("Email alert notification queued"),
      );
    });

    it("should not throw on SignalR broadcast failure", async () => {
      mockBroadcast.mockRejectedValueOnce(new Error("SignalR error"));
      await expect(
        sendAlertNotification({ ...baseNotification, notificationMethod: "in_app" }),
      ).resolves.not.toThrow();
    });

    it("should include timestamp in SignalR payload", async () => {
      await sendAlertNotification({ ...baseNotification, notificationMethod: "in_app" });
      expect(mockBroadcast).toHaveBeenCalledWith(
        "newAlert",
        expect.objectContaining({ timestamp: expect.any(String) }),
      );
    });

    it("should include metric and threshold in SignalR payload", async () => {
      await sendAlertNotification({ ...baseNotification, notificationMethod: "in_app" });
      expect(mockBroadcast).toHaveBeenCalledWith(
        "newAlert",
        expect.objectContaining({
          metric: "margin_per_listing",
          currentValue: 5,
          thresholdValue: 8,
        }),
      );
    });
  });
});
