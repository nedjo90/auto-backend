import cds from "@sap/cds";
import { createAuthMiddleware } from "./middleware/auth-middleware";

cds.on("bootstrap", (app) => {
  // Register JWT auth middleware for all /api/ routes
  app.use("/api/", createAuthMiddleware());
});

export default cds.server;
