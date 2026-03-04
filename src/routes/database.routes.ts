import { Router, Request, Response } from "express";
import { OnboardingService, OnboardRequest, UpdateRequest, CredentialUpdateRequest } from "../services/onboarding.service";
import { DatabaseRegistry } from "../database/registry";
import { DbType, Environment } from "../connectors";

type ListFilters = {
  environment?: Environment | undefined;
  dbType?: DbType | undefined;
  status?: string | undefined;
  application?: string | undefined;
  team?: string | undefined;
};

export function createDatabaseRoutes(
  onboardingService: OnboardingService,
  registry: DatabaseRegistry
): Router {
  const router = Router();

  // List all database instances with optional filters
  router.get("/", async (req: Request, res: Response) => {
    try {
      const filters: ListFilters = {};
      
      if (req.query.environment) {
        filters.environment = req.query.environment as Environment;
      }
      if (req.query.dbType) {
        filters.dbType = req.query.dbType as DbType;
      }
      if (req.query.status) {
        filters.status = req.query.status as string;
      }
      if (req.query.application) {
        filters.application = req.query.application as string;
      }
      if (req.query.team) {
        filters.team = req.query.team as string;
      }

      const instances = await onboardingService.listInstances(filters);
      res.json({ instances, count: instances.length });
    } catch (error) {
      res.status(500).json({
        error: error instanceof Error ? error.message : "Failed to list instances"
      });
    }
  });

  // Onboard a new database instance
  router.post("/", async (req: Request, res: Response) => {
    try {
      const request: OnboardRequest = req.body;
      
      // Basic validation
      if (!request.name || !request.dbType || !request.environment || 
          !request.host || !request.port || !request.databaseName ||
          !request.username || !request.password) {
        res.status(400).json({
          error: "Missing required fields: name, dbType, environment, host, port, databaseName, username, password"
        });
        return;
      }

      const performedBy = (req.headers["x-user-id"] as string | undefined) ?? "system";
      const ipAddress = req.ip ?? req.socket.remoteAddress;

      const result = await onboardingService.onboard(request, performedBy, ipAddress);

      if (result.success) {
        // Reload registry to include new instance
        await registry.loadInstances();
        res.status(201).json(result);
      } else {
        res.status(400).json(result);
      }
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : "Failed to onboard instance"
      });
    }
  });

  // Get a specific instance
  router.get("/:id", async (req: Request, res: Response) => {
    try {
      const instanceId = req.params.id;
      const instances = await onboardingService.listInstances();
      const instance = instances.find((i: unknown) => (i as { id: string }).id === instanceId);

      if (!instance) {
        res.status(404).json({ error: "Instance not found" });
        return;
      }

      res.json(instance);
    } catch (error) {
      res.status(500).json({
        error: error instanceof Error ? error.message : "Failed to get instance"
      });
    }
  });

  // Update instance metadata
  router.patch("/:id", async (req: Request, res: Response) => {
    try {
      const instanceId = req.params.id as string;
      const updates: UpdateRequest = req.body;
      const performedBy = (req.headers["x-user-id"] as string | undefined) ?? "system";
      const ipAddress = req.ip ?? req.socket.remoteAddress;

      const result = await onboardingService.updateInstance(
        instanceId,
        updates,
        performedBy,
        ipAddress
      );

      if (result.success) {
        res.json(result);
      } else {
        res.status(404).json(result);
      }
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : "Failed to update instance"
      });
    }
  });

  // Update credentials
  router.put("/:id/credentials", async (req: Request, res: Response) => {
    try {
      const instanceId = req.params.id as string;
      const credentials: CredentialUpdateRequest = req.body;
      
      if (!credentials.username || !credentials.password) {
        res.status(400).json({ error: "Missing required fields: username, password" });
        return;
      }

      const performedBy = (req.headers["x-user-id"] as string | undefined) ?? "system";
      const ipAddress = req.ip ?? req.socket.remoteAddress;

      const result = await onboardingService.updateCredentials(
        instanceId,
        credentials,
        performedBy,
        ipAddress
      );

      if (result.success) {
        // Reload registry with new credentials
        await registry.loadInstances();
        res.json(result);
      } else {
        res.status(400).json(result);
      }
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : "Failed to update credentials"
      });
    }
  });

  // Deactivate instance
  router.post("/:id/deactivate", async (req: Request, res: Response) => {
    try {
      const instanceId = req.params.id as string;
      const performedBy = (req.headers["x-user-id"] as string | undefined) ?? "system";
      const ipAddress = req.ip ?? req.socket.remoteAddress;

      const result = await onboardingService.deactivate(instanceId, performedBy, ipAddress);

      if (result.success) {
        await registry.loadInstances();
        res.json(result);
      } else {
        res.status(404).json(result);
      }
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : "Failed to deactivate instance"
      });
    }
  });

  // Reactivate instance
  router.post("/:id/reactivate", async (req: Request, res: Response) => {
    try {
      const instanceId = req.params.id as string;
      const performedBy = (req.headers["x-user-id"] as string | undefined) ?? "system";
      const ipAddress = req.ip ?? req.socket.remoteAddress;

      const result = await onboardingService.reactivate(instanceId, performedBy, ipAddress);

      if (result.success) {
        await registry.loadInstances();
        res.json(result);
      } else {
        res.status(404).json(result);
      }
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : "Failed to reactivate instance"
      });
    }
  });

  // Delete instance permanently
  router.delete("/:id", async (req: Request, res: Response) => {
    try {
      const instanceId = req.params.id as string;
      const performedBy = (req.headers["x-user-id"] as string | undefined) ?? "system";
      const ipAddress = req.ip ?? req.socket.remoteAddress;

      const result = await onboardingService.delete(instanceId, performedBy, ipAddress);

      if (result.success) {
        await registry.loadInstances();
        res.json(result);
      } else {
        res.status(404).json(result);
      }
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : "Failed to delete instance"
      });
    }
  });

  // Health check for specific instance
  router.get("/:id/health", async (req: Request, res: Response) => {
    try {
      const instanceId = req.params.id as string;
      const result = await registry.healthCheck(instanceId);

      if (!result) {
        res.status(404).json({ error: "Instance not found or not loaded in registry" });
        return;
      }

      const statusCode = result.health.status === "up" ? 200 : 503;
      res.status(statusCode).json(result);
    } catch (error) {
      res.status(500).json({
        error: error instanceof Error ? error.message : "Failed to check health"
      });
    }
  });

  return router;
}
