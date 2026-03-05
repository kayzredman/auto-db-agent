import type { DbType, DatabaseConnector } from "../connectors/types";

// ─── Risk Levels ────────────────────────────────────────────────────────────
export type FRARisk = "CRITICAL" | "HIGH" | "WARNING" | "OK";

// OEM-aligned thresholds
const DEFAULT_THRESHOLDS = {
  /** FRA usage % that triggers WARNING */
  usageWarning: 80,
  /** FRA usage % that triggers HIGH risk */
  usageHigh: 85,
  /** FRA usage % that triggers CRITICAL */
  usageCritical: 90,
  /** Daily generation growth % over average that triggers concern */
  growthDeviationWarning: 30,
  growthDeviationHigh: 60,
  growthDeviationCritical: 90,
  /** Hours without archive/log backups that triggers risk */
  archiveBackupWarningHours: 12,
  archiveBackupHighHours: 24,
  archiveBackupCriticalHours: 48,
} as const;

// ─── Types ──────────────────────────────────────────────────────────────────

export interface FRARiskIssue {
  severity: FRARisk;
  code: string;
  category: string;
  message: string;
  currentValue: number | string;
  threshold: number | string;
  detectedAt: Date;
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
  /** Name of the recovery area / log destination */
  name: string;
  /** Total capacity in bytes */
  totalBytes: number;
  /** Used space in bytes */
  usedBytes: number;
  /** Usage percentage */
  usedPercent: number;
  /** Reclaimable space in bytes (Oracle FRA only, 0 for others) */
  reclaimableBytes: number;
  /** Free space in bytes (including reclaimable) */
  effectiveFreeBytes: number;
}

export interface ArchiveGenerationMetrics {
  /** Average daily archive/log generation in bytes over the analysis window */
  avgDailyGenerationBytes: number;
  /** Today's generation in bytes so far */
  todayGenerationBytes: number;
  /** Deviation % of today vs average (positive = above average) */
  deviationPercent: number;
  /** Number of days of data analyzed */
  analysisDays: number;
  /** Daily breakdown */
  dailyBreakdown: DailyGeneration[];
}

export interface DailyGeneration {
  date: Date;
  generationBytes: number;
}

export interface FlashbackMetrics {
  /** Whether flashback is enabled */
  enabled: boolean;
  /** Current retention target in minutes */
  retentionMinutes: number;
  /** Oldest flashback time available */
  oldestFlashbackTime: Date | null;
  /** Estimated space needed for current retention in bytes */
  estimatedSpaceBytes: number;
}

export interface FRARiskReport {
  instanceId: string;
  dbType: DbType;
  analyzedAt: Date;
  recoveryArea: RecoveryAreaMetrics | null;
  archiveGeneration: ArchiveGenerationMetrics | null;
  flashback: FlashbackMetrics | null;
  issues: FRARiskIssue[];
  recommendations: FRARiskRecommendation[];
  overallRisk: FRARisk;
}

export interface FRARiskEngineConfig {
  thresholds?: Partial<typeof DEFAULT_THRESHOLDS>;
  /** Number of days of archive generation history to analyze (default: 7) */
  analysisDays?: number;
}

export const DEFAULT_FRA_THRESHOLDS = { ...DEFAULT_THRESHOLDS } as const;

// ─── DB-specific Queries ────────────────────────────────────────────────────

const FRA_QUERIES: Record<DbType, {
  recoveryArea: string;
  archiveGeneration: string;
  todayGeneration: string;
  flashback: string;
}> = {
  oracle: {
    // Oracle Flash Recovery Area usage
    recoveryArea: `
      SELECT
        name,
        space_limit AS total_bytes,
        space_used AS used_bytes,
        ROUND(space_used / NULLIF(space_limit, 0) * 100, 2) AS used_percent,
        space_reclaimable AS reclaimable_bytes
      FROM v$recovery_file_dest`,

    // Daily archive log generation over last N days
    archiveGeneration: `
      SELECT
        TRUNC(completion_time) AS gen_date,
        SUM(blocks * block_size) AS generation_bytes
      FROM v$archived_log
      WHERE completion_time >= TRUNC(SYSDATE) - :days
        AND dest_id = 1
      GROUP BY TRUNC(completion_time)
      ORDER BY gen_date ASC`,

    // Today's archive generation
    todayGeneration: `
      SELECT
        NVL(SUM(blocks * block_size), 0) AS generation_bytes
      FROM v$archived_log
      WHERE completion_time >= TRUNC(SYSDATE)
        AND dest_id = 1`,

    // Flashback database status
    flashback: `
      SELECT
        flashback_on AS enabled,
        NVL(retention_target, 0) AS retention_minutes,
        oldest_flashback_time,
        NVL(estimated_flashback_size, 0) AS estimated_space_bytes
      FROM v$database d
      LEFT JOIN v$flashback_database_stat f ON 1=1
      LEFT JOIN v$flashback_database_log fl ON 1=1
      WHERE ROWNUM = 1`,
  },

  mssql: {
    // SQL Server transaction log space (equivalent to FRA)
    recoveryArea: `
      SELECT
        DB_NAME() AS name,
        SUM(CAST(size AS BIGINT)) * 8192 AS total_bytes,
        SUM(CAST(FILEPROPERTY(name, 'SpaceUsed') AS BIGINT)) * 8192 AS used_bytes,
        ROUND(
          CAST(SUM(CAST(FILEPROPERTY(name, 'SpaceUsed') AS FLOAT)) AS FLOAT) /
          NULLIF(SUM(CAST(size AS FLOAT)), 0) * 100, 2
        ) AS used_percent,
        0 AS reclaimable_bytes
      FROM sys.database_files
      WHERE type = 1`,

    // Daily transaction log backup sizes (approximates log generation)
    archiveGeneration: `
      SELECT
        CAST(backup_finish_date AS DATE) AS gen_date,
        SUM(backup_size) AS generation_bytes
      FROM msdb.dbo.backupset
      WHERE type = 'L'
        AND database_name = DB_NAME()
        AND backup_finish_date >= DATEADD(DAY, -@days, CAST(GETDATE() AS DATE))
      GROUP BY CAST(backup_finish_date AS DATE)
      ORDER BY gen_date ASC`,

    // Today's log backup generation
    todayGeneration: `
      SELECT
        ISNULL(SUM(backup_size), 0) AS generation_bytes
      FROM msdb.dbo.backupset
      WHERE type = 'L'
        AND database_name = DB_NAME()
        AND backup_finish_date >= CAST(GETDATE() AS DATE)`,

    // No flashback equivalent in SQL Server
    flashback: `
      SELECT
        0 AS enabled,
        0 AS retention_minutes,
        NULL AS oldest_flashback_time,
        0 AS estimated_space_bytes
      WHERE 1=0`,
  },

  postgres: {
    // PostgreSQL WAL archiving disk usage (pg_wal directory)
    recoveryArea: `
      SELECT
        'pg_wal' AS name,
        (SELECT setting::bigint * 1024 * 1024 FROM pg_settings WHERE name = 'max_wal_size') AS total_bytes,
        pg_wal_lsn_diff(pg_current_wal_lsn(), '0/0') AS used_bytes,
        ROUND(
          pg_wal_lsn_diff(pg_current_wal_lsn(), '0/0')::numeric /
          NULLIF((SELECT setting::bigint * 1024 * 1024 FROM pg_settings WHERE name = 'max_wal_size'), 0) * 100,
          2
        ) AS used_percent,
        0 AS reclaimable_bytes`,

    // Daily WAL generation (from pg_stat_archiver stats reset)
    archiveGeneration: `
      SELECT
        DATE(started_at) AS gen_date,
        COALESCE(SUM(size_mb * 1024 * 1024), 0)::bigint AS generation_bytes
      FROM backup_history
      WHERE backup_type = 'WAL'
        AND started_at >= CURRENT_DATE - $1::int
      GROUP BY DATE(started_at)
      ORDER BY gen_date ASC`,

    // Today's WAL (approximate from archived count)
    todayGeneration: `
      SELECT
        COALESCE(
          (SELECT SUM(size_mb * 1024 * 1024) FROM backup_history
           WHERE backup_type = 'WAL' AND started_at >= CURRENT_DATE),
          0
        )::bigint AS generation_bytes`,

    // No flashback equivalent in PostgreSQL
    flashback: `
      SELECT
        0 AS enabled,
        0 AS retention_minutes,
        NULL::timestamp AS oldest_flashback_time,
        0 AS estimated_space_bytes
      WHERE false`,
  },

  mysql: {
    // MySQL binary log space
    recoveryArea: `
      SELECT
        'binlog' AS name,
        @@max_binlog_size * (SELECT COUNT(*) FROM information_schema.PROCESSLIST WHERE 1=1) AS total_bytes,
        IFNULL((
          SELECT SUM(FILE_SIZE)
          FROM information_schema.FILES
          WHERE FILE_TYPE = 'REDO LOG'
        ), 0) AS used_bytes,
        0 AS used_percent,
        0 AS reclaimable_bytes`,

    // Daily binary log generation (from our internal backup_history table)
    archiveGeneration: `
      SELECT
        DATE(started_at) AS gen_date,
        COALESCE(SUM(size_mb * 1024 * 1024), 0) AS generation_bytes
      FROM backup_history
      WHERE backup_type = 'BINLOG'
        AND started_at >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
      GROUP BY DATE(started_at)
      ORDER BY gen_date ASC`,

    // Today's binary log generation
    todayGeneration: `
      SELECT
        IFNULL(
          (SELECT SUM(size_mb * 1024 * 1024) FROM backup_history
           WHERE backup_type = 'BINLOG' AND started_at >= CURDATE()),
          0
        ) AS generation_bytes`,

    // No flashback equivalent in MySQL
    flashback: `
      SELECT
        0 AS enabled,
        0 AS retention_minutes,
        NULL AS oldest_flashback_time,
        0 AS estimated_space_bytes
      FROM DUAL WHERE 1=0`,
  },
};

// ─── Recommendations DB ─────────────────────────────────────────────────────

type RecTemplate = Omit<FRARiskRecommendation, "relatedIssueCode">;

const RECOMMENDATIONS: Record<string, RecTemplate> = {
  FRA_CRITICAL: {
    priority: "HIGH",
    category: "Recovery Area",
    title: "Critical Recovery Area Usage",
    description: "Recovery area usage exceeds 90%, risking archive log writes and backup failures.",
    action: "Immediately backup and delete obsolete archive logs. Increase FRA size or configure retention policy.",
    reference: "Oracle MOS Doc ID 1353616.1 - FRA Best Practices",
  },
  FRA_HIGH: {
    priority: "HIGH",
    category: "Recovery Area",
    title: "High Recovery Area Usage",
    description: "Recovery area usage exceeds 85%. Backup failures and archive log gaps may occur.",
    action: "Schedule maintenance to delete obsolete backups. Review backup retention policy and consider increasing FRA size.",
    reference: "Oracle MOS Doc ID 1353616.1 - FRA Best Practices",
  },
  FRA_WARNING: {
    priority: "MEDIUM",
    category: "Recovery Area",
    title: "Recovery Area Approaching Capacity",
    description: "Recovery area usage exceeds 80%. Monitor closely and plan cleanup.",
    action: "Review RMAN retention policy. Schedule obsolete backup deletion. Plan for capacity increase.",
    reference: "Oracle MOS Doc ID 1353616.1 - FRA Best Practices",
  },
  ARCHIVE_GROWTH_CRITICAL: {
    priority: "HIGH",
    category: "Archive Generation",
    title: "Abnormal Archive/Log Generation",
    description: "Today's log generation is significantly above the 7-day average, indicating potential issues.",
    action: "Investigate for bulk operations, long-running transactions, or abnormal DML. Check for missing log backups.",
    reference: "Oracle MOS Doc ID 461280.1 - Archive Log Management",
  },
  ARCHIVE_GROWTH_HIGH: {
    priority: "HIGH",
    category: "Archive Generation",
    title: "Elevated Archive/Log Generation",
    description: "Log generation is significantly above average, which may fill recovery area faster than expected.",
    action: "Monitor recovery area capacity. Increase log backup frequency if needed.",
    reference: "Oracle MOS Doc ID 461280.1 - Archive Log Management",
  },
  ARCHIVE_GROWTH_WARNING: {
    priority: "MEDIUM",
    category: "Archive Generation",
    title: "Above-Average Archive/Log Generation",
    description: "Log generation is above the rolling average. Monitor for sustained increases.",
    action: "Review recent DML activity. Consider increasing log backup frequency during peak periods.",
    reference: "Oracle MOS Doc ID 461280.1 - Archive Log Management",
  },
  FLASHBACK_RISK: {
    priority: "HIGH",
    category: "Flashback",
    title: "Flashback Retention At Risk",
    description: "Insufficient recovery area space to maintain the configured flashback retention target.",
    action: "Increase FRA size, reduce flashback retention target, or clean up obsolete backups.",
    reference: "Oracle MOS Doc ID 565535.1 - Flashback Database Best Practices",
  },
  FRA_FILL_CRITICAL: {
    priority: "HIGH",
    category: "Recovery Area",
    title: "Recovery Area Estimated Full Soon",
    description: "At current generation rates, the recovery area will fill within the critical threshold.",
    action: "Immediately increase FRA size or archive log backup frequency. Delete obsolete files.",
    reference: "Oracle MOS Doc ID 1353616.1 - FRA Best Practices",
  },
};

// ─── Helpers ────────────────────────────────────────────────────────────────

function normalizeRow<T>(raw: Record<string, unknown>): T {
  const normalized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) {
    normalized[key.toLowerCase()] = value;
  }
  return normalized as T;
}

function classifyUsageRisk(
  usedPercent: number,
  thresholds: typeof DEFAULT_THRESHOLDS
): FRARisk {
  if (usedPercent >= thresholds.usageCritical) return "CRITICAL";
  if (usedPercent >= thresholds.usageHigh) return "HIGH";
  if (usedPercent >= thresholds.usageWarning) return "WARNING";
  return "OK";
}

function classifyGrowthRisk(
  deviationPercent: number,
  thresholds: typeof DEFAULT_THRESHOLDS
): FRARisk {
  if (deviationPercent >= thresholds.growthDeviationCritical) return "CRITICAL";
  if (deviationPercent >= thresholds.growthDeviationHigh) return "HIGH";
  if (deviationPercent >= thresholds.growthDeviationWarning) return "WARNING";
  return "OK";
}

function highestRisk(risks: FRARisk[]): FRARisk {
  const order: FRARisk[] = ["CRITICAL", "HIGH", "WARNING", "OK"];
  for (const level of order) {
    if (risks.includes(level)) return level;
  }
  return "OK";
}

function makeRec(code: string): FRARiskRecommendation {
  const tpl = RECOMMENDATIONS[code];
  if (!tpl) throw new Error(`Unknown recommendation code: ${code}`);
  return { ...tpl, relatedIssueCode: code };
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(Math.abs(bytes)) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(2)} ${units[i]}`;
}

// ─── Row Types ──────────────────────────────────────────────────────────────

type RecoveryAreaRow = {
  name: string;
  total_bytes: number | string | null;
  used_bytes: number | string | null;
  used_percent: number | string | null;
  reclaimable_bytes: number | string | null;
};

type GenerationRow = {
  gen_date: Date | string;
  generation_bytes: number | string;
};

type TodayGenRow = {
  generation_bytes: number | string;
};

type FlashbackRow = {
  enabled: boolean | number | string;
  retention_minutes: number | string;
  oldest_flashback_time: Date | string | null;
  estimated_space_bytes: number | string;
};

// ─── Engine ─────────────────────────────────────────────────────────────────

export class FRARiskEngine {
  private readonly analysisDays: number;
  private readonly thresholds: typeof DEFAULT_THRESHOLDS;

  constructor(config?: FRARiskEngineConfig) {
    this.analysisDays = config?.analysisDays ?? 7;
    this.thresholds = {
      ...DEFAULT_THRESHOLDS,
      ...config?.thresholds,
    };
  }

  public async analyze(
    instanceId: string,
    dbType: DbType,
    connector: DatabaseConnector
  ): Promise<FRARiskReport> {
    const analyzedAt = new Date();
    const issues: FRARiskIssue[] = [];
    const recommendations: FRARiskRecommendation[] = [];
    const risks: FRARisk[] = [];

    // 1. Recovery area usage
    const recoveryArea = await this.fetchRecoveryArea(connector, dbType);

    if (recoveryArea) {
      const usageRisk = classifyUsageRisk(recoveryArea.usedPercent, this.thresholds);
      risks.push(usageRisk);

      if (usageRisk !== "OK") {
        const code = `FRA_${usageRisk}`;
        issues.push({
          severity: usageRisk,
          code,
          category: "Recovery Area",
          message: `Recovery area "${recoveryArea.name}" is ${recoveryArea.usedPercent.toFixed(1)}% full (${formatBytes(recoveryArea.usedBytes)} / ${formatBytes(recoveryArea.totalBytes)})`,
          currentValue: recoveryArea.usedPercent,
          threshold: usageRisk === "CRITICAL"
            ? this.thresholds.usageCritical
            : usageRisk === "HIGH"
            ? this.thresholds.usageHigh
            : this.thresholds.usageWarning,
          detectedAt: analyzedAt,
        });
        recommendations.push(makeRec(code));
      }
    }

    // 2. Archive/log generation analysis
    const archiveGeneration = await this.fetchArchiveGeneration(connector, dbType);

    if (archiveGeneration && archiveGeneration.avgDailyGenerationBytes > 0) {
      const growthRisk = classifyGrowthRisk(archiveGeneration.deviationPercent, this.thresholds);
      risks.push(growthRisk);

      if (growthRisk !== "OK") {
        const code = `ARCHIVE_GROWTH_${growthRisk}`;
        issues.push({
          severity: growthRisk,
          code,
          category: "Archive Generation",
          message: `Today's log generation (${formatBytes(archiveGeneration.todayGenerationBytes)}) is ${archiveGeneration.deviationPercent.toFixed(1)}% above the ${this.analysisDays}-day average (${formatBytes(archiveGeneration.avgDailyGenerationBytes)}/day)`,
          currentValue: `${archiveGeneration.deviationPercent.toFixed(1)}%`,
          threshold: `${growthRisk === "CRITICAL"
            ? this.thresholds.growthDeviationCritical
            : growthRisk === "HIGH"
            ? this.thresholds.growthDeviationHigh
            : this.thresholds.growthDeviationWarning}%`,
          detectedAt: analyzedAt,
        });
        recommendations.push(makeRec(code));
      }

      // Estimate time to fill recovery area
      if (recoveryArea && archiveGeneration.avgDailyGenerationBytes > 0) {
        const daysToFill = recoveryArea.effectiveFreeBytes / archiveGeneration.avgDailyGenerationBytes;
        if (daysToFill < 3) {
          risks.push("CRITICAL");
          issues.push({
            severity: "CRITICAL",
            code: "FRA_FILL_CRITICAL",
            category: "Recovery Area",
            message: `Recovery area estimated full in ${daysToFill.toFixed(1)} days at current archive generation rate`,
            currentValue: `${daysToFill.toFixed(1)} days`,
            threshold: "3 days",
            detectedAt: analyzedAt,
          });
          recommendations.push(makeRec("FRA_FILL_CRITICAL"));
        }
      }
    }

    // 3. Flashback analysis (Oracle-specific primarily)
    const flashback = await this.fetchFlashback(connector, dbType);

    if (flashback && flashback.enabled && recoveryArea) {
      // Check if FRA has enough space for flashback retention
      if (flashback.estimatedSpaceBytes > recoveryArea.effectiveFreeBytes) {
        risks.push("HIGH");
        issues.push({
          severity: "HIGH",
          code: "FLASHBACK_RISK",
          category: "Flashback",
          message: `Flashback retention requires ${formatBytes(flashback.estimatedSpaceBytes)} but only ${formatBytes(recoveryArea.effectiveFreeBytes)} available in recovery area`,
          currentValue: formatBytes(recoveryArea.effectiveFreeBytes),
          threshold: formatBytes(flashback.estimatedSpaceBytes),
          detectedAt: analyzedAt,
        });
        recommendations.push(makeRec("FLASHBACK_RISK"));
      }
    }

    return {
      instanceId,
      dbType,
      analyzedAt,
      recoveryArea,
      archiveGeneration,
      flashback,
      issues,
      recommendations,
      overallRisk: highestRisk(risks),
    };
  }

  // ── Data Fetchers ───────────────────────────────────────────────────────

  private async fetchRecoveryArea(
    connector: DatabaseConnector,
    dbType: DbType
  ): Promise<RecoveryAreaMetrics | null> {
    try {
      const sql = FRA_QUERIES[dbType].recoveryArea;
      const rawRows = await connector.query<Record<string, unknown>>(sql);
      if (rawRows.length === 0) return null;

      const row = normalizeRow<RecoveryAreaRow>(rawRows[0]!);
      const totalBytes = Number(row.total_bytes) || 0;
      const usedBytes = Number(row.used_bytes) || 0;
      const reclaimableBytes = Number(row.reclaimable_bytes) || 0;

      return {
        name: String(row.name || "recovery_area"),
        totalBytes,
        usedBytes,
        usedPercent: Number(row.used_percent) || (totalBytes > 0 ? (usedBytes / totalBytes) * 100 : 0),
        reclaimableBytes,
        effectiveFreeBytes: Math.max(totalBytes - usedBytes + reclaimableBytes, 0),
      };
    } catch {
      return null;
    }
  }

  private async fetchArchiveGeneration(
    connector: DatabaseConnector,
    dbType: DbType
  ): Promise<ArchiveGenerationMetrics | null> {
    try {
      // Daily breakdown
      const genSql = FRA_QUERIES[dbType].archiveGeneration;
      const rawRows = await connector.query<Record<string, unknown>>(
        genSql,
        [this.analysisDays]
      );
      const dailyBreakdown: DailyGeneration[] = rawRows.map((raw) => {
        const row = normalizeRow<GenerationRow>(raw);
        return {
          date: row.gen_date instanceof Date ? row.gen_date : new Date(row.gen_date as string),
          generationBytes: Number(row.generation_bytes) || 0,
        };
      });

      // Today's generation
      const todaySql = FRA_QUERIES[dbType].todayGeneration;
      const todayRows = await connector.query<Record<string, unknown>>(todaySql);
      const todayRow = todayRows.length > 0 ? normalizeRow<TodayGenRow>(todayRows[0]!) : null;
      const todayGenerationBytes = todayRow ? Number(todayRow.generation_bytes) || 0 : 0;

      // Calculate average
      const totalGeneration = dailyBreakdown.reduce((sum, d) => sum + d.generationBytes, 0);
      const avgDailyGenerationBytes = dailyBreakdown.length > 0
        ? totalGeneration / dailyBreakdown.length
        : 0;

      // Deviation
      const deviationPercent = avgDailyGenerationBytes > 0
        ? ((todayGenerationBytes - avgDailyGenerationBytes) / avgDailyGenerationBytes) * 100
        : 0;

      return {
        avgDailyGenerationBytes,
        todayGenerationBytes,
        deviationPercent: Math.max(deviationPercent, 0), // Only care about above-average
        analysisDays: this.analysisDays,
        dailyBreakdown,
      };
    } catch {
      return null;
    }
  }

  private async fetchFlashback(
    connector: DatabaseConnector,
    dbType: DbType
  ): Promise<FlashbackMetrics | null> {
    try {
      // Only Oracle has real flashback
      if (dbType !== "oracle") return null;

      const sql = FRA_QUERIES[dbType].flashback;
      const rawRows = await connector.query<Record<string, unknown>>(sql);
      if (rawRows.length === 0) return null;

      const row = normalizeRow<FlashbackRow>(rawRows[0]!);
      const enabled = row.enabled === true || row.enabled === "YES" || row.enabled === 1;

      return {
        enabled,
        retentionMinutes: Number(row.retention_minutes) || 0,
        oldestFlashbackTime: row.oldest_flashback_time
          ? (row.oldest_flashback_time instanceof Date
            ? row.oldest_flashback_time
            : new Date(row.oldest_flashback_time as string))
          : null,
        estimatedSpaceBytes: Number(row.estimated_space_bytes) || 0,
      };
    } catch {
      return null;
    }
  }

  // ── Snapshot Recorder ────────────────────────────────────────────────────

  /**
   * Record a FRA snapshot into the internal metrics DB.
   * Call daily for trending.
   */
  public async recordSnapshot(
    instanceId: string,
    dbType: DbType,
    connector: DatabaseConnector,
    metricsPool: { query(sql: string, params?: unknown[]): Promise<{ rows: unknown[] }> }
  ): Promise<boolean> {
    const recoveryArea = await this.fetchRecoveryArea(connector, dbType);
    if (!recoveryArea) return false;

    const insertSql = `
      INSERT INTO fra_snapshots (instance_id, area_name, used_bytes, total_bytes, reclaimable_bytes, snapshot_date)
      VALUES ($1, $2, $3, $4, $5, CURRENT_DATE)
      ON CONFLICT (instance_id, area_name, snapshot_date) DO UPDATE
        SET used_bytes = EXCLUDED.used_bytes,
            total_bytes = EXCLUDED.total_bytes,
            reclaimable_bytes = EXCLUDED.reclaimable_bytes`;

    await metricsPool.query(insertSql, [
      instanceId,
      recoveryArea.name,
      recoveryArea.usedBytes,
      recoveryArea.totalBytes,
      recoveryArea.reclaimableBytes,
    ]);

    return true;
  }
}

// ─── Factory ────────────────────────────────────────────────────────────────

export function createFRARiskEngine(config?: FRARiskEngineConfig): FRARiskEngine {
  return new FRARiskEngine(config);
}
