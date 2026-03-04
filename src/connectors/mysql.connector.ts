import { createPool, Pool, PoolOptions } from "mysql2/promise";
import { ConnectionConfig, DatabaseConnector, HealthCheckResult, toPort } from "./types";

type MysqlConfig = {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  connectionLimit: number;
  connectTimeout?: number | undefined;
};

export class MysqlConnector implements DatabaseConnector {
  public readonly name = "mysql";
  public readonly instanceId: string | undefined;
  private readonly config: MysqlConfig;
  private pool: Pool | null = null;

  constructor(config?: Partial<MysqlConfig>, instanceId?: string) {
    this.instanceId = instanceId;
    this.config = {
      host: config?.host ?? process.env.MYSQL_HOST ?? "localhost",
      port: config?.port ?? toPort(process.env.MYSQL_PORT, 3306),
      user: config?.user ?? process.env.MYSQL_USER ?? "root",
      password: config?.password ?? process.env.MYSQL_PASSWORD ?? "root",
      database: config?.database ?? process.env.MYSQL_DATABASE ?? "mysql",
      connectionLimit: config?.connectionLimit ?? toPort(process.env.MYSQL_POOL_MAX, 10),
      connectTimeout: config?.connectTimeout
    };
  }

  public static fromConnectionConfig(config: ConnectionConfig, instanceId?: string): MysqlConnector {
    return new MysqlConnector({
      host: config.host,
      port: config.port,
      user: config.username,
      password: config.password,
      database: config.database,
      connectionLimit: config.poolMax ?? 10,
      connectTimeout: config.connectionTimeoutMs
    }, instanceId);
  }

  public async connect(): Promise<void> {
    if (this.pool) {
      return;
    }

    const options: PoolOptions = {
      host: this.config.host,
      port: this.config.port,
      user: this.config.user,
      password: this.config.password,
      database: this.config.database,
      connectionLimit: this.config.connectionLimit
    };

    this.pool = createPool(options);
    await this.pool.query("SELECT 1");
  }

  public async disconnect(): Promise<void> {
    if (!this.pool) {
      return;
    }

    await this.pool.end();
    this.pool = null;
  }

  public async healthCheck(): Promise<HealthCheckResult> {
    const started = Date.now();

    try {
      if (!this.pool) {
        await this.connect();
      }

      await this.pool?.query("SELECT 1");

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

  public getPool(): Pool {
    if (!this.pool) {
      throw new Error("MySQL pool not initialized. Call connect() first.");
    }

    return this.pool;
  }

  public async query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]> {
    if (!this.pool) {
      await this.connect();
    }

    const [rows] = await this.pool!.query(sql, params);
    return rows as T[];
  }
}

export function createMysqlConnector(config?: Partial<MysqlConfig>, instanceId?: string): MysqlConnector {
  return new MysqlConnector(config, instanceId);
}
