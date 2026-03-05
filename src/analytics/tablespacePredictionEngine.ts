import type { DbType, DatabaseConnector } from "../connectors/types";

// ─── Risk Bands ─────────────────────────────────────────────────────────────
export type PredictionRisk = "CRITICAL" | "HIGH" | "WARNING" | "OK";

const RISK_BAND_DAYS = {
  critical: 7,
  high: 15,
  warning: 30,
} as const;

// ─── Types ──────────────────────────────────────────────────────────────────

export interface TablespacePrediction {
  name: string;
  dbType: DbType;
  currentUsedBytes: number;
  currentTotalBytes: number;
  currentUsedPercent: number;
  freeBytes: number;
  autoExtensible: boolean;
  maxSizeBytes: number | null;
  /** Effective capacity: maxSize if auto-extensible, else totalBytes */
  effectiveCapacityBytes: number;
  effectiveFreeBytes: number;
  /** Average daily growth in bytes (linear regression over snapshot window) */
  growthPerDayBytes: number;
  /** Estimated days until the tablespace is full (null = no growth / infinite) */
  daysToFull: number | null;
  risk: PredictionRisk;
  /** Human-readable prediction message */
  message: string;
  /** The snapshot data points used for regression */
  snapshots: GrowthSnapshot[];
}

export interface GrowthSnapshot {
  date: Date;
  usedBytes: number;
}

export interface TablespacePredictionReport {
  instanceId: string;
  dbType: DbType;
  analyzedAt: Date;
  snapshotWindowDays: number;
  predictions: TablespacePrediction[];
  highestRisk: PredictionRisk;
}

export interface TablespacePredictionConfig {
  /** Number of days of historical data to use for regression (default: 7) */
  snapshotWindowDays?: number;
  /** Custom risk band thresholds (days-to-full) */
  riskBands?: Partial<typeof RISK_BAND_DAYS>;
}

export const DEFAULT_RISK_BANDS = { ...RISK_BAND_DAYS } as const;

// ─── DB-specific Queries ────────────────────────────────────────────────────
// Two categories per DB:
//   1. currentUsage – live tablespace / filegroup / schema sizes
//   2. historicalGrowth – daily snapshots from our internal metrics DB

const TABLESPACE_QUERIES: Record<DbType, { currentUsage: string }> = {
  oracle: {
    currentUsage: `
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
  },

  mssql: {
    currentUsage: `
      SELECT
        f.name AS name,
        CAST(FILEPROPERTY(f.name, 'SpaceUsed') AS BIGINT) * 8192 AS used_bytes,
        CAST(f.size AS BIGINT) * 8192 AS total_bytes,
        ROUND(CAST(FILEPROPERTY(f.name, 'SpaceUsed') AS FLOAT) / NULLIF(f.size, 0) * 100, 2) AS used_percent,
        CASE WHEN f.growth > 0 THEN 1 ELSE 0 END AS auto_extensible,
        CASE WHEN f.max_size = -1 THEN NULL ELSE CAST(f.max_size AS BIGINT) * 8192 END AS max_size_bytes
      FROM sys.database_files f
      WHERE f.type = 0`,
  },

  postgres: {
    currentUsage: `
      SELECT
        d.datname AS name,
        pg_database_size(d.datname) AS used_bytes,
        pg_database_size(d.datname) AS total_bytes,
        100.0 AS used_percent,
        true AS auto_extensible,
        NULL::bigint AS max_size_bytes
      FROM pg_database d
      WHERE d.datname = current_database()
      UNION ALL
      SELECT
        s.schemaname AS name,
        SUM(pg_total_relation_size(s.schemaname || '.' || s.tablename)) AS used_bytes,
        SUM(pg_total_relation_size(s.schemaname || '.' || s.tablename)) AS total_bytes,
        0 AS used_percent,
        true AS auto_extensible,
        NULL::bigint AS max_size_bytes
      FROM pg_tables s
      WHERE s.schemaname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
      GROUP BY s.schemaname`,
  },

  mysql: {
    currentUsage: `
      SELECT
        TABLE_SCHEMA AS name,
        SUM(DATA_LENGTH + INDEX_LENGTH) AS used_bytes,
        IFNULL(SUM(DATA_FREE), 0) + SUM(DATA_LENGTH + INDEX_LENGTH) AS total_bytes,
        ROUND(
          SUM(DATA_LENGTH + INDEX_LENGTH) /
          NULLIF(IFNULL(SUM(DATA_FREE), 0) + SUM(DATA_LENGTH + INDEX_LENGTH), 0) * 100,
          2
        ) AS used_percent,
        1 AS auto_extensible,
        NULL AS max_size_bytes
      FROM information_schema.TABLES
      WHERE TABLE_SCHEMA NOT IN ('mysql', 'information_schema', 'performance_schema', 'sys')
      GROUP BY TABLE_SCHEMA`,
  },
};

// Historical growth query runs against our internal metrics PostgreSQL database
const INTERNAL_GROWTH_QUERY = `
  SELECT
    snapshot_date AS date,
    used_bytes
  FROM ts_growth_snapshots
  WHERE instance_id = $1
    AND tablespace_name = $2
    AND snapshot_date >= CURRENT_DATE - $3::int
  ORDER BY snapshot_date ASC`;

/**
 * Oracle AWR historical tablespace usage.
 * DBA_HIST_TBSPC_SPACE_USAGE stores one row per AWR snapshot per tablespace.
 * Values are in database blocks — multiply by block_size to get bytes.
 * This is pre-computed data that Oracle collects automatically (no extra
 * round-trip to dba_segments) and is indexed, so the query is fast.
 */
const ORACLE_AWR_GROWTH_QUERY = `
  SELECT
    TRUNC(TO_DATE(h.rtime, 'MM/DD/YYYY HH24:MI:SS')) AS snap_day,
    MAX(h.tablespace_usedsize) * t.block_size AS used_bytes
  FROM dba_hist_tbspc_space_usage h
  JOIN v$tablespace vt  ON h.tablespace_id = vt.ts#
  JOIN dba_tablespaces t ON vt.name = t.tablespace_name
  WHERE vt.name = :1
    AND TO_DATE(h.rtime, 'MM/DD/YYYY HH24:MI:SS') >= SYSDATE - :2
  GROUP BY TRUNC(TO_DATE(h.rtime, 'MM/DD/YYYY HH24:MI:SS')), t.block_size
  ORDER BY snap_day ASC`;

// ─── Helpers ────────────────────────────────────────────────────────────────

function classifyRisk(
  daysToFull: number | null,
  bands: typeof RISK_BAND_DAYS
): PredictionRisk {
  if (daysToFull === null) return "OK"; // no growth or shrinking
  if (daysToFull < 0) return "OK"; // shrinking
  if (daysToFull <= bands.critical) return "CRITICAL";
  if (daysToFull <= bands.high) return "HIGH";
  if (daysToFull <= bands.warning) return "WARNING";
  return "OK";
}

function riskMessage(
  name: string,
  daysToFull: number | null,
  risk: PredictionRisk,
  growthPerDayMb: number
): string {
  if (daysToFull === null || daysToFull < 0) {
    return `${name}: No growth detected. Storage is stable.`;
  }
  const daysStr = daysToFull === Infinity ? "∞" : daysToFull.toFixed(1);
  const growthStr = growthPerDayMb.toFixed(2);
  switch (risk) {
    case "CRITICAL":
      return `${name}: CRITICAL — estimated full in ${daysStr} days (growing ~${growthStr} MB/day). Immediate action required.`;
    case "HIGH":
      return `${name}: HIGH risk — estimated full in ${daysStr} days (growing ~${growthStr} MB/day). Plan expansion soon.`;
    case "WARNING":
      return `${name}: WARNING — estimated full in ${daysStr} days (growing ~${growthStr} MB/day). Monitor closely.`;
    default:
      return `${name}: OK — estimated full in ${daysStr} days (growing ~${growthStr} MB/day).`;
  }
}

/**
 * Simple linear regression: compute average daily growth from snapshots.
 * Returns average growth in bytes per day.
 * If fewer than 2 data points, returns 0 (cannot determine trend).
 */
function computeGrowthPerDay(snapshots: GrowthSnapshot[]): number {
  if (snapshots.length < 2) return 0;

  // Sort by date ascending
  const sorted = [...snapshots].sort((a, b) => a.date.getTime() - b.date.getTime());

  // Calculate day-over-day deltas
  const deltas: number[] = [];
  for (let i = 1; i < sorted.length; i++) {
    const daysDiff =
      (sorted[i]!.date.getTime() - sorted[i - 1]!.date.getTime()) / (1000 * 60 * 60 * 24);
    if (daysDiff > 0) {
      const bytesDiff = sorted[i]!.usedBytes - sorted[i - 1]!.usedBytes;
      deltas.push(bytesDiff / daysDiff);
    }
  }

  if (deltas.length === 0) return 0;

  // Average daily growth
  const sum = deltas.reduce((acc, d) => acc + d, 0);
  return sum / deltas.length;
}

function highestRiskOf(risks: PredictionRisk[]): PredictionRisk {
  const order: PredictionRisk[] = ["CRITICAL", "HIGH", "WARNING", "OK"];
  for (const level of order) {
    if (risks.includes(level)) return level;
  }
  return "OK";
}

// ─── Row Types ──────────────────────────────────────────────────────────────

type CurrentUsageRow = {
  name: string;
  used_bytes: number | string;
  total_bytes: number | string;
  used_percent: number | string;
  auto_extensible: boolean | number | string;
  max_size_bytes: number | string | null;
};

type GrowthRow = {
  date: Date | string;
  used_bytes: number | string;
};

// ─── Cache ──────────────────────────────────────────────────────────────────

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

const usageCache = new Map<string, CacheEntry<{
  name: string;
  currentUsedBytes: number;
  totalBytes: number;
  usedPercent: number;
  autoExtensible: boolean;
  maxSizeBytes: number | null;
}[]>>();

/** Default cache TTL: 5 minutes */
const CACHE_TTL_MS = 5 * 60 * 1000;

// ─── Engine ─────────────────────────────────────────────────────────────────

export class TablespacePredictionEngine {
  private readonly snapshotWindowDays: number;
  private readonly bands: typeof RISK_BAND_DAYS;

  constructor(config?: TablespacePredictionConfig) {
    this.snapshotWindowDays = config?.snapshotWindowDays ?? 7;
    this.bands = {
      critical: config?.riskBands?.critical ?? RISK_BAND_DAYS.critical,
      high: config?.riskBands?.high ?? RISK_BAND_DAYS.high,
      warning: config?.riskBands?.warning ?? RISK_BAND_DAYS.warning,
    };
  }

  /**
   * Run the full tablespace prediction analysis for an instance.
   *
   * Reads current usage from the latest recorded snapshot (instant) when
   * available and falls back to a live query only if no snapshot exists.
   * Live Oracle dictionary queries can take 60 s+ on large databases, so
   * prefer recording daily snapshots via POST /:id/predictions/snapshot.
   */
  public async analyze(
    instanceId: string,
    dbType: DbType,
    connector: DatabaseConnector,
    metricsPool: { query(sql: string, params?: unknown[]): Promise<{ rows: unknown[] }> }
  ): Promise<TablespacePredictionReport> {
    const analyzedAt = new Date();

    // 1. Try serving current usage from the latest stored snapshot (fast path)
    let currentUsage = await this.fetchUsageFromSnapshots(metricsPool, instanceId);

    // 2. Fall back to live query if no snapshot data exists
    if (currentUsage.length === 0) {
      currentUsage = await this.fetchCurrentUsage(connector, dbType, instanceId);
    }

    // 2. For each tablespace, get historical growth data & build predictions
    const predictions: TablespacePrediction[] = [];

    for (const ts of currentUsage) {
      // For Oracle, prefer AWR historical data (already collected by the server)
      let snapshots: GrowthSnapshot[];
      if (dbType === 'oracle') {
        snapshots = await this.fetchOracleAWRGrowth(connector, ts.name, this.snapshotWindowDays);
      } else {
        snapshots = await this.fetchHistoricalGrowth(metricsPool, instanceId, ts.name);
      }
      // If Oracle AWR returned nothing, fall back to internal snapshots
      if (snapshots.length === 0 && dbType === 'oracle') {
        snapshots = await this.fetchHistoricalGrowth(metricsPool, instanceId, ts.name);
      }

      const growthPerDayBytes = computeGrowthPerDay(snapshots);

      // Determine effective capacity (consider auto-extensible max)
      const effectiveCapacity =
        ts.autoExtensible && ts.maxSizeBytes !== null && ts.maxSizeBytes > ts.totalBytes
          ? ts.maxSizeBytes
          : ts.totalBytes;

      const effectiveFree = Math.max(effectiveCapacity - ts.currentUsedBytes, 0);

      // Calculate days to full
      let daysToFull: number | null;
      if (growthPerDayBytes <= 0) {
        daysToFull = null; // no growth or shrinking
      } else {
        daysToFull = effectiveFree / growthPerDayBytes;
      }

      const risk = classifyRisk(daysToFull, this.bands);
      const growthPerDayMb = growthPerDayBytes / (1024 * 1024);

      predictions.push({
        name: ts.name,
        dbType,
        currentUsedBytes: ts.currentUsedBytes,
        currentTotalBytes: ts.totalBytes,
        currentUsedPercent: ts.usedPercent,
        freeBytes: ts.totalBytes - ts.currentUsedBytes,
        autoExtensible: ts.autoExtensible,
        maxSizeBytes: ts.maxSizeBytes,
        effectiveCapacityBytes: effectiveCapacity,
        effectiveFreeBytes: effectiveFree,
        growthPerDayBytes,
        daysToFull,
        risk,
        message: riskMessage(ts.name, daysToFull, risk, growthPerDayMb),
        snapshots,
      });
    }

    // Sort: highest risk first
    const riskOrder: Record<PredictionRisk, number> = { CRITICAL: 0, HIGH: 1, WARNING: 2, OK: 3 };
    predictions.sort((a, b) => riskOrder[a.risk] - riskOrder[b.risk]);

    return {
      instanceId,
      dbType,
      analyzedAt,
      snapshotWindowDays: this.snapshotWindowDays,
      predictions,
      highestRisk: highestRiskOf(predictions.map((p) => p.risk)),
    };
  }

  // ── Data Fetchers ───────────────────────────────────────────────────────

  /**
   * Reconstruct current-usage data from the LATEST recorded snapshot in the
   * internal PostgreSQL metrics DB.  This is instant (~1 ms) and avoids
   * querying slow Oracle dictionary views.
   *
   * Returns an empty array if no snapshots exist (caller should fall back to
   * a live query or return "no data" to the UI).
   */
  private async fetchUsageFromSnapshots(
    metricsPool: { query(sql: string, params?: unknown[]): Promise<{ rows: unknown[] }> },
    instanceId: string
  ): Promise<
    {
      name: string;
      currentUsedBytes: number;
      totalBytes: number;
      usedPercent: number;
      autoExtensible: boolean;
      maxSizeBytes: number | null;
    }[]
  > {
    try {
      // Get the most recent snapshot row per tablespace
      const sql = `
        SELECT DISTINCT ON (tablespace_name)
               tablespace_name AS name,
               used_bytes,
               total_bytes
          FROM ts_growth_snapshots
         WHERE instance_id = $1
         ORDER BY tablespace_name, snapshot_date DESC`;

      const result = await metricsPool.query(sql, [instanceId]);
      const rows = result.rows as { name: string; used_bytes: string | number; total_bytes: string | number }[];

      if (rows.length === 0) return [];

      return rows.map((row) => {
        const usedBytes = Number(row.used_bytes) || 0;
        const totalBytes = Number(row.total_bytes) || 0;
        const usedPercent = totalBytes > 0 ? (usedBytes / totalBytes) * 100 : 0;
        return {
          name: String(row.name),
          currentUsedBytes: usedBytes,
          totalBytes,
          usedPercent,
          autoExtensible: false, // conservative default from snapshot
          maxSizeBytes: null,
        };
      });
    } catch {
      return [];
    }
  }

  private async fetchCurrentUsage(
    connector: DatabaseConnector,
    dbType: DbType,
    instanceId?: string
  ): Promise<
    {
      name: string;
      currentUsedBytes: number;
      totalBytes: number;
      usedPercent: number;
      autoExtensible: boolean;
      maxSizeBytes: number | null;
    }[]
  > {
    // Check cache first (Oracle queries can take 50s+)
    const cacheKey = instanceId ?? "default";
    const cached = usageCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.data;
    }

    const sql = TABLESPACE_QUERIES[dbType].currentUsage;
    const rawRows = await connector.query<Record<string, unknown>>(sql);

    // Normalize column keys to lowercase — Oracle returns UPPERCASE column names
    const rows: CurrentUsageRow[] = rawRows.map((raw) => {
      const normalized: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(raw)) {
        normalized[key.toLowerCase()] = value;
      }
      return normalized as unknown as CurrentUsageRow;
    });

    const result = rows.map((row) => ({
      name: String(row.name),
      currentUsedBytes: Number(row.used_bytes) || 0,
      totalBytes: Number(row.total_bytes) || 0,
      usedPercent: Number(row.used_percent) || 0,
      autoExtensible: row.auto_extensible === true || row.auto_extensible === 1 || row.auto_extensible === "YES",
      maxSizeBytes: row.max_size_bytes !== null && row.max_size_bytes !== undefined
        ? Number(row.max_size_bytes) || null
        : null,
    }));

    // Cache the result
    usageCache.set(cacheKey, { data: result, expiresAt: Date.now() + CACHE_TTL_MS });

    return result;
  }

  private async fetchHistoricalGrowth(
    metricsPool: { query(sql: string, params?: unknown[]): Promise<{ rows: unknown[] }> },
    instanceId: string,
    tablespaceName: string
  ): Promise<GrowthSnapshot[]> {
    try {
      const result = await metricsPool.query(INTERNAL_GROWTH_QUERY, [
        instanceId,
        tablespaceName,
        this.snapshotWindowDays,
      ]);

      return (result.rows as GrowthRow[]).map((row) => ({
        date: row.date instanceof Date ? row.date : new Date(row.date),
        usedBytes: Number(row.used_bytes) || 0,
      }));
    } catch {
      // If the tablespace_snapshots table is empty or doesn't have data yet,
      // return empty array — predictions will show "no growth detected"
      return [];
    }
  }

  /**
   * Fetch historical tablespace growth directly from Oracle AWR
   * (DBA_HIST_TBSPC_SPACE_USAGE).  Oracle records one row per AWR snapshot
   * (~every hour) so we GROUP BY day and take the MAX used size per day.
   * This is indexed/pre-computed by Oracle, so it's fast (~<1 s).
   */
  private async fetchOracleAWRGrowth(
    connector: DatabaseConnector,
    tablespaceName: string,
    windowDays: number
  ): Promise<GrowthSnapshot[]> {
    try {
      const rawRows = await connector.query<Record<string, unknown>>(
        ORACLE_AWR_GROWTH_QUERY,
        [tablespaceName, windowDays]
      );

      // Normalize Oracle UPPERCASE column keys
      return rawRows.map((raw) => {
        const normalized: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(raw)) {
          normalized[key.toLowerCase()] = value;
        }
        const snapDay = normalized["snap_day"];
        const usedBytes = Number(normalized["used_bytes"]) || 0;
        return {
          date: snapDay instanceof Date ? snapDay : new Date(String(snapDay)),
          usedBytes,
        };
      });
    } catch (err) {
      // AWR might not be available (Standard Edition, CDB restrictions, etc.)
      console.warn(`[PredictionEngine] Oracle AWR query failed for ${tablespaceName}:`, err);
      return [];
    }
  }

  // ── Snapshot Recorder ────────────────────────────────────────────────────
  // Call this periodically (e.g. daily cron) to store growth data points

  /**
   * Record a tablespace snapshot for an instance into the internal metrics DB.
   * Should be called daily for each managed instance for accurate predictions.
   */
  public async recordSnapshot(
    instanceId: string,
    dbType: DbType,
    connector: DatabaseConnector,
    metricsPool: { query(sql: string, params?: unknown[]): Promise<{ rows: unknown[] }> }
  ): Promise<number> {
    const current = await this.fetchCurrentUsage(connector, dbType, instanceId);

    const insertSql = `
      INSERT INTO ts_growth_snapshots (instance_id, tablespace_name, used_bytes, total_bytes, snapshot_date)
      VALUES ($1, $2, $3, $4, CURRENT_DATE)
      ON CONFLICT (instance_id, tablespace_name, snapshot_date) DO UPDATE
        SET used_bytes = EXCLUDED.used_bytes,
            total_bytes = EXCLUDED.total_bytes`;

    let recorded = 0;
    for (const ts of current) {
      await metricsPool.query(insertSql, [
        instanceId,
        ts.name,
        ts.currentUsedBytes,
        ts.totalBytes,
      ]);
      recorded++;
    }

    return recorded;
  }
}

// ─── Factory ────────────────────────────────────────────────────────────────

export function createTablespacePredictionEngine(
  config?: TablespacePredictionConfig
): TablespacePredictionEngine {
  return new TablespacePredictionEngine(config);
}
