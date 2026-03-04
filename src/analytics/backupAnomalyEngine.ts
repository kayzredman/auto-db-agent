import type { DbType, DatabaseConnector } from "../connectors/types";

// Anomaly severity levels
export type AnomalySeverity = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

// Deviation thresholds for severity classification
const DEVIATION_THRESHOLDS = {
  low: 40,      // 40-60% deviation
  medium: 60,   // 60-80% deviation
  high: 80,     // 80-94% deviation
  critical: 95  // 95%+ deviation
} as const;

export interface BackupAnomaly {
  severity: AnomalySeverity;
  metricName: string;
  currentValue: number;
  expectedValue: number;
  deviationPercent: number;
  direction: "above" | "below";
  message: string;
  detectedAt: Date;
}

export interface BackupStats {
  date: Date;
  backupCount: number;
  totalSizeMb: number;
  avgDurationSeconds: number;
  successCount: number;
  failureCount: number;
}

export interface BackupAnomalyReport {
  instanceId: string;
  dbType: DbType;
  analyzedAt: Date;
  analysisPeriodDays: number;
  todayStats: BackupStats | null;
  historicalAvg: BackupStats | null;
  anomalies: BackupAnomaly[];
  overallSeverity: AnomalySeverity | "OK";
}

// SQL queries for backup statistics
const BACKUP_STATS_QUERIES = {
  oracle: {
    // Get daily backup stats for the last N days
    dailyStats: `
      SELECT 
        TRUNC(completion_time) AS backup_date,
        COUNT(*) AS backup_count,
        SUM(output_bytes) / 1024 / 1024 AS total_size_mb,
        AVG(EXTRACT(DAY FROM (end_time - start_time)) * 86400 +
            EXTRACT(HOUR FROM (end_time - start_time)) * 3600 +
            EXTRACT(MINUTE FROM (end_time - start_time)) * 60 +
            EXTRACT(SECOND FROM (end_time - start_time))) AS avg_duration_seconds,
        SUM(CASE WHEN status = 'COMPLETED' THEN 1 ELSE 0 END) AS success_count,
        SUM(CASE WHEN status != 'COMPLETED' THEN 1 ELSE 0 END) AS failure_count
      FROM v$rman_backup_job_details
      WHERE completion_time >= TRUNC(SYSDATE) - :days
        AND input_type IN ('DB FULL', 'DB INCR', 'ARCHIVELOG')
      GROUP BY TRUNC(completion_time)
      ORDER BY backup_date DESC`,

    todayStats: `
      SELECT 
        TRUNC(SYSDATE) AS backup_date,
        COUNT(*) AS backup_count,
        NVL(SUM(output_bytes) / 1024 / 1024, 0) AS total_size_mb,
        NVL(AVG(EXTRACT(DAY FROM (end_time - start_time)) * 86400 +
            EXTRACT(HOUR FROM (end_time - start_time)) * 3600 +
            EXTRACT(MINUTE FROM (end_time - start_time)) * 60 +
            EXTRACT(SECOND FROM (end_time - start_time))), 0) AS avg_duration_seconds,
        SUM(CASE WHEN status = 'COMPLETED' THEN 1 ELSE 0 END) AS success_count,
        SUM(CASE WHEN status != 'COMPLETED' THEN 1 ELSE 0 END) AS failure_count
      FROM v$rman_backup_job_details
      WHERE completion_time >= TRUNC(SYSDATE)
        AND input_type IN ('DB FULL', 'DB INCR', 'ARCHIVELOG')`,
  },

  mssql: {
    dailyStats: `
      SELECT 
        CAST(backup_finish_date AS DATE) AS backup_date,
        COUNT(*) AS backup_count,
        SUM(backup_size) / 1024.0 / 1024.0 AS total_size_mb,
        AVG(DATEDIFF(SECOND, backup_start_date, backup_finish_date)) AS avg_duration_seconds,
        SUM(CASE WHEN backup_finish_date IS NOT NULL THEN 1 ELSE 0 END) AS success_count,
        SUM(CASE WHEN backup_finish_date IS NULL THEN 1 ELSE 0 END) AS failure_count
      FROM msdb.dbo.backupset
      WHERE backup_finish_date >= DATEADD(DAY, -@days, CAST(GETDATE() AS DATE))
        AND database_name = DB_NAME()
      GROUP BY CAST(backup_finish_date AS DATE)
      ORDER BY backup_date DESC`,

    todayStats: `
      SELECT 
        CAST(GETDATE() AS DATE) AS backup_date,
        COUNT(*) AS backup_count,
        ISNULL(SUM(backup_size) / 1024.0 / 1024.0, 0) AS total_size_mb,
        ISNULL(AVG(DATEDIFF(SECOND, backup_start_date, backup_finish_date)), 0) AS avg_duration_seconds,
        SUM(CASE WHEN backup_finish_date IS NOT NULL THEN 1 ELSE 0 END) AS success_count,
        SUM(CASE WHEN backup_finish_date IS NULL THEN 1 ELSE 0 END) AS failure_count
      FROM msdb.dbo.backupset
      WHERE backup_finish_date >= CAST(GETDATE() AS DATE)
        AND database_name = DB_NAME()`,
  },

  postgres: {
    // PostgreSQL uses pg_stat_archiver for WAL archiving stats
    // For actual backups, we'd need to query our internal backup_history table
    dailyStats: `
      SELECT 
        DATE(started_at) AS backup_date,
        COUNT(*) AS backup_count,
        COALESCE(SUM(size_mb), 0) AS total_size_mb,
        COALESCE(AVG(duration_seconds), 0) AS avg_duration_seconds,
        SUM(CASE WHEN status = 'SUCCESS' THEN 1 ELSE 0 END) AS success_count,
        SUM(CASE WHEN status != 'SUCCESS' THEN 1 ELSE 0 END) AS failure_count
      FROM backup_history
      WHERE started_at >= CURRENT_DATE - INTERVAL '1 day' * $1
        AND source_system = $2
      GROUP BY DATE(started_at)
      ORDER BY backup_date DESC`,

    todayStats: `
      SELECT 
        CURRENT_DATE AS backup_date,
        COUNT(*) AS backup_count,
        COALESCE(SUM(size_mb), 0) AS total_size_mb,
        COALESCE(AVG(duration_seconds), 0) AS avg_duration_seconds,
        SUM(CASE WHEN status = 'SUCCESS' THEN 1 ELSE 0 END) AS success_count,
        SUM(CASE WHEN status != 'SUCCESS' THEN 1 ELSE 0 END) AS failure_count
      FROM backup_history
      WHERE started_at >= CURRENT_DATE
        AND source_system = $1`,
  },

  mysql: {
    // MySQL doesn't have built-in backup tracking; query our internal table
    dailyStats: `
      SELECT 
        DATE(started_at) AS backup_date,
        COUNT(*) AS backup_count,
        COALESCE(SUM(size_mb), 0) AS total_size_mb,
        COALESCE(AVG(duration_seconds), 0) AS avg_duration_seconds,
        SUM(CASE WHEN status = 'SUCCESS' THEN 1 ELSE 0 END) AS success_count,
        SUM(CASE WHEN status != 'SUCCESS' THEN 1 ELSE 0 END) AS failure_count
      FROM backup_history
      WHERE started_at >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
        AND source_system = ?
      GROUP BY DATE(started_at)
      ORDER BY backup_date DESC`,

    todayStats: `
      SELECT 
        CURDATE() AS backup_date,
        COUNT(*) AS backup_count,
        COALESCE(SUM(size_mb), 0) AS total_size_mb,
        COALESCE(AVG(duration_seconds), 0) AS avg_duration_seconds,
        SUM(CASE WHEN status = 'SUCCESS' THEN 1 ELSE 0 END) AS success_count,
        SUM(CASE WHEN status != 'SUCCESS' THEN 1 ELSE 0 END) AS failure_count
      FROM backup_history
      WHERE started_at >= CURDATE()
        AND source_system = ?`,
  },
};

export interface BackupAnomalyEngineConfig {
  analysisPeriodDays?: number;
  deviationThresholds?: Partial<typeof DEVIATION_THRESHOLDS>;
  metricsToAnalyze?: {
    backupCount?: boolean;
    totalSize?: boolean;
    avgDuration?: boolean;
    failureCount?: boolean;
  };
}

export class BackupAnomalyEngine {
  private readonly config: Required<BackupAnomalyEngineConfig>;
  private readonly thresholds: typeof DEVIATION_THRESHOLDS;

  constructor(config: BackupAnomalyEngineConfig = {}) {
    this.thresholds = { ...DEVIATION_THRESHOLDS, ...config.deviationThresholds };
    this.config = {
      analysisPeriodDays: config.analysisPeriodDays ?? 7,
      deviationThresholds: this.thresholds,
      metricsToAnalyze: {
        backupCount: config.metricsToAnalyze?.backupCount ?? true,
        totalSize: config.metricsToAnalyze?.totalSize ?? true,
        avgDuration: config.metricsToAnalyze?.avgDuration ?? true,
        failureCount: config.metricsToAnalyze?.failureCount ?? true,
      },
    };
  }

  /**
   * Analyze backup patterns and detect anomalies
   */
  async analyzeBackups(
    connector: DatabaseConnector,
    dbType: DbType,
    instanceId: string
  ): Promise<BackupAnomalyReport> {
    const anomalies: BackupAnomaly[] = [];
    let todayStats: BackupStats | null = null;
    let historicalAvg: BackupStats | null = null;

    try {
      // Get historical stats for the analysis period
      const historicalData = await this.getHistoricalStats(
        connector,
        dbType,
        instanceId,
        this.config.analysisPeriodDays
      );

      // Get today's stats
      todayStats = await this.getTodayStats(connector, dbType, instanceId);

      if (historicalData.length > 0) {
        // Calculate historical average
        historicalAvg = this.calculateAverage(historicalData);

        // Detect anomalies if we have today's data
        if (todayStats) {
          this.detectAnomalies(todayStats, historicalAvg, anomalies);
        }
      }
    } catch (error) {
      console.error("Backup anomaly analysis failed:", error);
      anomalies.push({
        severity: "HIGH",
        metricName: "analysis_error",
        currentValue: 0,
        expectedValue: 0,
        deviationPercent: 0,
        direction: "above",
        message: `Analysis failed: ${error instanceof Error ? error.message : "Unknown error"}`,
        detectedAt: new Date(),
      });
    }

    return {
      instanceId,
      dbType,
      analyzedAt: new Date(),
      analysisPeriodDays: this.config.analysisPeriodDays,
      todayStats,
      historicalAvg,
      anomalies,
      overallSeverity: this.calculateOverallSeverity(anomalies),
    };
  }

  /**
   * Get historical backup statistics
   */
  private async getHistoricalStats(
    connector: DatabaseConnector,
    dbType: DbType,
    instanceId: string,
    days: number
  ): Promise<BackupStats[]> {
    const queries = BACKUP_STATS_QUERIES[dbType];
    let params: unknown[];

    switch (dbType) {
      case "oracle":
        params = [days];
        break;
      case "mssql":
        // MSSQL uses @days in query, need to replace
        const mssqlQuery = queries.dailyStats.replace("@days", String(days));
        const results = await connector.query<{
          backup_date: Date;
          backup_count: number;
          total_size_mb: number;
          avg_duration_seconds: number;
          success_count: number;
          failure_count: number;
        }>(mssqlQuery);
        return this.mapToBackupStats(results);
      case "postgres":
      case "mysql":
        params = [days, instanceId];
        break;
    }

    const results = await connector.query<{
      backup_date: Date;
      backup_count: number;
      total_size_mb: number;
      avg_duration_seconds: number;
      success_count: number;
      failure_count: number;
    }>(queries.dailyStats, params);

    return this.mapToBackupStats(results);
  }

  /**
   * Get today's backup statistics
   */
  private async getTodayStats(
    connector: DatabaseConnector,
    dbType: DbType,
    instanceId: string
  ): Promise<BackupStats | null> {
    const queries = BACKUP_STATS_QUERIES[dbType];
    let params: unknown[] | undefined;

    switch (dbType) {
      case "oracle":
      case "mssql":
        params = undefined;
        break;
      case "postgres":
      case "mysql":
        params = [instanceId];
        break;
    }

    const results = await connector.query<{
      backup_date: Date;
      backup_count: number;
      total_size_mb: number;
      avg_duration_seconds: number;
      success_count: number;
      failure_count: number;
    }>(queries.todayStats, params);

    const stats = this.mapToBackupStats(results);
    return stats.length > 0 ? stats[0]! : null;
  }

  /**
   * Map query results to BackupStats objects
   */
  private mapToBackupStats(
    results: Array<{
      backup_date: Date;
      backup_count: number;
      total_size_mb: number;
      avg_duration_seconds: number;
      success_count: number;
      failure_count: number;
    }>
  ): BackupStats[] {
    return results.map((row) => ({
      date: new Date(row.backup_date),
      backupCount: Number(row.backup_count),
      totalSizeMb: Number(row.total_size_mb),
      avgDurationSeconds: Number(row.avg_duration_seconds),
      successCount: Number(row.success_count),
      failureCount: Number(row.failure_count),
    }));
  }

  /**
   * Calculate average from historical data
   */
  private calculateAverage(data: BackupStats[]): BackupStats {
    const count = data.length;
    if (count === 0) {
      return {
        date: new Date(),
        backupCount: 0,
        totalSizeMb: 0,
        avgDurationSeconds: 0,
        successCount: 0,
        failureCount: 0,
      };
    }

    const sum = data.reduce(
      (acc, stat) => ({
        backupCount: acc.backupCount + stat.backupCount,
        totalSizeMb: acc.totalSizeMb + stat.totalSizeMb,
        avgDurationSeconds: acc.avgDurationSeconds + stat.avgDurationSeconds,
        successCount: acc.successCount + stat.successCount,
        failureCount: acc.failureCount + stat.failureCount,
      }),
      {
        backupCount: 0,
        totalSizeMb: 0,
        avgDurationSeconds: 0,
        successCount: 0,
        failureCount: 0,
      }
    );

    return {
      date: new Date(),
      backupCount: sum.backupCount / count,
      totalSizeMb: sum.totalSizeMb / count,
      avgDurationSeconds: sum.avgDurationSeconds / count,
      successCount: sum.successCount / count,
      failureCount: sum.failureCount / count,
    };
  }

  /**
   * Detect anomalies by comparing today's stats to historical average
   */
  private detectAnomalies(
    today: BackupStats,
    avg: BackupStats,
    anomalies: BackupAnomaly[]
  ): void {
    const metrics = this.config.metricsToAnalyze;

    if (metrics.backupCount) {
      this.checkMetricAnomaly(
        "backup_count",
        "Backup Count",
        today.backupCount,
        avg.backupCount,
        anomalies,
        true // Lower than average is concerning
      );
    }

    if (metrics.totalSize) {
      this.checkMetricAnomaly(
        "total_size_mb",
        "Total Backup Size (MB)",
        today.totalSizeMb,
        avg.totalSizeMb,
        anomalies,
        false // Size can vary, both directions matter
      );
    }

    if (metrics.avgDuration) {
      this.checkMetricAnomaly(
        "avg_duration_seconds",
        "Average Backup Duration",
        today.avgDurationSeconds,
        avg.avgDurationSeconds,
        anomalies,
        false,
        true // Higher duration is concerning
      );
    }

    if (metrics.failureCount) {
      this.checkFailureAnomaly(
        today.failureCount,
        avg.failureCount,
        anomalies
      );
    }
  }

  /**
   * Check a single metric for anomalies
   */
  private checkMetricAnomaly(
    metricId: string,
    metricName: string,
    currentValue: number,
    expectedValue: number,
    anomalies: BackupAnomaly[],
    lowerIsBad: boolean = false,
    higherIsBad: boolean = false
  ): void {
    // Avoid division by zero
    if (expectedValue === 0) {
      if (currentValue > 0 && higherIsBad) {
        anomalies.push({
          severity: "MEDIUM",
          metricName: metricId,
          currentValue,
          expectedValue: 0,
          deviationPercent: 100,
          direction: "above",
          message: `${metricName}: Unexpected value ${currentValue.toFixed(2)} (expected ~0)`,
          detectedAt: new Date(),
        });
      }
      return;
    }

    const deviation = ((currentValue - expectedValue) / expectedValue) * 100;
    const absDeviation = Math.abs(deviation);
    const direction: "above" | "below" = deviation >= 0 ? "above" : "below";

    // Check if deviation exceeds threshold
    if (absDeviation >= this.thresholds.low) {
      // Determine if this direction is concerning
      const isConcerning =
        (direction === "below" && lowerIsBad) ||
        (direction === "above" && higherIsBad) ||
        (!lowerIsBad && !higherIsBad); // Both directions matter

      if (isConcerning) {
        const severity = this.classifySeverity(absDeviation);
        anomalies.push({
          severity,
          metricName: metricId,
          currentValue,
          expectedValue,
          deviationPercent: Math.round(absDeviation * 10) / 10,
          direction,
          message: this.formatAnomalyMessage(
            metricName,
            currentValue,
            expectedValue,
            absDeviation,
            direction
          ),
          detectedAt: new Date(),
        });
      }
    }
  }

  /**
   * Special handling for failure count anomalies
   */
  private checkFailureAnomaly(
    currentFailures: number,
    avgFailures: number,
    anomalies: BackupAnomaly[]
  ): void {
    // Any failures are concerning, especially if higher than average
    if (currentFailures > 0) {
      let severity: AnomalySeverity;
      let message: string;

      if (avgFailures === 0) {
        // No historical failures, but we have failures today
        severity = currentFailures >= 3 ? "CRITICAL" : currentFailures >= 2 ? "HIGH" : "MEDIUM";
        message = `${currentFailures} backup failure(s) detected today (no historical failures)`;
      } else {
        const deviation = ((currentFailures - avgFailures) / avgFailures) * 100;
        if (deviation >= this.thresholds.critical) {
          severity = "CRITICAL";
        } else if (deviation >= this.thresholds.high) {
          severity = "HIGH";
        } else if (currentFailures > avgFailures) {
          severity = "MEDIUM";
        } else {
          severity = "LOW";
        }
        message = `${currentFailures} backup failure(s) today vs ${avgFailures.toFixed(1)} avg`;
      }

      anomalies.push({
        severity,
        metricName: "failure_count",
        currentValue: currentFailures,
        expectedValue: avgFailures,
        deviationPercent: avgFailures > 0 
          ? Math.round(((currentFailures - avgFailures) / avgFailures) * 100)
          : 100,
        direction: "above",
        message,
        detectedAt: new Date(),
      });
    }
  }

  /**
   * Classify severity based on deviation percentage
   */
  private classifySeverity(deviationPercent: number): AnomalySeverity {
    if (deviationPercent >= this.thresholds.critical) return "CRITICAL";
    if (deviationPercent >= this.thresholds.high) return "HIGH";
    if (deviationPercent >= this.thresholds.medium) return "MEDIUM";
    return "LOW";
  }

  /**
   * Format human-readable anomaly message
   */
  private formatAnomalyMessage(
    metricName: string,
    current: number,
    expected: number,
    deviationPercent: number,
    direction: "above" | "below"
  ): string {
    const dirText = direction === "above" ? "higher than" : "lower than";
    return `${metricName}: ${current.toFixed(2)} is ${deviationPercent.toFixed(1)}% ${dirText} expected ${expected.toFixed(2)}`;
  }

  /**
   * Calculate overall severity from all anomalies
   */
  private calculateOverallSeverity(anomalies: BackupAnomaly[]): AnomalySeverity | "OK" {
    if (anomalies.length === 0) return "OK";

    if (anomalies.some((a) => a.severity === "CRITICAL")) return "CRITICAL";
    if (anomalies.some((a) => a.severity === "HIGH")) return "HIGH";
    if (anomalies.some((a) => a.severity === "MEDIUM")) return "MEDIUM";
    return "LOW";
  }
}

// Factory function
export function createBackupAnomalyEngine(
  config?: BackupAnomalyEngineConfig
): BackupAnomalyEngine {
  return new BackupAnomalyEngine(config);
}

// Export default thresholds
export { DEVIATION_THRESHOLDS as DEFAULT_DEVIATION_THRESHOLDS };
