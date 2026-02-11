import cds from "@sap/cds";
import { configCache } from "./config-cache";
import { sendAlertNotification } from "./alert-notifier";

const LOG = cds.log("alert-evaluator");

interface ConfigAlertRow {
  ID: string;
  name: string;
  metric: string;
  thresholdValue: number;
  comparisonOperator: string;
  notificationMethod: string;
  severityLevel: string;
  enabled: boolean;
  cooldownMinutes: number;
  lastTriggeredAt: string | null;
}

export interface MetricResult {
  metric: string;
  value: number;
}

/**
 * Evaluate a single metric and return its current value.
 * Returns null if the metric cannot be evaluated (entity missing, etc.).
 */
export async function evaluateMetric(metric: string): Promise<MetricResult | null> {
  try {
    const entities = cds.entities("auto");

    switch (metric) {
      case "margin_per_listing": {
        // Compute from ConfigParameter (listing price) minus average API costs
        const priceParam = configCache.get<{ value: string }>(
          "ConfigParameter",
          "listing.price.default",
        );
        const listingPrice = priceParam ? parseFloat(priceParam.value) || 0 : 0;

        const ApiCallLog = entities["ApiCallLog"];
        if (!ApiCallLog) return { metric, value: listingPrice };

        // Average cost per listing (last 30 days)
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        const logs = (await cds.run(
          SELECT.from(ApiCallLog).where({
            timestamp: { ">=": thirtyDaysAgo.toISOString() },
          }),
        )) as { cost: number }[];

        const totalCost = (logs || []).reduce((sum, log) => sum + (Number(log.cost) || 0), 0);
        const avgCost = logs?.length ? totalCost / logs.length : 0;

        return { metric, value: Number((listingPrice - avgCost).toFixed(4)) };
      }

      case "api_availability": {
        const ApiCallLog = entities["ApiCallLog"];
        if (!ApiCallLog) return { metric, value: 100 };

        const oneDayAgo = new Date();
        oneDayAgo.setDate(oneDayAgo.getDate() - 1);
        const logs = (await cds.run(
          SELECT.from(ApiCallLog).where({
            timestamp: { ">=": oneDayAgo.toISOString() },
          }),
        )) as { httpStatus: number }[];

        if (!logs?.length) return { metric, value: 100 };

        const successCount = logs.filter(
          (log) => log.httpStatus >= 200 && log.httpStatus < 300,
        ).length;
        return { metric, value: Number(((successCount / logs.length) * 100).toFixed(2)) };
      }

      case "daily_registrations": {
        const User = entities["User"];
        if (!User) return { metric, value: 0 };

        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const rows = (await cds.run(
          SELECT.from(User).where({ createdAt: { ">=": today.toISOString() } }),
        )) as unknown[];

        return { metric, value: rows?.length || 0 };
      }

      case "daily_listings": {
        // Listing entity may not exist yet
        const Listing = entities["Listing"];
        if (!Listing) return { metric, value: 0 };

        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const rows = (await cds.run(
          SELECT.from(Listing).where({ createdAt: { ">=": today.toISOString() } }),
        )) as unknown[];

        return { metric, value: rows?.length || 0 };
      }

      case "daily_revenue": {
        // Payment entity may not exist yet
        const Payment = entities["Payment"];
        if (!Payment) return { metric, value: 0 };

        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const rows = (await cds.run(
          SELECT.from(Payment).where({ createdAt: { ">=": today.toISOString() } }),
        )) as { amount: number }[];

        const total = (rows || []).reduce((sum, row) => sum + (Number(row.amount) || 0), 0);
        return { metric, value: Number(total.toFixed(2)) };
      }

      default:
        LOG.warn(`Unknown alert metric: ${metric}`);
        return null;
    }
  } catch (err) {
    LOG.error(`Failed to evaluate metric '${metric}':`, err);
    return null;
  }
}

/**
 * Compare a current value against a threshold using the specified operator.
 */
export function isThresholdBreached(
  currentValue: number,
  thresholdValue: number,
  operator: string,
): boolean {
  switch (operator) {
    case "above":
      return currentValue > thresholdValue;
    case "below":
      return currentValue < thresholdValue;
    case "equals":
      return currentValue === thresholdValue;
    default:
      return false;
  }
}

/**
 * Check if a cooldown is still active (alert was recently triggered).
 */
export function isCooldownActive(lastTriggeredAt: string | null, cooldownMinutes: number): boolean {
  if (!lastTriggeredAt) return false;
  const lastTriggered = new Date(lastTriggeredAt).getTime();
  const cooldownMs = cooldownMinutes * 60 * 1000;
  return Date.now() - lastTriggered < cooldownMs;
}

/**
 * Create an AlertEvent record in the database.
 */
export async function createAlertEvent(
  alert: ConfigAlertRow,
  currentValue: number,
): Promise<string | null> {
  try {
    const entities = cds.entities("auto");
    const AlertEvent = entities["AlertEvent"];
    if (!AlertEvent) {
      LOG.warn("AlertEvent entity not found, cannot create alert event");
      return null;
    }

    const id = cds.utils.uuid();
    const operatorLabel =
      alert.comparisonOperator === "above"
        ? "above"
        : alert.comparisonOperator === "below"
          ? "below"
          : "equal to";

    const message = `Alert "${alert.name}": ${alert.metric} is ${currentValue} (${operatorLabel} threshold ${alert.thresholdValue})`;

    await cds.run(
      INSERT.into(AlertEvent).entries({
        ID: id,
        alertId: alert.ID,
        metric: alert.metric,
        currentValue,
        thresholdValue: alert.thresholdValue,
        severity: alert.severityLevel,
        message,
        acknowledged: false,
        createdAt: new Date().toISOString(),
      }),
    );

    // Update lastTriggeredAt on the alert
    const ConfigAlert = entities["ConfigAlert"];
    if (ConfigAlert) {
      await cds.run(
        UPDATE(ConfigAlert)
          .set({ lastTriggeredAt: new Date().toISOString() })
          .where({ ID: alert.ID }),
      );
      await configCache.refreshTable("ConfigAlert");
    }

    LOG.info(`Alert triggered: ${message}`);
    return id;
  } catch (err) {
    LOG.error("Failed to create alert event:", err);
    return null;
  }
}

/**
 * Run a single evaluation cycle: check all enabled alerts.
 * Returns the list of triggered alert event IDs.
 */
export async function runEvaluationCycle(): Promise<string[]> {
  const alerts = configCache.getAll<ConfigAlertRow>("ConfigAlert");
  const triggeredIds: string[] = [];

  for (const alert of alerts) {
    if (!alert.enabled) continue;
    if (isCooldownActive(alert.lastTriggeredAt, alert.cooldownMinutes)) continue;

    const result = await evaluateMetric(alert.metric);
    if (!result) continue;

    if (isThresholdBreached(result.value, Number(alert.thresholdValue), alert.comparisonOperator)) {
      const eventId = await createAlertEvent(alert, result.value);
      if (eventId) {
        triggeredIds.push(eventId);
        // Send notification
        const operatorLabel =
          alert.comparisonOperator === "above"
            ? "above"
            : alert.comparisonOperator === "below"
              ? "below"
              : "equal to";
        await sendAlertNotification({
          alertEventId: eventId,
          alertName: alert.name,
          metric: alert.metric,
          currentValue: result.value,
          thresholdValue: Number(alert.thresholdValue),
          severity: alert.severityLevel,
          message: `Alert "${alert.name}": ${alert.metric} is ${result.value} (${operatorLabel} threshold ${alert.thresholdValue})`,
          notificationMethod: alert.notificationMethod,
        });
      }
    }
  }

  return triggeredIds;
}

let evaluationInterval: ReturnType<typeof setInterval> | null = null;

/**
 * Start periodic alert evaluation.
 * @param intervalMs Evaluation interval in milliseconds (default: 5 minutes)
 */
export function startPeriodicEvaluation(intervalMs = 5 * 60 * 1000): void {
  if (evaluationInterval) {
    LOG.warn("Alert evaluation already running");
    return;
  }

  evaluationInterval = setInterval(async () => {
    try {
      if (!configCache.isReady()) return;
      const triggered = await runEvaluationCycle();
      if (triggered.length > 0) {
        LOG.info(`Evaluation cycle triggered ${triggered.length} alert(s)`);
      }
    } catch (err) {
      LOG.error("Alert evaluation cycle failed:", err);
    }
  }, intervalMs);

  LOG.info(`Alert evaluation started (interval: ${intervalMs}ms)`);
}

/**
 * Stop periodic alert evaluation.
 */
export function stopPeriodicEvaluation(): void {
  if (evaluationInterval) {
    clearInterval(evaluationInterval);
    evaluationInterval = null;
    LOG.info("Alert evaluation stopped");
  }
}
