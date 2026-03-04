import pg = require("pg");
import { ConnectionConfig, DatabaseConnector, HealthCheckResult, toPort } from "./types";

type Pool = pg.Pool;

type PostgresConfig = {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  max: number;
  connectionTimeoutMillis?: number | undefined;
  idleTimeoutMillis?: number | undefined;
};

export class PostgresConnector implements DatabaseConnector {
  public readonly name = "postgres";
  public readonly instanceId: string | undefined;
  private readonly config: PostgresConfig;
  private pool: Pool | null = null;

  constructor(config?: Partial<PostgresConfig>, instanceId?: string) {
    this.instanceId = instanceId;
    this.config = {
      host: config?.host ?? process.env.PG_HOST ?? "localhost",
      port: config?.port ?? toPort(process.env.PG_PORT, 5432),
      user: config?.user ?? process.env.PG_USER ?? "postgres",
      password: config?.password ?? process.env.PG_PASSWORD ?? "postgres",
      database: config?.database ?? process.env.PG_DATABASE ?? "postgres",
      max: config?.max ?? toPort(process.env.PG_POOL_MAX, 10),
      connectionTimeoutMillis: config?.connectionTimeoutMillis,
      idleTimeoutMillis: config?.idleTimeoutMillis
    };
  }

  public static fromConnectionConfig(config: ConnectionConfig, instanceId?: string): PostgresConnector {
    return new PostgresConnector({
      host: config.host,
      port: config.port,
      user: config.username,
      password: config.password,
      database: config.database,
      max: config.poolMax ?? 10,
      connectionTimeoutMillis: config.connectionTimeoutMs,
      idleTimeoutMillis: config.idleTimeoutMs
    }, instanceId);
  }

  public async connect(): Promise<void> {
    if (this.pool) {
      return;
    }

    this.pool = new pg.Pool(this.config);
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
      throw new Error("Postgres pool not initialized. Call connect() first.");
    }

    return this.pool;
  }

  public async query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]> {
    if (!this.pool) {
      await this.connect();
    }

    const result = await this.pool!.query(sql, params);
    return result.rows as T[];
  }
}

export function createPostgresConnector(config?: Partial<PostgresConfig>, instanceId?: string): PostgresConnector {
  return new PostgresConnector(config, instanceId);
}
