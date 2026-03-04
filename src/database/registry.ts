import { Pool } from "pg";
import {
  DatabaseConnector,
  DbType,
  Environment,
  HealthCheckResult,
  ConnectionConfig
} from "../connectors";
import { PostgresConnector } from "../connectors/postgres.connector";
import { MysqlConnector } from "../connectors/mysql.connector";
import { MssqlConnector } from "../connectors/mssql.connector";
import { OracleConnector } from "../connectors/oracle.connector";
import { decryptCredentials, EncryptedData, DatabaseCredentials } from "../services/crypto.service";

export type DatabaseInstance = {
  id: string;
  name: string;
  displayName: string | null;
  dbType: DbType;
  environment: Environment;
  host: string;
  port: number;
  databaseName: string;
  application: string | null;
  team: string | null;
  ownerEmail: string | null;
  tags: Record<string, unknown>;
  poolMin: number;
  poolMax: number;
  connectionTimeoutMs: number;
  idleTimeoutMs: number;
  status: "pending" | "active" | "inactive" | "failed";
  lastHealthCheck: Date | null;
  lastHealthStatus: string | null;
  consecutiveFailures: number;
};

export type InstanceHealthResult = {
  instanceId: string;
  name: string;
  dbType: DbType;
  environment: Environment;
  health: HealthCheckResult;
};

export type RegistryHealthSummary = {
  overall: "up" | "degraded" | "down";
  totalInstances: number;
  activeInstances: number;
  upCount: number;
  downCount: number;
  byEnvironment: Record<Environment, { up: number; down: number; total: number }>;
  instances: InstanceHealthResult[];
  checkedAt: string;
};

type InstanceRow = {
  id: string;
  name: string;
  display_name: string | null;
  db_type: DbType;
  environment: Environment;
  host: string;
  port: number;
  database_name: string;
  credentials_encrypted: Buffer;
  credentials_iv: Buffer;
  credentials_tag: Buffer;
  application: string | null;
  team: string | null;
  owner_email: string | null;
  tags: Record<string, unknown> | null;
  pool_min: number;
  pool_max: number;
  connection_timeout_ms: number;
  idle_timeout_ms: number;
  status: "pending" | "active" | "inactive" | "failed";
  last_health_check: Date | null;
  last_health_status: string | null;
  consecutive_failures: number;
};

export class DatabaseRegistry {
  private readonly metricsPool: Pool;
  private connectors: Map<string, DatabaseConnector> = new Map();
  private instances: Map<string, DatabaseInstance> = new Map();

  constructor(metricsPool: Pool) {
    this.metricsPool = metricsPool;
  }

  public async loadInstances(environment?: Environment): Promise<void> {
    let query = `
      SELECT 
        id, name, display_name, db_type, environment, host, port, database_name,
        credentials_encrypted, credentials_iv, credentials_tag,
        application, team, owner_email, tags,
        pool_min, pool_max, connection_timeout_ms, idle_timeout_ms,
        status, last_health_check, last_health_status, consecutive_failures
      FROM database_instances
      WHERE status = 'active'
    `;
    
    const params: unknown[] = [];
    if (environment) {
      query += " AND environment = $1";
      params.push(environment);
    }

    const result = await this.metricsPool.query<InstanceRow>(query, params);

    for (const row of result.rows) {
      const instance = this.rowToInstance(row);
      this.instances.set(instance.id, instance);

      // Create connector with decrypted credentials
      const credentials = this.decryptInstanceCredentials(row);
      const connector = this.createConnector(instance, credentials);
      this.connectors.set(instance.id, connector);
    }
  }

  public async connectAll(): Promise<{ succeeded: string[]; failed: Array<{ id: string; error: string }> }> {
    const succeeded: string[] = [];
    const failed: Array<{ id: string; error: string }> = [];

    const promises = Array.from(this.connectors.entries()).map(async ([id, connector]) => {
      try {
        await connector.connect();
        succeeded.push(id);
      } catch (error) {
        failed.push({
          id,
          error: error instanceof Error ? error.message : "Unknown error"
        });
      }
    });

    await Promise.all(promises);
    return { succeeded, failed };
  }

  public async disconnectAll(): Promise<void> {
    const promises = Array.from(this.connectors.values()).map((c) => c.disconnect());
    await Promise.all(promises);
  }

  public getConnector<T extends DatabaseConnector>(instanceId: string): T | undefined {
    return this.connectors.get(instanceId) as T | undefined;
  }

  public getInstance(instanceId: string): DatabaseInstance | undefined {
    return this.instances.get(instanceId);
  }

  public getInstancesByEnvironment(environment: Environment): DatabaseInstance[] {
    return Array.from(this.instances.values()).filter((i) => i.environment === environment);
  }

  public getInstancesByType(dbType: DbType): DatabaseInstance[] {
    return Array.from(this.instances.values()).filter((i) => i.dbType === dbType);
  }

  public getAllInstances(): DatabaseInstance[] {
    return Array.from(this.instances.values());
  }

  public async healthCheck(instanceId: string): Promise<InstanceHealthResult | null> {
    const connector = this.connectors.get(instanceId);
    const instance = this.instances.get(instanceId);

    if (!connector || !instance) {
      return null;
    }

    const health = await connector.healthCheck();

    // Update health status in database
    await this.updateHealthStatus(instanceId, health);

    return {
      instanceId,
      name: instance.name,
      dbType: instance.dbType,
      environment: instance.environment,
      health
    };
  }

  public async healthSummary(environment?: Environment): Promise<RegistryHealthSummary> {
    const targetInstances = environment
      ? this.getInstancesByEnvironment(environment)
      : this.getAllInstances();

    const results: InstanceHealthResult[] = [];
    const byEnv: Record<Environment, { up: number; down: number; total: number }> = {
      production: { up: 0, down: 0, total: 0 },
      staging: { up: 0, down: 0, total: 0 },
      development: { up: 0, down: 0, total: 0 },
      dr: { up: 0, down: 0, total: 0 }
    };

    const checks = targetInstances.map(async (instance) => {
      const result = await this.healthCheck(instance.id);
      if (result) {
        results.push(result);
        byEnv[instance.environment].total++;
        if (result.health.status === "up") {
          byEnv[instance.environment].up++;
        } else {
          byEnv[instance.environment].down++;
        }
      }
    });

    await Promise.all(checks);

    const upCount = results.filter((r) => r.health.status === "up").length;
    const downCount = results.length - upCount;

    let overall: "up" | "degraded" | "down";
    if (results.length === 0 || upCount === 0) {
      overall = "down";
    } else if (upCount === results.length) {
      overall = "up";
    } else {
      overall = "degraded";
    }

    return {
      overall,
      totalInstances: this.instances.size,
      activeInstances: targetInstances.length,
      upCount,
      downCount,
      byEnvironment: byEnv,
      instances: results,
      checkedAt: new Date().toISOString()
    };
  }

  private rowToInstance(row: InstanceRow): DatabaseInstance {
    return {
      id: row.id,
      name: row.name,
      displayName: row.display_name,
      dbType: row.db_type,
      environment: row.environment,
      host: row.host,
      port: row.port,
      databaseName: row.database_name,
      application: row.application,
      team: row.team,
      ownerEmail: row.owner_email,
      tags: row.tags ?? {},
      poolMin: row.pool_min,
      poolMax: row.pool_max,
      connectionTimeoutMs: row.connection_timeout_ms,
      idleTimeoutMs: row.idle_timeout_ms,
      status: row.status,
      lastHealthCheck: row.last_health_check,
      lastHealthStatus: row.last_health_status,
      consecutiveFailures: row.consecutive_failures
    };
  }

  private decryptInstanceCredentials(row: InstanceRow): DatabaseCredentials {
    const encrypted: EncryptedData = {
      encrypted: row.credentials_encrypted,
      iv: row.credentials_iv,
      tag: row.credentials_tag
    };

    return decryptCredentials(encrypted);
  }

  private createConnector(instance: DatabaseInstance, credentials: DatabaseCredentials): DatabaseConnector {
    const config: ConnectionConfig = {
      host: instance.host,
      port: instance.port,
      database: instance.databaseName,
      username: credentials.username,
      password: credentials.password,
      poolMin: instance.poolMin,
      poolMax: instance.poolMax,
      connectionTimeoutMs: instance.connectionTimeoutMs,
      idleTimeoutMs: instance.idleTimeoutMs,
      additionalOptions: credentials.additionalOptions
    };

    switch (instance.dbType) {
      case "postgres":
        return PostgresConnector.fromConnectionConfig(config, instance.id);
      case "mysql":
        return MysqlConnector.fromConnectionConfig(config, instance.id);
      case "mssql":
        return MssqlConnector.fromConnectionConfig(config, instance.id);
      case "oracle":
        return OracleConnector.fromConnectionConfig(config, instance.id);
      default:
        throw new Error(`Unsupported database type: ${instance.dbType}`);
    }
  }

  private async updateHealthStatus(instanceId: string, health: HealthCheckResult): Promise<void> {
    const instance = this.instances.get(instanceId);
    if (!instance) return;

    const newFailures = health.status === "down"
      ? instance.consecutiveFailures + 1
      : 0;

    await this.metricsPool.query(`
      UPDATE database_instances
      SET 
        last_health_check = NOW(),
        last_health_status = $1,
        consecutive_failures = $2,
        updated_at = NOW()
      WHERE id = $3
    `, [health.status, newFailures, instanceId]);

    // Update local cache
    instance.lastHealthCheck = new Date();
    instance.lastHealthStatus = health.status;
    instance.consecutiveFailures = newFailures;
  }
}
