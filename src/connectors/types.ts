export type HealthStatus = "up" | "down";

export type HealthCheckResult = {
  status: HealthStatus;
  latencyMs: number;
  details?: string;
};

export type DbType = "postgres" | "mysql" | "mssql" | "oracle";
export type Environment = "production" | "staging" | "development" | "dr";
export type InstanceStatus = "pending" | "active" | "inactive" | "failed";

export type ConnectionConfig = {
  host: string;
  port: number;
  database: string;
  username: string;
  password: string;
  poolMin?: number | undefined;
  poolMax?: number | undefined;
  connectionTimeoutMs?: number | undefined;
  idleTimeoutMs?: number | undefined;
  additionalOptions?: Record<string, unknown> | undefined;
};

export interface DiscoveredDatabase {
  name: string;
  sizeBytes: number | null;
  isSystem: boolean;
}

export interface DatabaseConnector {
  readonly name: string;
  readonly instanceId?: string | undefined;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  healthCheck(): Promise<HealthCheckResult>;
  isConnected(): boolean;
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  /** Discover all databases on this instance (PG/MySQL/MSSQL only). */
  listDatabases?(): Promise<DiscoveredDatabase[]>;
}

export function toPort(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return fallback;
  }

  return parsed;
}
