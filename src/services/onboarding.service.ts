import { Pool } from "pg";
import {
  DbType,
  Environment,
  ConnectionConfig,
  DiscoveredDatabase
} from "../connectors";
import { PostgresConnector } from "../connectors/postgres.connector";
import { MysqlConnector } from "../connectors/mysql.connector";
import { MssqlConnector } from "../connectors/mssql.connector";
import { OracleConnector } from "../connectors/oracle.connector";
import { encryptCredentials, DatabaseCredentials } from "./crypto.service";

export type OnboardRequest = {
  name: string;
  displayName?: string;
  dbType: DbType;
  environment: Environment;
  host: string;
  port: number;
  databaseName: string;
  username: string;
  password: string;
  application?: string;
  team?: string;
  ownerEmail?: string;
  tags?: Record<string, unknown>;
  poolMin?: number;
  poolMax?: number;
  connectionTimeoutMs?: number;
  idleTimeoutMs?: number;
  additionalOptions?: Record<string, unknown> | undefined;
};

export type OnboardResult = {
  success: boolean;
  instanceId?: string;
  message: string;
  discoveredDatabases?: DiscoveredDatabase[] | undefined;
  validationResult?: {
    connected: boolean;
    latencyMs: number;
    error?: string;
  };
};

export type UpdateRequest = {
  displayName?: string;
  application?: string;
  team?: string;
  ownerEmail?: string;
  tags?: Record<string, unknown>;
  poolMin?: number;
  poolMax?: number;
  connectionTimeoutMs?: number;
  idleTimeoutMs?: number;
};

export type CredentialUpdateRequest = {
  username: string;
  password: string;
  additionalOptions?: Record<string, unknown>;
};

export class OnboardingService {
  private readonly metricsPool: Pool;

  constructor(metricsPool: Pool) {
    this.metricsPool = metricsPool;
  }

  public async onboard(request: OnboardRequest, performedBy: string, ipAddress?: string): Promise<OnboardResult> {
    // 1. Validate connectivity first
    const validationResult = await this.validateConnectivity(request);
    
    if (!validationResult.connected) {
      return {
        success: false,
        message: `Connection validation failed: ${validationResult.error}`,
        validationResult
      };
    }

    // 2. Encrypt credentials
    const credentials: DatabaseCredentials = {
      username: request.username,
      password: request.password,
      additionalOptions: request.additionalOptions
    };
    const encrypted = encryptCredentials(credentials);

    // 3. Insert into database
    const result = await this.metricsPool.query<{ id: string }>(`
      INSERT INTO database_instances (
        name, display_name, db_type, environment,
        host, port, database_name,
        credentials_encrypted, credentials_iv, credentials_tag,
        application, team, owner_email, tags,
        pool_min, pool_max, connection_timeout_ms, idle_timeout_ms,
        status, onboarded_by
      ) VALUES (
        $1, $2, $3, $4,
        $5, $6, $7,
        $8, $9, $10,
        $11, $12, $13, $14,
        $15, $16, $17, $18,
        'active', $19
      )
      RETURNING id
    `, [
      request.name,
      request.displayName ?? null,
      request.dbType,
      request.environment,
      request.host,
      request.port,
      request.databaseName,
      encrypted.encrypted,
      encrypted.iv,
      encrypted.tag,
      request.application ?? null,
      request.team ?? null,
      request.ownerEmail ?? null,
      JSON.stringify(request.tags ?? {}),
      request.poolMin ?? 1,
      request.poolMax ?? 10,
      request.connectionTimeoutMs ?? 30000,
      request.idleTimeoutMs ?? 600000,
      performedBy
    ]);

    const instanceId = result.rows[0]?.id;

    if (!instanceId) {
      return {
        success: false,
        message: "Failed to create database instance record"
      };
    }

    // 4. Log audit
    await this.logAudit(instanceId, request.name, "onboard", performedBy, null, {
      dbType: request.dbType,
      environment: request.environment,
      host: request.host,
      port: request.port
    }, ipAddress);

    // 5. Auto-discover databases for multi-DB engines (PG, MySQL, MSSQL)
    let discoveredDatabases: DiscoveredDatabase[] | undefined;
    if (request.dbType !== "oracle") {
      try {
        discoveredDatabases = await this.discoverAndStoreDatabases(instanceId, request);
      } catch {
        // Non-fatal: discovery failure shouldn't block onboarding
      }
    }

    return {
      success: true,
      instanceId,
      message: `Database instance "${request.name}" onboarded successfully`,
      discoveredDatabases,
      validationResult
    };
  }

  public async updateInstance(
    instanceId: string,
    updates: UpdateRequest,
    performedBy: string,
    ipAddress?: string
  ): Promise<{ success: boolean; message: string }> {
    // Get current state for audit
    const current = await this.metricsPool.query(`SELECT * FROM database_instances WHERE id = $1`, [instanceId]);
    
    if (current.rows.length === 0) {
      return { success: false, message: "Instance not found" };
    }

    const setClauses: string[] = ["updated_at = NOW()", "updated_by = $2"];
    const params: unknown[] = [instanceId, performedBy];
    let paramIndex = 3;

    if (updates.displayName !== undefined) {
      setClauses.push(`display_name = $${paramIndex++}`);
      params.push(updates.displayName);
    }
    if (updates.application !== undefined) {
      setClauses.push(`application = $${paramIndex++}`);
      params.push(updates.application);
    }
    if (updates.team !== undefined) {
      setClauses.push(`team = $${paramIndex++}`);
      params.push(updates.team);
    }
    if (updates.ownerEmail !== undefined) {
      setClauses.push(`owner_email = $${paramIndex++}`);
      params.push(updates.ownerEmail);
    }
    if (updates.tags !== undefined) {
      setClauses.push(`tags = $${paramIndex++}`);
      params.push(JSON.stringify(updates.tags));
    }
    if (updates.poolMin !== undefined) {
      setClauses.push(`pool_min = $${paramIndex++}`);
      params.push(updates.poolMin);
    }
    if (updates.poolMax !== undefined) {
      setClauses.push(`pool_max = $${paramIndex++}`);
      params.push(updates.poolMax);
    }
    if (updates.connectionTimeoutMs !== undefined) {
      setClauses.push(`connection_timeout_ms = $${paramIndex++}`);
      params.push(updates.connectionTimeoutMs);
    }
    if (updates.idleTimeoutMs !== undefined) {
      setClauses.push(`idle_timeout_ms = $${paramIndex++}`);
      params.push(updates.idleTimeoutMs);
    }

    await this.metricsPool.query(
      `UPDATE database_instances SET ${setClauses.join(", ")} WHERE id = $1`,
      params
    );

    await this.logAudit(
      instanceId,
      current.rows[0].name,
      "update",
      performedBy,
      current.rows[0],
      updates,
      ipAddress
    );

    return { success: true, message: "Instance updated successfully" };
  }

  public async updateCredentials(
    instanceId: string,
    credentials: CredentialUpdateRequest,
    performedBy: string,
    ipAddress?: string
  ): Promise<{ success: boolean; message: string }> {
    // Get instance info
    const instance = await this.metricsPool.query(
      `SELECT name, db_type, host, port, database_name FROM database_instances WHERE id = $1`,
      [instanceId]
    );

    if (instance.rows.length === 0) {
      return { success: false, message: "Instance not found" };
    }

    const row = instance.rows[0];

    // Validate new credentials
    const validation = await this.validateConnectivity({
      name: row.name,
      dbType: row.db_type,
      environment: "development", // doesn't matter for validation
      host: row.host,
      port: row.port,
      databaseName: row.database_name,
      username: credentials.username,
      password: credentials.password,
      additionalOptions: credentials.additionalOptions
    });

    if (!validation.connected) {
      return {
        success: false,
        message: `Credential validation failed: ${validation.error}`
      };
    }

    // Encrypt and update
    const credData: DatabaseCredentials = {
      username: credentials.username,
      password: credentials.password,
      additionalOptions: credentials.additionalOptions
    };
    const encrypted = encryptCredentials(credData);

    await this.metricsPool.query(`
      UPDATE database_instances
      SET 
        credentials_encrypted = $1,
        credentials_iv = $2,
        credentials_tag = $3,
        updated_at = NOW(),
        updated_by = $4
      WHERE id = $5
    `, [encrypted.encrypted, encrypted.iv, encrypted.tag, performedBy, instanceId]);

    await this.logAudit(instanceId, row.name, "credential_update", performedBy, null, null, ipAddress);

    return { success: true, message: "Credentials updated successfully" };
  }

  public async deactivate(
    instanceId: string,
    performedBy: string,
    ipAddress?: string
  ): Promise<{ success: boolean; message: string }> {
    const instance = await this.metricsPool.query(
      `SELECT name, status FROM database_instances WHERE id = $1`,
      [instanceId]
    );

    if (instance.rows.length === 0) {
      return { success: false, message: "Instance not found" };
    }

    await this.metricsPool.query(`
      UPDATE database_instances
      SET status = 'inactive', deactivated_at = NOW(), updated_by = $1, updated_at = NOW()
      WHERE id = $2
    `, [performedBy, instanceId]);

    await this.logAudit(instanceId, instance.rows[0].name, "deactivate", performedBy, { status: instance.rows[0].status }, { status: "inactive" }, ipAddress);

    return { success: true, message: "Instance deactivated" };
  }

  public async reactivate(
    instanceId: string,
    performedBy: string,
    ipAddress?: string
  ): Promise<{ success: boolean; message: string }> {
    const instance = await this.metricsPool.query(
      `SELECT name, status FROM database_instances WHERE id = $1`,
      [instanceId]
    );

    if (instance.rows.length === 0) {
      return { success: false, message: "Instance not found" };
    }

    await this.metricsPool.query(`
      UPDATE database_instances
      SET status = 'active', deactivated_at = NULL, updated_by = $1, updated_at = NOW()
      WHERE id = $2
    `, [performedBy, instanceId]);

    await this.logAudit(instanceId, instance.rows[0].name, "reactivate", performedBy, { status: instance.rows[0].status }, { status: "active" }, ipAddress);

    return { success: true, message: "Instance reactivated" };
  }

  public async delete(
    instanceId: string,
    performedBy: string,
    ipAddress?: string
  ): Promise<{ success: boolean; message: string }> {
    const instance = await this.metricsPool.query(
      `SELECT name FROM database_instances WHERE id = $1`,
      [instanceId]
    );

    if (instance.rows.length === 0) {
      return { success: false, message: "Instance not found" };
    }

    // Log before delete (since FK is SET NULL)
    await this.logAudit(instanceId, instance.rows[0].name, "delete", performedBy, null, null, ipAddress);

    await this.metricsPool.query(`DELETE FROM database_instances WHERE id = $1`, [instanceId]);

    return { success: true, message: "Instance deleted permanently" };
  }

  public async listInstances(filters?: {
    environment?: Environment | undefined;
    dbType?: DbType | undefined;
    status?: string | undefined;
    application?: string | undefined;
    team?: string | undefined;
  }): Promise<unknown[]> {
    let query = `
      SELECT 
        id, name, display_name, db_type, environment, host, port, database_name,
        application, team, owner_email, tags,
        pool_min, pool_max, status,
        last_health_check, last_health_status, consecutive_failures,
        onboarded_by, onboarded_at, updated_by, updated_at
      FROM database_instances
      WHERE 1=1
    `;

    const params: unknown[] = [];
    let paramIndex = 1;

    if (filters?.environment) {
      query += ` AND environment = $${paramIndex++}`;
      params.push(filters.environment);
    }
    if (filters?.dbType) {
      query += ` AND db_type = $${paramIndex++}`;
      params.push(filters.dbType);
    }
    if (filters?.status) {
      query += ` AND status = $${paramIndex++}`;
      params.push(filters.status);
    }
    if (filters?.application) {
      query += ` AND application = $${paramIndex++}`;
      params.push(filters.application);
    }
    if (filters?.team) {
      query += ` AND team = $${paramIndex++}`;
      params.push(filters.team);
    }

    query += " ORDER BY environment, name";

    const result = await this.metricsPool.query(query, params);
    return result.rows;
  }

  /** Discover databases on an instance and upsert them into instance_databases. */
  private async discoverAndStoreDatabases(
    instanceId: string,
    request: Pick<OnboardRequest, "dbType" | "host" | "port" | "databaseName" | "username" | "password" | "additionalOptions">
  ): Promise<DiscoveredDatabase[]> {
    const config: ConnectionConfig = {
      host: request.host,
      port: request.port,
      database: request.databaseName,
      username: request.username,
      password: request.password,
      connectionTimeoutMs: 10000,
      additionalOptions: request.additionalOptions
    };

    let connector: ReturnType<typeof PostgresConnector.fromConnectionConfig> |
                    ReturnType<typeof MysqlConnector.fromConnectionConfig> |
                    ReturnType<typeof MssqlConnector.fromConnectionConfig>;

    switch (request.dbType) {
      case "postgres":
        connector = PostgresConnector.fromConnectionConfig(config);
        break;
      case "mysql":
        connector = MysqlConnector.fromConnectionConfig(config);
        break;
      case "mssql":
        connector = MssqlConnector.fromConnectionConfig(config);
        break;
      default:
        return [];
    }

    try {
      await connector.connect();
      const databases = await connector.listDatabases();
      await connector.disconnect();

      // Upsert into instance_databases
      for (const db of databases) {
        await this.metricsPool.query(`
          INSERT INTO instance_databases (instance_id, database_name, size_bytes, is_system)
          VALUES ($1, $2, $3, $4)
          ON CONFLICT (instance_id, database_name)
          DO UPDATE SET size_bytes = EXCLUDED.size_bytes, last_seen_at = NOW()
        `, [instanceId, db.name, db.sizeBytes, db.isSystem]);
      }

      return databases;
    } catch {
      return [];
    }
  }

  /** Re-discover databases for an existing instance. Called from the refresh endpoint. */
  public async refreshDatabases(instanceId: string): Promise<{
    success: boolean;
    databases: DiscoveredDatabase[];
    message: string;
  }> {
    // Get instance connection details
    const result = await this.metricsPool.query<{
      db_type: DbType;
      host: string;
      port: number;
      database_name: string;
      credentials_encrypted: Buffer;
      credentials_iv: Buffer;
      credentials_tag: Buffer;
    }>(`
      SELECT db_type, host, port, database_name,
             credentials_encrypted, credentials_iv, credentials_tag
      FROM database_instances WHERE id = $1
    `, [instanceId]);

    if (result.rows.length === 0) {
      return { success: false, databases: [], message: "Instance not found" };
    }

    const row = result.rows[0]!;

    if (row.db_type === "oracle") {
      return { success: true, databases: [], message: "Oracle instances do not support multi-database discovery" };
    }

    // Decrypt credentials
    const { decryptCredentials } = await import("./crypto.service");
    const credentials = decryptCredentials({
      encrypted: row.credentials_encrypted,
      iv: row.credentials_iv,
      tag: row.credentials_tag
    });

    const databases = await this.discoverAndStoreDatabases(instanceId, {
      dbType: row.db_type,
      host: row.host,
      port: row.port,
      databaseName: row.database_name,
      username: credentials.username,
      password: credentials.password,
      additionalOptions: credentials.additionalOptions
    });

    return {
      success: true,
      databases,
      message: `Discovered ${databases.length} database(s)`
    };
  }

  /** Get stored discovered databases for an instance. */
  public async getDiscoveredDatabases(instanceId: string): Promise<{
    name: string;
    sizeBytes: number | null;
    isSystem: boolean;
    discoveredAt: string;
    lastSeenAt: string;
  }[]> {
    const result = await this.metricsPool.query<{
      database_name: string;
      size_bytes: string | null;
      is_system: boolean;
      discovered_at: Date;
      last_seen_at: Date;
    }>(`
      SELECT database_name, size_bytes, is_system, discovered_at, last_seen_at
      FROM instance_databases
      WHERE instance_id = $1
      ORDER BY is_system ASC, database_name ASC
    `, [instanceId]);

    return result.rows.map((r) => ({
      name: r.database_name,
      sizeBytes: r.size_bytes !== null ? Number(r.size_bytes) : null,
      isSystem: r.is_system,
      discoveredAt: r.discovered_at.toISOString(),
      lastSeenAt: r.last_seen_at.toISOString(),
    }));
  }

  private async validateConnectivity(request: OnboardRequest): Promise<{
    connected: boolean;
    latencyMs: number;
    error?: string;
  }> {
    const config: ConnectionConfig = {
      host: request.host,
      port: request.port,
      database: request.databaseName,
      username: request.username,
      password: request.password,
      connectionTimeoutMs: 10000, // Use shorter timeout for validation
      additionalOptions: request.additionalOptions
    };

    let connector;
    switch (request.dbType) {
      case "postgres":
        connector = PostgresConnector.fromConnectionConfig(config);
        break;
      case "mysql":
        connector = MysqlConnector.fromConnectionConfig(config);
        break;
      case "mssql":
        connector = MssqlConnector.fromConnectionConfig(config);
        break;
      case "oracle":
        connector = OracleConnector.fromConnectionConfig(config);
        break;
      default:
        return { connected: false, latencyMs: 0, error: `Unsupported database type: ${request.dbType}` };
    }

    const started = Date.now();
    try {
      await connector.connect();
      const latencyMs = Date.now() - started;
      await connector.disconnect();
      return { connected: true, latencyMs };
    } catch (error) {
      return {
        connected: false,
        latencyMs: Date.now() - started,
        error: error instanceof Error ? error.message : "Unknown error"
      };
    }
  }

  private async logAudit(
    instanceId: string,
    instanceName: string,
    action: string,
    performedBy: string,
    previousState: unknown,
    newState: unknown,
    ipAddress?: string
  ): Promise<void> {
    await this.metricsPool.query(`
      INSERT INTO onboarding_audit (instance_id, instance_name, action, performed_by, previous_state, new_state, ip_address)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
    `, [
      instanceId,
      instanceName,
      action,
      performedBy,
      previousState ? JSON.stringify(previousState) : null,
      newState ? JSON.stringify(newState) : null,
      ipAddress ?? null
    ]);
  }
}
