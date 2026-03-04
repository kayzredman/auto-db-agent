// ── Shared types mirroring the backend API responses ──

export type DbType = "postgres" | "mysql" | "mssql" | "oracle";
export type OracleRole = "default" | "sysdba" | "sysoper" | "sysasm" | "sysbackup" | "sysdg" | "syskm" | "sysrac";
export type Environment = "production" | "staging" | "development" | "dr";
export type InstanceStatus = "active" | "inactive" | "decommissioned";

export interface DatabaseInstance {
  id: string;
  name: string;
  display_name: string | null;
  db_type: DbType;
  environment: Environment;
  host: string;
  port: number;
  database_name: string;
  application: string | null;
  team: string | null;
  owner_email: string | null;
  tags: Record<string, string>;
  pool_min: number;
  pool_max: number;
  status: InstanceStatus;
  last_health_check: string | null;
  last_health_status: string | null;
  consecutive_failures: number;
  onboarded_by: string;
  onboarded_at: string;
  updated_by: string | null;
  updated_at: string | null;
}

export interface HealthSummary {
  overall: "up" | "down" | "degraded";
  totalInstances: number;
  activeInstances: number;
  upCount: number;
  downCount: number;
  byEnvironment: Record<
    Environment,
    { up: number; down: number; total: number }
  >;
  instances: InstanceHealth[];
  checkedAt: string;
}

export interface InstanceHealth {
  instanceId: string;
  name: string;
  dbType: DbType;
  environment: Environment;
  health: {
    status: "up" | "down";
    latencyMs: number;
    error?: string;
  };
}

export interface OnboardPayload {
  name: string;
  dbType: DbType;
  environment: Environment;
  host: string;
  port: number;
  databaseName: string;
  username: string;
  password: string;
  displayName?: string;
  application?: string;
  team?: string;
  ownerEmail?: string;
  tags?: Record<string, string>;
  poolMin?: number;
  poolMax?: number;
  additionalOptions?: Record<string, unknown>;
}

export interface UpdatePayload {
  displayName?: string;
  application?: string;
  team?: string;
  ownerEmail?: string;
  environment?: Environment;
  tags?: Record<string, string>;
  poolMin?: number;
  poolMax?: number;
}

export interface CredentialsPayload {
  username: string;
  password: string;
  additionalOptions?: Record<string, unknown>;
}

export interface ListFilters {
  environment?: Environment;
  dbType?: DbType;
  status?: InstanceStatus;
  application?: string;
  team?: string;
}
