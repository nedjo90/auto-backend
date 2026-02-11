import cds from "@sap/cds";
import { createAuthMiddleware } from "./middleware/auth-middleware";
import { configCache } from "./lib/config-cache";
import { startPeriodicEvaluation, stopPeriodicEvaluation } from "./lib/alert-evaluator";

const LOG = cds.log("server");

cds.on("bootstrap", (app) => {
  // Register JWT auth middleware for all /api/ routes
  app.use("/api/", createAuthMiddleware());
});

cds.on("served", async () => {
  // Initialize config cache after all services are served
  try {
    await configCache.refresh();
    LOG.info("Config cache initialized successfully");
    // Start periodic alert evaluation (every 5 minutes)
    startPeriodicEvaluation();
  } catch (err) {
    LOG.error("Failed to initialize config cache:", err);
  }
});

cds.on("shutdown", () => {
  stopPeriodicEvaluation();
});

export default cds.server;
