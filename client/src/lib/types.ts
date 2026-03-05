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

// ── Tablespace Predictions ──

export type PredictionRisk = "CRITICAL" | "HIGH" | "WARNING" | "OK";

export interface GrowthSnapshot {
  date: string;
  usedBytes: number;
}

export interface TablespacePrediction {
  name: string;
  dbType: DbType;
  currentUsedBytes: number;
  currentTotalBytes: number;
  currentUsedPercent: number;
  freeBytes: number;
  autoExtensible: boolean;
  maxSizeBytes: number | null;
  effectiveCapacityBytes: number;
  effectiveFreeBytes: number;
  growthPerDayBytes: number;
  daysToFull: number | null;
  risk: PredictionRisk;
  message: string;
  snapshots: GrowthSnapshot[];
}

export interface TablespacePredictionReport {
  instanceId: string;
  dbType: DbType;
  analyzedAt: string;
  snapshotWindowDays: number;
  predictions: TablespacePrediction[];
  highestRisk: PredictionRisk;
}

// ── FRA Risk Analysis ──

export type FRARisk = "CRITICAL" | "HIGH" | "WARNING" | "OK";

export interface FRARiskIssue {
  severity: FRARisk;
  code: string;
  category: string;
  message: string;
  currentValue: number | string;
  threshold: number | string;
  detectedAt: string;
}

export interface FRARiskRecommendation {
  priority: "HIGH" | "MEDIUM" | "LOW";
  category: string;
  title: string;
  description: string;
  action: string;
  reference: string;
  relatedIssueCode: string;
}

export interface RecoveryAreaMetrics {
  name: string;
  totalBytes: number;
  usedBytes: number;
  usedPercent: number;
  reclaimableBytes: number;
  effectiveFreeBytes: number;
}

export interface ArchiveGenerationMetrics {
  avgDailyGenerationBytes: number;
  todayGenerationBytes: number;
  deviationPercent: number;
  analysisDays: number;
  dailyBreakdown: DailyGeneration[];
}

export interface DailyGeneration {
  date: string;
  generationBytes: number;
}

export interface FlashbackMetrics {
  enabled: boolean;
  retentionMinutes: number;
  oldestFlashbackTime: string | null;
  estimatedSpaceBytes: number;
}

export interface FRARiskReport {
  instanceId: string;
  dbType: DbType;
  analyzedAt: string;
  recoveryArea: RecoveryAreaMetrics | null;
  archiveGeneration: ArchiveGenerationMetrics | null;
  flashback: FlashbackMetrics | null;
  issues: FRARiskIssue[];
  recommendations: FRARiskRecommendation[];
  overallRisk: FRARisk;
}
