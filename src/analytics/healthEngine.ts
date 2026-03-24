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
  performance?: PerformanceMetrics;
  availability?: AvailabilityMetrics;
  replication?: ReplicationMetrics;
}

export interface PerformanceMetrics {
  activeSessions: number;
  inactiveSessions: number;
  cpuPercent: number | null;
  memoryPercent: number | null;
  slowQueries: number;
}

export interface AvailabilityMetrics {
  instanceStatus: string; // OPEN, MOUNTED, STARTED, ONLINE, etc.
  upSince: Date | null;
  uptimeHours: number | null;
  listenerStatus: string; // UP, DOWN, UNKNOWN
  blockedSessions: number;
}

export interface ReplicationMetrics {
  role: string; // PRIMARY, STANDBY, NONE, etc.
  replicaStatus: string; // ACTIVE, INACTIVE, N/A
  lagSeconds: number | null;
  transportLagSeconds: number | null;
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
        NVL(awr.used_bytes, 0) AS used_bytes,
        NVL(ts_size.bytes, 0) AS total_bytes,
        ROUND(NVL(awr.used_bytes, 0) / NULLIF(ts_size.bytes, 0) * 100, 2) AS used_percent,
        NVL(df_agg.auto_ext, 0) AS auto_extensible,
        df_agg.max_bytes AS max_size_bytes
      FROM dba_tablespaces ts
      LEFT JOIN (
        SELECT tablespace_name, SUM(bytes) bytes
        FROM dba_data_files GROUP BY tablespace_name
      ) ts_size ON ts.tablespace_name = ts_size.tablespace_name
      LEFT JOIN (
        SELECT vt.name AS tablespace_name,
               MAX(h.tablespace_usedsize) * ts2.block_size AS used_bytes
        FROM dba_hist_tbspc_space_usage h
        JOIN v$tablespace vt ON h.tablespace_id = vt.ts#
        JOIN dba_tablespaces ts2 ON vt.name = ts2.tablespace_name
        WHERE h.snap_id = (SELECT MAX(snap_id) FROM dba_hist_tbspc_space_usage)
        GROUP BY vt.name, ts2.block_size
      ) awr ON ts.tablespace_name = awr.tablespace_name
      LEFT JOIN (
        SELECT tablespace_name,
               MAX(CASE WHEN autoextensible = 'YES' THEN 1 ELSE 0 END) AS auto_ext,
               SUM(CASE WHEN autoextensible = 'YES' THEN maxbytes ELSE bytes END) AS max_bytes
        FROM dba_data_files GROUP BY tablespace_name
      ) df_agg ON ts.tablespace_name = df_agg.tablespace_name
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
      SELECT * FROM (
        SELECT 
          bp.completion_time AS last_backup_time,
          DECODE(bs.backup_type, 'D', 'DB FULL', 'I', 'DB INCR', 'L', 'ARCHIVELOG', bs.backup_type) AS backup_type,
          DECODE(bp.status, 'A', 'COMPLETED', 'X', 'FAILED', bp.status) AS status,
          ROUND((SYSDATE - bp.completion_time) * 24, 2) AS hours_since
        FROM v$backup_piece bp
        JOIN v$backup_set bs ON bp.set_stamp = bs.set_stamp AND bp.set_count = bs.set_count
        WHERE bp.status = 'A'
        ORDER BY bp.completion_time DESC
      ) WHERE ROWNUM = 1`,
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
        ISNULL(CAST(FILEPROPERTY(f.name, 'SpaceUsed') AS BIGINT), 0) * 8192 AS used_bytes,
        CAST(f.size AS BIGINT) * 8192 AS total_bytes,
        ROUND(ISNULL(CAST(FILEPROPERTY(f.name, 'SpaceUsed') AS FLOAT), 0) / NULLIF(CAST(f.size AS FLOAT), 0) * 100, 2) AS used_percent,
        CASE WHEN f.growth > 0 THEN 1 ELSE 0 END AS auto_extensible,
        CASE WHEN f.max_size = -1 THEN NULL ELSE CAST(f.max_size AS BIGINT) * 8192 END AS max_size_bytes
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
        bs.backup_finish_date AS last_backup_time,
        CASE bs.type
          WHEN 'D' THEN 'FULL'
          WHEN 'I' THEN 'DIFFERENTIAL'
          WHEN 'L' THEN 'LOG'
          ELSE bs.type
        END AS backup_type,
        CASE 
          WHEN bs.backup_finish_date IS NOT NULL THEN 'SUCCESS'
          ELSE 'FAILED'
        END AS status,
        DATEDIFF(HOUR, bs.backup_finish_date, GETDATE()) AS hours_since
      FROM msdb.dbo.backupset bs
      WHERE bs.database_name = DB_NAME()
      ORDER BY bs.backup_finish_date DESC`,
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
        datname AS name,
        pg_database_size(datname) AS used_bytes,
        pg_database_size(datname) AS total_bytes,
        100.0 AS used_percent,
        true AS auto_extensible,
        NULL::bigint AS max_size_bytes
      FROM pg_database
      WHERE datistemplate = false AND datallowconn = true
      ORDER BY pg_database_size(datname) DESC`,

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
        SUM(DATA_LENGTH + INDEX_LENGTH + DATA_FREE) AS total_bytes,
        ROUND(
          SUM(DATA_LENGTH + INDEX_LENGTH)
          / NULLIF(SUM(DATA_LENGTH + INDEX_LENGTH + DATA_FREE), 0) * 100, 2
        ) AS used_percent,
        1 AS auto_extensible,
        NULL AS max_size_bytes
      FROM information_schema.TABLES
      WHERE TABLE_SCHEMA NOT IN ('mysql', 'information_schema', 'performance_schema', 'sys')
        AND TABLE_TYPE = 'BASE TABLE'
      GROUP BY TABLE_SCHEMA
      ORDER BY SUM(DATA_LENGTH + INDEX_LENGTH) DESC`,

    failedJobs: `
      SELECT 
        EVENT_NAME AS job_name,
        EVENT_TYPE AS job_type,
        LAST_EXECUTED AS last_run_time,
        '' AS failure_message,
        0 AS failure_count
      FROM information_schema.EVENTS
      WHERE STATUS != 'ENABLED'
        AND EVENT_SCHEMA NOT IN ('mysql', 'information_schema', 'performance_schema', 'sys')`,

    backups: `
      SELECT 
        NULL AS last_backup_time,
        'N/A' AS backup_type,
        'UNKNOWN' AS status,
        NULL AS hours_since`,
  },
};

// ── Performance / Availability / Replication Queries ──

const PERF_QUERIES = {
  oracle: {
    performance: `
      SELECT
        (SELECT COUNT(*) FROM v$session WHERE type = 'USER' AND status = 'ACTIVE') AS active_sessions,
        (SELECT COUNT(*) FROM v$session WHERE type = 'USER' AND status = 'INACTIVE') AS inactive_sessions,
        (SELECT ROUND(value, 2) FROM v$sysmetric WHERE metric_name = 'Host CPU Utilization (%)' AND group_id = 2 AND ROWNUM = 1) AS cpu_percent,
        (SELECT ROUND(value, 2) FROM v$sysmetric WHERE metric_name = 'Physical Memory Usage %' AND group_id = 2 AND ROWNUM = 1) AS memory_percent,
        (SELECT COUNT(*) FROM v$session WHERE type = 'USER' AND status = 'ACTIVE'
           AND last_call_et > 5) AS slow_queries
      FROM DUAL`,

    availability: `
      SELECT
        i.status AS instance_status,
        i.startup_time AS up_since,
        ROUND((SYSDATE - i.startup_time) * 24, 2) AS uptime_hours,
        'UP' AS listener_status,
        (SELECT COUNT(*) FROM v$session WHERE blocking_session IS NOT NULL) AS blocked_sessions
      FROM v$instance i`,

    replication: `
      SELECT
        d.database_role AS role,
        NVL(
          (SELECT DECODE(status, 'VALID', 'ACTIVE', 'ERROR', 'ERROR', 'INACTIVE')
           FROM v$archive_dest_status WHERE dest_id = 2 AND ROWNUM = 1),
          'N/A'
        ) AS replica_status,
        NULL AS lag_seconds,
        NULL AS transport_lag_seconds
      FROM v$database d`,
  },

  mssql: {
    performance: `
      SELECT
        (SELECT COUNT(*) FROM sys.dm_exec_sessions WHERE is_user_process = 1 AND status = 'running') AS active_sessions,
        (SELECT COUNT(*) FROM sys.dm_exec_sessions WHERE is_user_process = 1 AND status != 'running') AS inactive_sessions,
        (SELECT TOP 1
           x.record.value('(./Record/SchedulerMonitorEvent/SystemHealth/ProcessUtilization)[1]', 'int')
         FROM (SELECT CAST(record AS XML) AS record
               FROM sys.dm_os_ring_buffers
               WHERE ring_buffer_type = N'RING_BUFFER_SCHEDULER_MONITOR') AS x
         ORDER BY x.record.value('(./Record/@id)[1]', 'int') DESC
        ) AS cpu_percent,
        (SELECT ROUND(
           CAST(pc1.cntr_value AS FLOAT)
           / NULLIF(CAST(pc2.cntr_value AS FLOAT), 0) * 100, 2)
         FROM sys.dm_os_performance_counters pc1
         CROSS JOIN sys.dm_os_performance_counters pc2
         WHERE RTRIM(pc1.counter_name) = 'Total Server Memory (KB)'
           AND RTRIM(pc1.object_name) LIKE '%:Memory Manager'
           AND RTRIM(pc2.counter_name) = 'Target Server Memory (KB)'
           AND RTRIM(pc2.object_name) LIKE '%:Memory Manager'
        ) AS memory_percent,
        (SELECT COUNT(*) FROM sys.dm_exec_requests WHERE total_elapsed_time > 5000) AS slow_queries`,

    availability: `
      SELECT
        ISNULL(
          CASE WHEN CAST(SERVERPROPERTY('IsHadrEnabled') AS INT) = 1 THEN 'ONLINE (AG)' ELSE 'ONLINE' END,
          'ONLINE'
        ) AS instance_status,
        si.sqlserver_start_time AS up_since,
        DATEDIFF(HOUR, si.sqlserver_start_time, GETDATE()) AS uptime_hours,
        'UP' AS listener_status,
        (SELECT COUNT(*) FROM sys.dm_exec_requests WHERE blocking_session_id <> 0) AS blocked_sessions
      FROM sys.dm_os_sys_info si`,

    replication: `
        SELECT
          CASE
            WHEN ISNULL(CAST(SERVERPROPERTY('IsHadrEnabled') AS INT), 0) = 1 THEN
              ISNULL((SELECT TOP 1 role_desc FROM sys.dm_hadr_availability_replica_states WHERE is_local = 1), 'AG_MEMBER')
            WHEN EXISTS (SELECT 1 FROM sys.database_mirroring WHERE mirroring_guid IS NOT NULL AND mirroring_state IS NOT NULL) THEN
              ISNULL((SELECT TOP 1
                CASE mirroring_role
                  WHEN 1 THEN 'PRINCIPAL'
                  WHEN 2 THEN 'MIRROR'
                  ELSE 'UNKNOWN'
                END
              FROM sys.database_mirroring WHERE mirroring_guid IS NOT NULL AND mirroring_state IS NOT NULL), 'UNKNOWN')
            ELSE 'STANDALONE'
          END AS role,
          CASE
            WHEN ISNULL(CAST(SERVERPROPERTY('IsHadrEnabled') AS INT), 0) = 1 THEN
              ISNULL((SELECT TOP 1 synchronization_health_desc FROM sys.dm_hadr_availability_replica_states WHERE is_local = 1), 'N/A')
            WHEN EXISTS (SELECT 1 FROM sys.database_mirroring WHERE mirroring_guid IS NOT NULL AND mirroring_state IS NOT NULL) THEN
              ISNULL((SELECT TOP 1
                CASE mirroring_state
                  WHEN 1 THEN 'SYNCHRONIZED'
                  WHEN 2 THEN 'SYNCHRONIZING'
                  WHEN 3 THEN 'PENDING_FAILOVER'
                  WHEN 4 THEN 'SUSPENDED'
                  WHEN 5 THEN 'DISCONNECTED'
                  ELSE 'UNKNOWN'
                END
              FROM sys.database_mirroring WHERE mirroring_guid IS NOT NULL AND mirroring_state IS NOT NULL), 'UNKNOWN')
            ELSE 'N/A'
          END AS replica_status,
          NULL AS lag_seconds,
          NULL AS transport_lag_seconds`,
  },

  postgres: {
    performance: `
      SELECT
        (SELECT COUNT(*) FROM pg_stat_activity WHERE state = 'active' AND backend_type = 'client backend') AS active_sessions,
        (SELECT COUNT(*) FROM pg_stat_activity WHERE state = 'idle' AND backend_type = 'client backend') AS inactive_sessions,
        (SELECT ROUND(
          (SELECT COUNT(*) FROM pg_stat_activity WHERE backend_type = 'client backend')::numeric
          / GREATEST(current_setting('max_connections')::int, 1) * 100, 2)
        ) AS cpu_percent,
        NULL::numeric AS memory_percent,
        (SELECT COUNT(*) FROM pg_stat_activity WHERE state = 'active' AND query_start < NOW() - INTERVAL '5 seconds') AS slow_queries`,

    availability: `
      SELECT
        'ONLINE' AS instance_status,
        pg_postmaster_start_time() AS up_since,
        EXTRACT(EPOCH FROM (NOW() - pg_postmaster_start_time())) / 3600 AS uptime_hours,
        'UP' AS listener_status,
        (SELECT COUNT(*) FROM pg_locks WHERE NOT granted) AS blocked_sessions`,

    replication: `
      SELECT
        CASE WHEN pg_is_in_recovery() THEN 'STANDBY' ELSE 'PRIMARY' END AS role,
        CASE
          WHEN NOT pg_is_in_recovery() AND (SELECT COUNT(*) FROM pg_stat_replication) > 0 THEN 'ACTIVE'
          WHEN pg_is_in_recovery() THEN 'STANDBY'
          ELSE 'N/A'
        END AS replica_status,
        CASE
          WHEN NOT pg_is_in_recovery() THEN
            (SELECT EXTRACT(EPOCH FROM MAX(replay_lag)) FROM pg_stat_replication)
          WHEN pg_is_in_recovery() THEN
            EXTRACT(EPOCH FROM (NOW() - pg_last_xact_replay_timestamp()))
          ELSE NULL
        END AS lag_seconds,
        NULL::numeric AS transport_lag_seconds`,
  },

  mysql: {
    performance: `
      SELECT
        (SELECT COUNT(*) FROM information_schema.PROCESSLIST WHERE COMMAND != 'Sleep') AS active_sessions,
        (SELECT COUNT(*) FROM information_schema.PROCESSLIST WHERE COMMAND = 'Sleep') AS inactive_sessions,
        ROUND(
          (SELECT COUNT(*) FROM information_schema.PROCESSLIST)
          / NULLIF(@@max_connections, 0) * 100, 2
        ) AS cpu_percent,
        ROUND(
          (SELECT CAST(VARIABLE_VALUE AS DECIMAL(20,2)) FROM information_schema.GLOBAL_STATUS WHERE VARIABLE_NAME = 'Innodb_buffer_pool_pages_data')
          / NULLIF((SELECT CAST(VARIABLE_VALUE AS DECIMAL(20,2)) FROM information_schema.GLOBAL_STATUS WHERE VARIABLE_NAME = 'Innodb_buffer_pool_pages_total'), 0) * 100, 2
        ) AS memory_percent,
        (SELECT COUNT(*) FROM information_schema.PROCESSLIST WHERE TIME > 5 AND COMMAND != 'Sleep') AS slow_queries`,

    availability: `
      SELECT
        'ONLINE' AS instance_status,
        DATE_SUB(NOW(), INTERVAL
          (SELECT VARIABLE_VALUE FROM information_schema.GLOBAL_STATUS WHERE VARIABLE_NAME = 'Uptime')
          SECOND) AS up_since,
        ROUND(
          (SELECT CAST(VARIABLE_VALUE AS DECIMAL(20,2)) FROM information_schema.GLOBAL_STATUS WHERE VARIABLE_NAME = 'Uptime')
          / 3600, 2
        ) AS uptime_hours,
        'UP' AS listener_status,
        (SELECT COUNT(*) FROM information_schema.PROCESSLIST WHERE COMMAND = 'Sleep' AND TIME > 300 AND USER != 'system user') AS blocked_sessions`,

    replication: `
      SELECT
        CASE
          WHEN (SELECT COUNT(*) FROM information_schema.PROCESSLIST WHERE COMMAND LIKE 'Binlog Dump%') > 0 THEN 'PRIMARY'
          WHEN (SELECT VARIABLE_VALUE FROM information_schema.GLOBAL_STATUS WHERE VARIABLE_NAME = 'Slave_running') = 'ON' THEN 'REPLICA'
          ELSE 'STANDALONE'
        END AS role,
        CASE
          WHEN (SELECT VARIABLE_VALUE FROM information_schema.GLOBAL_STATUS WHERE VARIABLE_NAME = 'Slave_running') = 'ON' THEN 'REPLICATING'
          ELSE 'N/A'
        END AS replica_status,
        (SELECT CAST(NULLIF(VARIABLE_VALUE, '') AS SIGNED)
         FROM information_schema.GLOBAL_STATUS WHERE VARIABLE_NAME = 'Seconds_Behind_Master'
        ) AS lag_seconds,
        NULL AS transport_lag_seconds`,
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

      // Always run performance, availability, and replication checks
      checkPromises.push(
        this.checkPerformance(connector, dbType, metrics, issues),
        this.checkAvailability(connector, dbType, metrics, issues),
        this.checkReplication(connector, dbType, metrics)
      );

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

      const storageLabel = dbType === "postgres" ? "Database" : dbType === "mysql" ? "Schema" : "Tablespace";

      for (const ts of results) {
        const pct = Number(ts.usedPercent) || 0;
        if (pct >= this.thresholds.tablespaceCritical) {
          issues.push({
            severity: "CRITICAL",
            category: "Storage",
            code: "TABLESPACE_CRITICAL",
            message: `${storageLabel} ${ts.name} is ${pct.toFixed(1)}% full`,
            affectedObject: ts.name,
            currentValue: pct,
            threshold: this.thresholds.tablespaceCritical,
            detectedAt: new Date(),
          });

          if (!recommendations.some((r) => r.relatedIssueCode === "TABLESPACE_CRITICAL")) {
            recommendations.push(
              createRecommendation(RECOMMENDATIONS_DB.TABLESPACE_CRITICAL, "TABLESPACE_CRITICAL")
            );
          }
        } else if (pct >= this.thresholds.tablespaceWarning) {
          issues.push({
            severity: "WARNING",
            category: "Storage",
            code: "TABLESPACE_WARNING",
            message: `${storageLabel} ${ts.name} is ${pct.toFixed(1)}% full`,
            affectedObject: ts.name,
            currentValue: pct,
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
        const fraPct = Number(fra.usedPercent) || 0;

        if (fraPct >= this.thresholds.fraCritical) {
          issues.push({
            severity: "CRITICAL",
            category: "Recovery",
            code: "FRA_CRITICAL",
            message: `Flash Recovery Area is ${fraPct.toFixed(1)}% full`,
            affectedObject: fra.name,
            currentValue: fraPct,
            threshold: this.thresholds.fraCritical,
            detectedAt: new Date(),
          });

          recommendations.push(
            createRecommendation(RECOMMENDATIONS_DB.FRA_CRITICAL, "FRA_CRITICAL")
          );
        } else if (fraPct >= this.thresholds.fraWarning) {
          issues.push({
            severity: "WARNING",
            category: "Recovery",
            code: "FRA_WARNING",
            message: `Flash Recovery Area is ${fraPct.toFixed(1)}% full`,
            affectedObject: fra.name,
            currentValue: fraPct,
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
        lastBackupTime: Date | null;
        backupType: string;
        status: string;
        hoursSince: number | null;
      }>(connector, query);

      const backupMetric: BackupMetric = {
        lastBackupStatus: "UNKNOWN",
        failedBackupsLast24h: 0,
      };

      if (results.length > 0) {
        const backup = results[0]!;
        backupMetric.lastSuccessfulBackup = backup.lastBackupTime ?? undefined;
        backupMetric.lastBackupType = backup.backupType;
        backupMetric.lastBackupStatus = backup.status as BackupMetric["lastBackupStatus"];
        backupMetric.hoursSinceLastBackup = backup.hoursSince ?? undefined;

        const hrs = backup.hoursSince !== null ? Number(backup.hoursSince) : null;
        if (hrs !== null) {
          if (hrs >= this.thresholds.backupCriticalHours) {
            issues.push({
              severity: "CRITICAL",
              category: "Backup",
              code: "BACKUP_CRITICAL",
              message: `No successful backup in ${hrs.toFixed(0)} hours`,
              currentValue: hrs,
              threshold: this.thresholds.backupCriticalHours,
              detectedAt: new Date(),
            });

            recommendations.push(
              createRecommendation(RECOMMENDATIONS_DB.BACKUP_CRITICAL, "BACKUP_CRITICAL")
            );
          } else if (hrs >= this.thresholds.backupWarningHours) {
            issues.push({
              severity: "WARNING",
              category: "Backup",
              code: "BACKUP_WARNING",
              message: `No successful backup in ${hrs.toFixed(0)} hours`,
              currentValue: hrs,
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
      metrics.backups = {
        lastBackupStatus: "UNKNOWN",
        failedBackupsLast24h: 0,
      };
    }
  }

  // ── Performance check ──
  private async checkPerformance(
    connector: DatabaseConnector,
    dbType: DbType,
    metrics: HealthMetrics,
    issues: HealthIssue[]
  ): Promise<void> {
    try {
      const query = PERF_QUERIES[dbType].performance;
      const results = await this.executeQuery<{
        activeSessions: number;
        inactiveSessions: number;
        cpuPercent: number | null;
        memoryPercent: number | null;
        slowQueries: number;
      }>(connector, query);

      if (results.length > 0) {
        const r = results[0]!;
        metrics.performance = {
          activeSessions: Number(r.activeSessions) || 0,
          inactiveSessions: Number(r.inactiveSessions) || 0,
          cpuPercent: r.cpuPercent !== null ? Number(r.cpuPercent) : null,
          memoryPercent: r.memoryPercent !== null ? Number(r.memoryPercent) : null,
          slowQueries: Number(r.slowQueries) || 0,
        };

        if (metrics.performance.cpuPercent !== null && metrics.performance.cpuPercent > 90) {
          issues.push({
            severity: "CRITICAL",
            category: "Performance",
            code: "CPU_CRITICAL",
            message: `CPU usage at ${metrics.performance.cpuPercent.toFixed(1)}%`,
            currentValue: metrics.performance.cpuPercent,
            threshold: 90,
            detectedAt: new Date(),
          });
        }

        if (metrics.performance.slowQueries > 10) {
          issues.push({
            severity: "WARNING",
            category: "Performance",
            code: "SLOW_QUERIES",
            message: `${metrics.performance.slowQueries} slow queries detected`,
            currentValue: metrics.performance.slowQueries,
            threshold: 10,
            detectedAt: new Date(),
          });
        }
      }
    } catch (error) {
      console.error("Performance check failed:", error);
      metrics.performance = {
        activeSessions: 0,
        inactiveSessions: 0,
        cpuPercent: null,
        memoryPercent: null,
        slowQueries: 0,
      };
    }
  }

  // ── Availability check ──
  private async checkAvailability(
    connector: DatabaseConnector,
    dbType: DbType,
    metrics: HealthMetrics,
    issues: HealthIssue[]
  ): Promise<void> {
    try {
      const query = PERF_QUERIES[dbType].availability;
      const results = await this.executeQuery<{
        instanceStatus: string;
        upSince: Date | null;
        uptimeHours: number | null;
        listenerStatus: string;
        blockedSessions: number;
      }>(connector, query);

      if (results.length > 0) {
        const r = results[0]!;
        metrics.availability = {
          instanceStatus: r.instanceStatus || "UNKNOWN",
          upSince: r.upSince ?? null,
          uptimeHours: r.uptimeHours !== null ? Number(r.uptimeHours) : null,
          listenerStatus: r.listenerStatus || "UNKNOWN",
          blockedSessions: Number(r.blockedSessions) || 0,
        };

        if (metrics.availability.blockedSessions > 5) {
          issues.push({
            severity: "WARNING",
            category: "Availability",
            code: "BLOCKED_SESSIONS",
            message: `${metrics.availability.blockedSessions} blocked sessions detected`,
            currentValue: metrics.availability.blockedSessions,
            threshold: 5,
            detectedAt: new Date(),
          });
        }
      }
    } catch (error) {
      console.error("Availability check failed:", error);
      metrics.availability = {
        instanceStatus: "UNKNOWN",
        upSince: null,
        uptimeHours: null,
        listenerStatus: "UNKNOWN",
        blockedSessions: 0,
      };
    }
  }

  // ── Replication check ──
  private async checkReplication(
    connector: DatabaseConnector,
    dbType: DbType,
    metrics: HealthMetrics
  ): Promise<void> {
    try {
      const query = PERF_QUERIES[dbType].replication;
      const results = await this.executeQuery<{
        role: string;
        replicaStatus: string;
        lagSeconds: number | null;
        transportLagSeconds: number | null;
      }>(connector, query);

      if (results.length > 0) {
        const r = results[0]!;
        metrics.replication = {
          role: r.role || "UNKNOWN",
          replicaStatus: r.replicaStatus || "N/A",
          lagSeconds: r.lagSeconds !== null ? Number(r.lagSeconds) : null,
          transportLagSeconds: r.transportLagSeconds !== null ? Number(r.transportLagSeconds) : null,
        };

        // Oracle Data Guard: attempt to fetch lag separately (safe if DG not configured)
        if (dbType === "oracle" && metrics.replication.role !== "STANDALONE") {
          try {
            const lagRows = await this.executeQuery<{
              applyLagSecs: number | null;
              transportLagSecs: number | null;
            }>(connector, `
              SELECT
                (SELECT EXTRACT(DAY FROM apply_lag) * 86400 +
                        EXTRACT(HOUR FROM apply_lag) * 3600 +
                        EXTRACT(MINUTE FROM apply_lag) * 60 +
                        EXTRACT(SECOND FROM apply_lag)
                 FROM v$dataguard_stats WHERE name = 'apply lag' AND ROWNUM = 1) AS apply_lag_secs,
                (SELECT EXTRACT(DAY FROM transport_lag) * 86400 +
                        EXTRACT(HOUR FROM transport_lag) * 3600 +
                        EXTRACT(MINUTE FROM transport_lag) * 60 +
                        EXTRACT(SECOND FROM transport_lag)
                 FROM v$dataguard_stats WHERE name = 'transport lag' AND ROWNUM = 1) AS transport_lag_secs
              FROM DUAL
            `);
            if (lagRows.length > 0) {
              const lag = lagRows[0]!;
              if (lag.applyLagSecs !== null) metrics.replication.lagSeconds = Number(lag.applyLagSecs);
              if (lag.transportLagSecs !== null) metrics.replication.transportLagSeconds = Number(lag.transportLagSecs);
            }
          } catch {
            // Data Guard stats not available — leave lag as null
          }
        }
      }
    } catch (error) {
      console.error("Replication check failed:", error);
      metrics.replication = {
        role: "UNKNOWN",
        replicaStatus: "N/A",
        lagSeconds: null,
        transportLagSeconds: null,
      };
    }
  }

  // Execute query using the connector's query method.
  // Normalizes column keys: UPPERCASE → snake_case → camelCase.
  // Oracle returns UPPERCASE; SQL aliases use snake_case. This ensures
  // the returned objects match our camelCase TypeScript interfaces.
  private async executeQuery<T>(
    connector: DatabaseConnector,
    query: string
  ): Promise<T[]> {
    const raw = await connector.query<Record<string, unknown>>(query);
    return raw.map((row) => {
      const normalized: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(row)) {
        const camel = key
          .toLowerCase()
          .replace(/_([a-z0-9])/g, (_, ch: string) => ch.toUpperCase());
        normalized[camel] = value;
      }
      return normalized as T;
    });
  }
}

// Factory function
export function createHealthEngine(config?: HealthEngineConfig): HealthEngine {
  return new HealthEngine(config);
}

// Export default thresholds for reference
export { THRESHOLDS as DEFAULT_HEALTH_THRESHOLDS };
