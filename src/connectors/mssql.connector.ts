import sql = require("mssql");
import { ConnectionConfig, DatabaseConnector, HealthCheckResult, toPort } from "./types";

type ConnectionPool = sql.ConnectionPool;

type MssqlConfig = {
  server: string;
  port: number;
  user: string;
  password: string;
  database: string;
  encrypt: boolean;
  trustServerCertificate: boolean;
  connectionTimeout?: number | undefined;
};

export class MssqlConnector implements DatabaseConnector {
  public readonly name = "mssql";
  public readonly instanceId: string | undefined;
  private readonly config: MssqlConfig;
  private pool: ConnectionPool | null = null;

  constructor(config?: Partial<MssqlConfig>, instanceId?: string) {
    this.instanceId = instanceId;
    this.config = {
      server: config?.server ?? process.env.MSSQL_HOST ?? "localhost",
      port: config?.port ?? toPort(process.env.MSSQL_PORT, 1433),
      user: config?.user ?? process.env.MSSQL_USER ?? "sa",
      password: config?.password ?? process.env.MSSQL_PASSWORD ?? "YourStrong!Passw0rd",
      database: config?.database ?? process.env.MSSQL_DATABASE ?? "master",
      encrypt: config?.encrypt ?? (process.env.MSSQL_ENCRYPT === "true"),
      trustServerCertificate: config?.trustServerCertificate ?? (process.env.MSSQL_TRUST_CERT !== "false"),
      connectionTimeout: config?.connectionTimeout
    };
  }

  public static fromConnectionConfig(config: ConnectionConfig, instanceId?: string): MssqlConnector {
    const additionalOpts = config.additionalOptions ?? {};
    return new MssqlConnector({
      server: config.host,
      port: config.port,
      user: config.username,
      password: config.password,
      database: config.database,
      encrypt: additionalOpts.encrypt as boolean ?? false,
      trustServerCertificate: additionalOpts.trustServerCertificate as boolean ?? true,
      connectionTimeout: config.connectionTimeoutMs
    }, instanceId);
  }

  public async connect(): Promise<void> {
    if (this.pool) {
      return;
    }

    this.pool = new sql.ConnectionPool({
      server: this.config.server,
      port: this.config.port,
      user: this.config.user,
      password: this.config.password,
      database: this.config.database,
      options: {
        encrypt: this.config.encrypt,
        trustServerCertificate: this.config.trustServerCertificate
      }
    });

    await this.pool.connect();
    await this.pool.request().query("SELECT 1");
  }

  public async disconnect(): Promise<void> {
    if (!this.pool) {
      return;
    }

    await this.pool.close();
    this.pool = null;
  }

  public async healthCheck(): Promise<HealthCheckResult> {
    const started = Date.now();

    try {
      if (!this.pool) {
        await this.connect();
      }

      await this.pool?.request().query("SELECT 1");

      return {
        status: "up",
        latencyMs: Date.now() - started
      };
    } catch (error) {
      return {
        status: "down",
        latencyMs: Date.now() - started,
        details: error instanceof Error ? error.message : "Unknown error"
      };
    }
  }

  public isConnected(): boolean {
    return this.pool !== null;
  }

  public getPool(): ConnectionPool {
    if (!this.pool) {
      throw new Error("MSSQL pool not initialized. Call connect() first.");
    }

    return this.pool;
  }

  public async query<T = Record<string, unknown>>(sql: string, _params?: unknown[]): Promise<T[]> {
    if (!this.pool) {
      await this.connect();
    }

    const result = await this.pool!.request().query(sql);
    return result.recordset as T[];
  }
}

export function createMssqlConnector(config?: Partial<MssqlConfig>, instanceId?: string): MssqlConnector {
  return new MssqlConnector(config, instanceId);
}
