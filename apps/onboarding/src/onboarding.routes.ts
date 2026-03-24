import { Router, Request, Response } from "express";
import { OnboardingService, OnboardRequest, UpdateRequest, CredentialUpdateRequest } from "@auto-dba-agent/shared";

export function createOnboardingRoutes(onboardingService: OnboardingService): Router {
  const router = Router();

  // List all database instances with optional filters
  router.get("/", async (req: Request, res: Response) => {
    try {
      const filters = req.query || {};
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
      const instanceId = req.params.id as string;
      const instances = await onboardingService.listInstances();
      const instance = instances.find((i: any) => i.id === instanceId);
      if (!instance) {
        res.status(404).json({ error: "Instance not found" });
        return;
      }
      const databases = await onboardingService.getDiscoveredDatabases(instanceId);
      res.json({ ...(instance as object), databases });
    } catch (error) {
      res.status(500).json({
        error: error instanceof Error ? error.message : "Failed to get instance"
      });
    }
  });

  // List discovered databases for an instance
  router.get("/:id/databases", async (req: Request, res: Response) => {
    try {
      const instanceId = req.params.id as string;
      const databases = await onboardingService.getDiscoveredDatabases(instanceId);
      res.json({ instanceId, databases, count: databases.length });
    } catch (error) {
      res.status(500).json({
        error: error instanceof Error ? error.message : "Failed to list databases"
      });
    }
  });

  // Refresh / re-discover databases for an instance
  router.post("/:id/databases/refresh", async (req: Request, res: Response) => {
    try {
      const instanceId = req.params.id as string;
      const result = await onboardingService.refreshDatabases(instanceId);
      if (result.success) {
        res.json(result);
      } else {
        res.status(404).json(result);
      }
    } catch (error) {
      res.status(500).json({
        error: error instanceof Error ? error.message : "Failed to refresh databases"
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

  return router;
}
