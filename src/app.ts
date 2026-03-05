import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import pg from "pg";
import { DatabaseRegistry } from "./database";
import { OnboardingService } from "./services/onboarding.service";
import { createDatabaseRoutes } from "./routes/database.routes";
import { Environment } from "./connectors";

dotenv.config();

const app = express();
const PORT = process.env.PORT ?? 3000;

app.use(cors());
app.use(express.json());

let metricsPool: pg.Pool;
let registry: DatabaseRegistry;
let onboardingService: OnboardingService;

// Basic app health
app.get("/health", async (_req, res) => {
  try {
    // Check metrics DB connection
    await metricsPool.query("SELECT 1");
    res.json({ status: "up", checkedAt: new Date().toISOString() });
  } catch (error) {
    res.status(503).json({
      status: "down",
      error: error instanceof Error ? error.message : "Unknown error",
      checkedAt: new Date().toISOString()
    });
  }
});

// Registry health summary (all managed databases)
app.get("/health/databases", async (req, res) => {
  try {
    const environment = req.query.environment as Environment | undefined;
    const summary = await registry.healthSummary(environment);
    const statusCode = summary.overall === "up" ? 200 : summary.overall === "degraded" ? 207 : 503;
    res.status(statusCode).json(summary);
  } catch (error) {
    res.status(500).json({
      overall: "down",
      error: error instanceof Error ? error.message : "Unknown error",
      checkedAt: new Date().toISOString()
    });
  }
});

async function main(): Promise<void> {
  // 1. Connect to internal metrics database
  metricsPool = new pg.Pool({
    host: process.env.PG_HOST ?? "localhost",
    port: Number(process.env.PG_PORT) || 5433,
    user: process.env.PG_USER ?? "metrics_admin",
    password: process.env.PG_PASSWORD ?? "metrics_admin_change_me",
    database: process.env.PG_DATABASE ?? "internal_metrics",
    max: 10
  });

  try {
    await metricsPool.query("SELECT 1");
    console.log("Connected to internal metrics database");
  } catch (error) {
    console.error("Failed to connect to metrics database:", error);
    process.exit(1);
  }

  // 2. Initialize services
  onboardingService = new OnboardingService(metricsPool);
  registry = new DatabaseRegistry(metricsPool);

  // 3. Load active database instances from inventory
  try {
    await registry.loadInstances();
    const instances = registry.getAllInstances();
    console.log(`Loaded ${instances.length} database instances from inventory`);

    // 4. Connect to all loaded instances
    if (instances.length > 0) {
      const result = await registry.connectAll();
      console.log(`Connected: ${result.succeeded.length}, Failed: ${result.failed.length}`);
      if (result.failed.length > 0) {
        console.warn("Failed connections:", result.failed);
      }
    }
  } catch (error) {
    console.warn("No database instances loaded (inventory may be empty):", error);
  }

  // 5. Mount routes
  app.use("/api/databases", createDatabaseRoutes(onboardingService, registry, metricsPool));

  // 6. Start server
  app.listen(PORT, () => {
    console.log(`Auto-DBA Agent running on port ${PORT}`);
    console.log("API endpoints:");
    console.log("  GET  /health                     - App health");
    console.log("  GET  /health/databases           - All managed DB health");
    console.log("  GET  /api/databases              - List instances");
    console.log("  POST /api/databases              - Onboard new instance");
    console.log("  GET  /api/databases/:id          - Get instance");
    console.log("  PATCH /api/databases/:id         - Update instance");
    console.log("  PUT  /api/databases/:id/credentials - Update credentials");
    console.log("  POST /api/databases/:id/deactivate  - Deactivate");
    console.log("  POST /api/databases/:id/reactivate  - Reactivate");
    console.log("  DELETE /api/databases/:id        - Delete instance");
    console.log("  GET  /api/databases/:id/health   - Instance health");
    console.log("  GET  /api/databases/:id/predictions - Tablespace predictions");
    console.log("  POST /api/databases/:id/predictions/snapshot - Record snapshot");
  });
}

// Graceful shutdown
process.on("SIGTERM", async () => {
  console.log("Shutting down...");
  await registry?.disconnectAll();
  await metricsPool?.end();
  process.exit(0);
});

main().catch(console.error);

export default app;
