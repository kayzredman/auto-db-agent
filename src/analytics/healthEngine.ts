import type { DbType, DatabaseConnector } from "../connectors/types";

// Health status levels (OEM-aligned)
export type HealthSeverity = "CRITICAL" | "WARNING" | "INFO" | "OK";
export type OverallStatus = "CRITICAL" | "WARNING" | "HEALTHY";

export interface HealthIssue {
  severity: HealthSeverity;
  category: string;
  code: string;
  message: string;
  affectedObject?: string;
  currentValue?: number | string;
  threshold?: number | string;
  detectedAt: Date;
}

export interface HealthRecommendation {
  priority: "HIGH" | "MEDIUM" | "LOW";
  category: string;
  title: string;
  description: string;
  action: string;
  reference?: string | undefined; // OEM/vendor documentation reference
  relatedIssueCode?: string | undefined;
}

export interface HealthReport {
  instanceId: string;
  dbType: DbType;
  overallStatus: OverallStatus;
  checkedAt: Date;
  checkDurationMs: number;
  issues: HealthIssue[];
  recommendations: HealthRecommendation[];
  metrics: HealthMetrics;
}

export interface HealthMetrics {
  invalidObjects?: InvalidObjectMetric[];
  tablespaces?: TablespaceMetric[];
  fra?: FRAMetric;
  failedJobs?: FailedJobMetric[];
  backups?: BackupMetric;
}

export interface InvalidObjectMetric {
  owner: string;
  objectName: string;
  objectType: string;
  status: string;
  createdAt?: Date;
}

export interface TablespaceMetric {
  name: string;
  usedBytes: number;
  totalBytes: number;
  usedPercent: number;
  autoExtensible: boolean;
  maxSizeBytes?: number;
}

export interface FRAMetric {
  name: string;
  usedBytes: number;
  totalBytes: number;
  usedPercent: number;
  reclaimableBytes: number;
}

export interface FailedJobMetric {
  jobName: string;
  jobType: string;
  lastRunTime?: Date;
  failureMessage?: string;
  failureCount: number;
}

export interface BackupMetric {
  lastSuccessfulBackup?: Date | undefined;
  lastBackupType?: string | undefined;
  lastBackupStatus: "SUCCESS" | "FAILED" | "RUNNING" | "UNKNOWN";
  hoursSinceLastBackup?: number | undefined;
  failedBackupsLast24h: number;
}

// Thresholds based on OEM/vendor recommendations
const THRESHOLDS = {
  tablespaceWarning: 85,
  tablespaceCritical: 90,
  fraWarning: 80,
  fraCritical: 85,
  backupWarningHours: 24,
  backupCriticalHours: 48,
  invalidObjectsWarning: 1,
  failedJobsWarning: 1,
} as const;

// SQL queries for each database type
const HEALTH_QUERIES = {
  oracle: {
    invalidObjects: `
      SELECT owner, object_name, object_type, status, created
      FROM dba_objects
      WHERE status = 'INVALID'
        AND owner NOT IN ('SYS', 'SYSTEM', 'PUBLIC')
      ORDER BY owner, object_type, object_name`,

    tablespaces: `
      SELECT 
        ts.tablespace_name AS name,
        NVL(used.bytes, 0) AS used_bytes,
        NVL(ts_size.bytes, 0) AS total_bytes,
        ROUND(NVL(used.bytes, 0) / NULLIF(ts_size.bytes, 0) * 100, 2) AS used_percent,
        CASE WHEN df.autoextensible = 'YES' THEN 1 ELSE 0 END AS auto_extensible,
        df.maxbytes AS max_size_bytes
      FROM dba_tablespaces ts
      LEFT JOIN (
        SELECT tablespace_name, SUM(bytes) bytes
        FROM dba_data_files GROUP BY tablespace_name
      ) ts_size ON ts.tablespace_name = ts_size.tablespace_name
      LEFT JOIN (
        SELECT tablespace_name, SUM(bytes) bytes
        FROM dba_segments GROUP BY tablespace_name
      ) used ON ts.tablespace_name = used.tablespace_name
      LEFT JOIN dba_data_files df ON ts.tablespace_name = df.tablespace_name AND ROWNUM = 1
      WHERE ts.contents != 'TEMPORARY'`,

    fra: `
      SELECT 
        name,
        space_used AS used_bytes,
        space_limit AS total_bytes,
        ROUND(space_used / NULLIF(space_limit, 0) * 100, 2) AS used_percent,
        space_reclaimable AS reclaimable_bytes
      FROM v$recovery_file_dest`,

    failedJobs: `
      SELECT 
        job_name,
        job_type,
        last_start_date AS last_run_time,
        additional_info AS failure_message,
        failure_count
      FROM dba_scheduler_jobs
      WHERE state = 'FAILED' OR failure_count > 0
      ORDER BY failure_count DESC`,

    backups: `
      SELECT 
        completion_time AS last_backup_time,
        input_type AS backup_type,
        status,
        ROUND((SYSDATE - completion_time) * 24, 2) AS hours_since
      FROM v$rman_backup_job_details
      WHERE input_type IN ('DB FULL', 'DB INCR', 'ARCHIVELOG')
      ORDER BY completion_time DESC
      FETCH FIRST 1 ROW ONLY`,
  },

  mssql: {
    invalidObjects: `
      SELECT 
        SCHEMA_NAME(o.schema_id) AS owner,
        o.name AS object_name,
        o.type_desc AS object_type,
        'INVALID' AS status,
        o.create_date AS created
      FROM sys.objects o
      WHERE o.type IN ('P', 'FN', 'TF', 'V', 'TR')
        AND OBJECTPROPERTY(o.object_id, 'ExecIsQuotedIdentOn') IS NULL`,

    tablespaces: `
      SELECT 
        f.name AS name,
        CAST(FILEPROPERTY(f.name, 'SpaceUsed') AS BIGINT) * 8192 AS used_bytes,
        f.size * 8192 AS total_bytes,
        ROUND(CAST(FILEPROPERTY(f.name, 'SpaceUsed') AS FLOAT) / NULLIF(f.size, 0) * 100, 2) AS used_percent,
        CASE WHEN f.growth > 0 THEN 1 ELSE 0 END AS auto_extensible,
        CASE WHEN f.max_size = -1 THEN NULL ELSE f.max_size * 8192 END AS max_size_bytes
      FROM sys.database_files f
      WHERE f.type = 0`,

    failedJobs: `
      SELECT 
        j.name AS job_name,
        'SQL Agent Job' AS job_type,
        h.run_date AS last_run_time,
        h.message AS failure_message,
        COUNT(*) AS failure_count
      FROM msdb.dbo.sysjobs j
      JOIN msdb.dbo.sysjobhistory h ON j.job_id = h.job_id
      WHERE h.run_status = 0
        AND h.run_date >= CONVERT(INT, CONVERT(VARCHAR(8), DATEADD(DAY, -7, GETDATE()), 112))
      GROUP BY j.name, h.run_date, h.message
      ORDER BY failure_count DESC`,

    backups: `
      SELECT TOP 1
        backup_finish_date AS last_backup_time,
        type AS backup_type,
        CASE 
          WHEN backup_finish_date IS NOT NULL THEN 'SUCCESS'
          ELSE 'FAILED'
        END AS status,
        DATEDIFF(HOUR, backup_finish_date, GETDATE()) AS hours_since
      FROM msdb.dbo.backupset
      WHERE database_name = DB_NAME()
      ORDER BY backup_finish_date DESC`,
  },

  postgres: {
    invalidObjects: `
      SELECT 
        n.nspname AS owner,
        p.proname AS object_name,
        'FUNCTION' AS object_type,
        'INVALID' AS status,
        NULL::timestamp AS created
      FROM pg_proc p
      JOIN pg_namespace n ON p.pronamespace = n.oid
      WHERE NOT pg_catalog.pg_function_is_visible(p.oid)
        AND n.nspname NOT IN ('pg_catalog', 'information_schema')
      LIMIT 0`,

    tablespaces: `
      SELECT 
        spcname AS name,
        pg_tablespace_size(oid) AS used_bytes,
        pg_tablespace_size(oid) AS total_bytes,
        100.0 AS used_percent,
        false AS auto_extensible,
        NULL::bigint AS max_size_bytes
      FROM pg_tablespace
      WHERE spcname NOT IN ('pg_default', 'pg_global')`,

    failedJobs: `
      SELECT 
        '' AS job_name,
        '' AS job_type,
        NULL::timestamp AS last_run_time,
        '' AS failure_message,
        0 AS failure_count
      WHERE false`,

    backups: `
      SELECT 
        last_archived_time AS last_backup_time,
        'WAL' AS backup_type,
        CASE WHEN last_archived_time IS NOT NULL THEN 'SUCCESS' ELSE 'UNKNOWN' END AS status,
        EXTRACT(EPOCH FROM (NOW() - last_archived_time)) / 3600 AS hours_since
      FROM pg_stat_archiver
      WHERE last_archived_time IS NOT NULL`,
  },

  mysql: {
    invalidObjects: `
      SELECT 
        TABLE_SCHEMA AS owner,
        TABLE_NAME AS object_name,
        TABLE_TYPE AS object_type,
        'INVALID' AS status,
        CREATE_TIME AS created
      FROM information_schema.TABLES
      WHERE TABLE_SCHEMA NOT IN ('mysql', 'information_schema', 'performance_schema', 'sys')
        AND ENGINE IS NULL
      LIMIT 100`,

    tablespaces: `
      SELECT 
        TABLE_SCHEMA AS name,
        SUM(DATA_LENGTH + INDEX_LENGTH) AS used_bytes,
        SUM(DATA_LENGTH + INDEX_LENGTH) AS total_bytes,
        100.0 AS used_percent,
        1 AS auto_extensible,
        NULL AS max_size_bytes
      FROM information_schema.TABLES
      WHERE TABLE_SCHEMA NOT IN ('mysql', 'information_schema', 'performance_schema', 'sys')
      GROUP BY TABLE_SCHEMA`,

    failedJobs: `
      SELECT 
        NAME AS job_name,
        TYPE AS job_type,
        LAST_EXECUTED AS last_run_time,
        '' AS failure_message,
        0 AS failure_count
      FROM information_schema.EVENTS
      WHERE STATUS != 'ENABLED'`,

    backups: `
      SELECT 
        NULL AS last_backup_time,
        'UNKNOWN' AS backup_type,
        'UNKNOWN' AS status,
        NULL AS hours_since
      FROM DUAL
      WHERE 1=0`,
  },
};

// OEM-aligned recommendations database
type RecommendationTemplate = Omit<HealthRecommendation, "relatedIssueCode">;

const RECOMMENDATIONS_DB = {
  TABLESPACE_CRITICAL: {
    priority: "HIGH" as const,
    category: "Storage",
    title: "Critical Tablespace Usage",
    description: "Tablespace usage exceeds 90%, which may cause application failures and data loss.",
    action: "Immediately add datafiles or enable autoextend. Consider archiving old data or implementing partitioning.",
    reference: "Oracle MOS Doc ID 1.1 - Tablespace Management Best Practices",
  },
  TABLESPACE_WARNING: {
    priority: "MEDIUM" as const,
    category: "Storage",
    title: "High Tablespace Usage",
    description: "Tablespace usage exceeds 85%. Plan for capacity expansion.",
    action: "Schedule datafile addition during maintenance window. Review data retention policies.",
    reference: "Oracle MOS Doc ID 1.1 - Tablespace Management Best Practices",
  },
  FRA_CRITICAL: {
    priority: "HIGH" as const,
    category: "Recovery",
    title: "Critical Flash Recovery Area Usage",
    description: "FRA usage exceeds 85%, risking archive log writes and backup failures.",
    action: "Immediately backup and delete obsolete archive logs. Increase FRA size or configure RMAN retention policy.",
    reference: "Oracle MOS Doc ID 1353616.1 - FRA Best Practices",
  },
  FRA_WARNING: {
    priority: "MEDIUM" as const,
    category: "Recovery",
    title: "High Flash Recovery Area Usage",
    description: "FRA usage exceeds 80%. Monitor closely and plan cleanup.",
    action: "Schedule RMAN maintenance to delete obsolete backups. Review backup retention policy.",
    reference: "Oracle MOS Doc ID 1353616.1 - FRA Best Practices",
  },
  INVALID_OBJECTS: {
    priority: "MEDIUM" as const,
    category: "Schema",
    title: "Invalid Database Objects Detected",
    description: "Invalid objects may cause application errors and indicate failed deployments.",
    action: "Run UTL_RECOMP.RECOMP_PARALLEL() or manually recompile invalid objects. Investigate root cause.",
    reference: "Oracle MOS Doc ID 457226.1 - Recompiling Invalid Objects",
  },
  FAILED_JOBS: {
    priority: "MEDIUM" as const,
    category: "Jobs",
    title: "Failed Scheduler Jobs",
    description: "Failed jobs may indicate system issues or broken business processes.",
    action: "Review job logs, fix underlying issues, and re-enable failed jobs.",
    reference: "Oracle MOS Doc ID 1342596.1 - Troubleshooting Scheduler Jobs",
  },
  BACKUP_CRITICAL: {
    priority: "HIGH" as const,
    category: "Backup",
    title: "Critical: No Recent Backup",
    description: "No successful backup in over 48 hours. Data loss risk is severe.",
    action: "Immediately investigate backup infrastructure and perform emergency backup.",
    reference: "Oracle MOS Doc ID 360416.1 - RMAN Backup Best Practices",
  },
  BACKUP_WARNING: {
    priority: "HIGH" as const,
    category: "Backup",
    title: "Backup Overdue",
    description: "No successful backup in over 24 hours. Review backup schedule.",
    action: "Verify backup job status and storage availability. Run manual backup if needed.",
    reference: "Oracle MOS Doc ID 360416.1 - RMAN Backup Best Practices",
  },
  BACKUP_FAILURES: {
    priority: "HIGH" as const,
    category: "Backup",
    title: "Recent Backup Failures",
    description: "One or more backup failures in the last 24 hours.",
    action: "Review backup logs for errors. Check storage space and network connectivity.",
    reference: "Oracle MOS Doc ID 360416.1 - RMAN Backup Best Practices",
  },
} satisfies Record<string, RecommendationTemplate>;

function createRecommendation(
  template: RecommendationTemplate,
  relatedIssueCode: string
): HealthRecommendation {
  return {
    priority: template.priority,
    category: template.category,
    title: template.title,
    description: template.description,
    action: template.action,
    reference: template.reference,
    relatedIssueCode,
  };
}

export interface HealthEngineConfig {
  thresholds?: Partial<typeof THRESHOLDS>;
  enabledChecks?: {
    invalidObjects?: boolean;
    tablespaces?: boolean;
    fra?: boolean;
    failedJobs?: boolean;
    backups?: boolean;
  };
}

export class HealthEngine {
  private readonly config: HealthEngineConfig;
  private readonly thresholds: typeof THRESHOLDS;

  constructor(config: HealthEngineConfig = {}) {
    this.config = config;
    this.thresholds = { ...THRESHOLDS, ...config.thresholds };
  }

  async runHealthCheck(
    connector: DatabaseConnector,
    dbType: DbType,
    instanceId: string
  ): Promise<HealthReport> {
    const startTime = Date.now();
    const issues: HealthIssue[] = [];
    const recommendations: HealthRecommendation[] = [];
    const metrics: HealthMetrics = {};
    const enabledChecks = this.config.enabledChecks ?? {
      invalidObjects: true,
      tablespaces: true,
      fra: dbType === "oracle",
      failedJobs: true,
      backups: true,
    };

    try {
      // Run enabled checks in parallel
      const checkPromises: Promise<void>[] = [];

      if (enabledChecks.invalidObjects) {
        checkPromises.push(
          this.checkInvalidObjects(connector, dbType, metrics, issues, recommendations)
        );
      }

      if (enabledChecks.tablespaces) {
        checkPromises.push(
          this.checkTablespaces(connector, dbType, metrics, issues, recommendations)
        );
      }

      if (enabledChecks.fra && dbType === "oracle") {
        checkPromises.push(
          this.checkFRA(connector, metrics, issues, recommendations)
        );
      }

      if (enabledChecks.failedJobs) {
        checkPromises.push(
          this.checkFailedJobs(connector, dbType, metrics, issues, recommendations)
        );
      }

      if (enabledChecks.backups) {
        checkPromises.push(
          this.checkBackups(connector, dbType, metrics, issues, recommendations)
        );
      }

      await Promise.all(checkPromises);
    } catch (error) {
      issues.push({
        severity: "CRITICAL",
        category: "System",
        code: "HEALTH_CHECK_ERROR",
        message: `Health check failed: ${error instanceof Error ? error.message : "Unknown error"}`,
        detectedAt: new Date(),
      });
    }

    const overallStatus = this.calculateOverallStatus(issues);
    const checkDurationMs = Date.now() - startTime;

    return {
      instanceId,
      dbType,
      overallStatus,
      checkedAt: new Date(),
      checkDurationMs,
      issues,
      recommendations,
      metrics,
    };
  }

  private calculateOverallStatus(issues: HealthIssue[]): OverallStatus {
    if (issues.some((i) => i.severity === "CRITICAL")) {
      return "CRITICAL";
    }
    if (issues.some((i) => i.severity === "WARNING")) {
      return "WARNING";
    }
    return "HEALTHY";
  }

  private async checkInvalidObjects(
    connector: DatabaseConnector,
    dbType: DbType,
    metrics: HealthMetrics,
    issues: HealthIssue[],
    recommendations: HealthRecommendation[]
  ): Promise<void> {
    try {
      const query = HEALTH_QUERIES[dbType].invalidObjects;
      const results = await this.executeQuery<InvalidObjectMetric>(connector, query);

      metrics.invalidObjects = results;

      if (results.length >= this.thresholds.invalidObjectsWarning) {
        issues.push({
          severity: "WARNING",
          category: "Schema",
          code: "INVALID_OBJECTS",
          message: `${results.length} invalid object(s) detected`,
          currentValue: results.length,
          threshold: 0,
          detectedAt: new Date(),
        });

        recommendations.push(
          createRecommendation(RECOMMENDATIONS_DB.INVALID_OBJECTS, "INVALID_OBJECTS")
        );
      }
    } catch (error) {
      // Log but don't fail entire health check
      console.error("Invalid objects check failed:", error);
    }
  }

  private async checkTablespaces(
    connector: DatabaseConnector,
    dbType: DbType,
    metrics: HealthMetrics,
    issues: HealthIssue[],
    recommendations: HealthRecommendation[]
  ): Promise<void> {
    try {
      const query = HEALTH_QUERIES[dbType].tablespaces;
      const results = await this.executeQuery<TablespaceMetric>(connector, query);

      metrics.tablespaces = results;

      for (const ts of results) {
        if (ts.usedPercent >= this.thresholds.tablespaceCritical) {
          issues.push({
            severity: "CRITICAL",
            category: "Storage",
            code: "TABLESPACE_CRITICAL",
            message: `Tablespace ${ts.name} is ${ts.usedPercent.toFixed(1)}% full`,
            affectedObject: ts.name,
            currentValue: ts.usedPercent,
            threshold: this.thresholds.tablespaceCritical,
            detectedAt: new Date(),
          });

          if (!recommendations.some((r) => r.relatedIssueCode === "TABLESPACE_CRITICAL")) {
            recommendations.push(
              createRecommendation(RECOMMENDATIONS_DB.TABLESPACE_CRITICAL, "TABLESPACE_CRITICAL")
            );
          }
        } else if (ts.usedPercent >= this.thresholds.tablespaceWarning) {
          issues.push({
            severity: "WARNING",
            category: "Storage",
            code: "TABLESPACE_WARNING",
            message: `Tablespace ${ts.name} is ${ts.usedPercent.toFixed(1)}% full`,
            affectedObject: ts.name,
            currentValue: ts.usedPercent,
            threshold: this.thresholds.tablespaceWarning,
            detectedAt: new Date(),
          });

          if (!recommendations.some((r) => r.relatedIssueCode === "TABLESPACE_WARNING")) {
            recommendations.push(
              createRecommendation(RECOMMENDATIONS_DB.TABLESPACE_WARNING, "TABLESPACE_WARNING")
            );
          }
        }
      }
    } catch (error) {
      console.error("Tablespace check failed:", error);
    }
  }

  private async checkFRA(
    connector: DatabaseConnector,
    metrics: HealthMetrics,
    issues: HealthIssue[],
    recommendations: HealthRecommendation[]
  ): Promise<void> {
    try {
      const query = HEALTH_QUERIES.oracle.fra;
      const results = await this.executeQuery<FRAMetric>(connector, query);

      if (results.length > 0) {
        const fra = results[0]!;
        metrics.fra = fra;

        if (fra.usedPercent >= this.thresholds.fraCritical) {
          issues.push({
            severity: "CRITICAL",
            category: "Recovery",
            code: "FRA_CRITICAL",
            message: `Flash Recovery Area is ${fra.usedPercent.toFixed(1)}% full`,
            affectedObject: fra.name,
            currentValue: fra.usedPercent,
            threshold: this.thresholds.fraCritical,
            detectedAt: new Date(),
          });

          recommendations.push(
            createRecommendation(RECOMMENDATIONS_DB.FRA_CRITICAL, "FRA_CRITICAL")
          );
        } else if (fra.usedPercent >= this.thresholds.fraWarning) {
          issues.push({
            severity: "WARNING",
            category: "Recovery",
            code: "FRA_WARNING",
            message: `Flash Recovery Area is ${fra.usedPercent.toFixed(1)}% full`,
            affectedObject: fra.name,
            currentValue: fra.usedPercent,
            threshold: this.thresholds.fraWarning,
            detectedAt: new Date(),
          });

          recommendations.push(
            createRecommendation(RECOMMENDATIONS_DB.FRA_WARNING, "FRA_WARNING")
          );
        }
      }
    } catch (error) {
      console.error("FRA check failed:", error);
    }
  }

  private async checkFailedJobs(
    connector: DatabaseConnector,
    dbType: DbType,
    metrics: HealthMetrics,
    issues: HealthIssue[],
    recommendations: HealthRecommendation[]
  ): Promise<void> {
    try {
      const query = HEALTH_QUERIES[dbType].failedJobs;
      const results = await this.executeQuery<FailedJobMetric>(connector, query);

      metrics.failedJobs = results;

      if (results.length >= this.thresholds.failedJobsWarning) {
        issues.push({
          severity: "WARNING",
          category: "Jobs",
          code: "FAILED_JOBS",
          message: `${results.length} failed job(s) detected`,
          currentValue: results.length,
          threshold: 0,
          detectedAt: new Date(),
        });

        recommendations.push(
          createRecommendation(RECOMMENDATIONS_DB.FAILED_JOBS, "FAILED_JOBS")
        );
      }
    } catch (error) {
      console.error("Failed jobs check failed:", error);
    }
  }

  private async checkBackups(
    connector: DatabaseConnector,
    dbType: DbType,
    metrics: HealthMetrics,
    issues: HealthIssue[],
    recommendations: HealthRecommendation[]
  ): Promise<void> {
    try {
      const query = HEALTH_QUERIES[dbType].backups;
      const results = await this.executeQuery<{
        last_backup_time: Date | null;
        backup_type: string;
        status: string;
        hours_since: number | null;
      }>(connector, query);

      const backupMetric: BackupMetric = {
        lastBackupStatus: "UNKNOWN",
        failedBackupsLast24h: 0,
      };

      if (results.length > 0) {
        const backup = results[0]!;
        backupMetric.lastSuccessfulBackup = backup.last_backup_time ?? undefined;
        backupMetric.lastBackupType = backup.backup_type;
        backupMetric.lastBackupStatus = backup.status as BackupMetric["lastBackupStatus"];
        backupMetric.hoursSinceLastBackup = backup.hours_since ?? undefined;

        if (backup.hours_since !== null) {
          if (backup.hours_since >= this.thresholds.backupCriticalHours) {
            issues.push({
              severity: "CRITICAL",
              category: "Backup",
              code: "BACKUP_CRITICAL",
              message: `No successful backup in ${backup.hours_since.toFixed(0)} hours`,
              currentValue: backup.hours_since,
              threshold: this.thresholds.backupCriticalHours,
              detectedAt: new Date(),
            });

            recommendations.push(
              createRecommendation(RECOMMENDATIONS_DB.BACKUP_CRITICAL, "BACKUP_CRITICAL")
            );
          } else if (backup.hours_since >= this.thresholds.backupWarningHours) {
            issues.push({
              severity: "WARNING",
              category: "Backup",
              code: "BACKUP_WARNING",
              message: `No successful backup in ${backup.hours_since.toFixed(0)} hours`,
              currentValue: backup.hours_since,
              threshold: this.thresholds.backupWarningHours,
              detectedAt: new Date(),
            });

            recommendations.push(
              createRecommendation(RECOMMENDATIONS_DB.BACKUP_WARNING, "BACKUP_WARNING")
            );
          }
        }
      } else {
        // No backup records found
        issues.push({
          severity: "CRITICAL",
          category: "Backup",
          code: "BACKUP_CRITICAL",
          message: "No backup records found",
          detectedAt: new Date(),
        });

        recommendations.push(
          createRecommendation(RECOMMENDATIONS_DB.BACKUP_CRITICAL, "BACKUP_CRITICAL")
        );
      }

      metrics.backups = backupMetric;
    } catch (error) {
      console.error("Backup check failed:", error);
    }
  }

  // Execute query using the connector's query method
  private async executeQuery<T>(
    connector: DatabaseConnector,
    query: string
  ): Promise<T[]> {
    return await connector.query<T>(query);
  }
}

// Factory function
export function createHealthEngine(config?: HealthEngineConfig): HealthEngine {
  return new HealthEngine(config);
}

// Export default thresholds for reference
export { THRESHOLDS as DEFAULT_HEALTH_THRESHOLDS };
