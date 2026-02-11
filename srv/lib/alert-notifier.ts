import cds from "@sap/cds";
import { signalrClient } from "./signalr-client";

const LOG = cds.log("alert-notifier");

export interface AlertNotification {
  alertEventId: string;
  alertName: string;
  metric: string;
  currentValue: number;
  thresholdValue: number;
  severity: string;
  message: string;
  notificationMethod: string;
}

/**
 * Send an alert notification via the configured method(s).
 */
export async function sendAlertNotification(notification: AlertNotification): Promise<void> {
  const { notificationMethod } = notification;

  try {
    if (notificationMethod === "in_app" || notificationMethod === "both") {
      await sendInAppNotification(notification);
    }
    if (notificationMethod === "email" || notificationMethod === "both") {
      await sendEmailNotification(notification);
    }
  } catch (err) {
    LOG.error("Failed to send alert notification:", err);
  }
}

/**
 * Send an in-app notification via SignalR to the /admin hub.
 */
async function sendInAppNotification(notification: AlertNotification): Promise<void> {
  try {
    await signalrClient.broadcast("newAlert", {
      alertEventId: notification.alertEventId,
      alertName: notification.alertName,
      metric: notification.metric,
      currentValue: notification.currentValue,
      thresholdValue: notification.thresholdValue,
      severity: notification.severity,
      message: notification.message,
      timestamp: new Date().toISOString(),
    });
    LOG.info(`In-app alert sent: ${notification.alertName}`);
  } catch (err) {
    LOG.error("Failed to send in-app alert notification:", err);
  }
}

/**
 * Send an email notification for an alert.
 * Placeholder: logs the intention; actual email sending requires
 * Azure Communication Services or similar integration.
 */
async function sendEmailNotification(notification: AlertNotification): Promise<void> {
  // Email delivery requires Azure Communication Services configuration.
  // For now, log the intent and details for future integration.
  LOG.info(
    `Email alert notification queued: [${notification.severity.toUpperCase()}] ${notification.alertName} - ${notification.message}`,
  );
}
