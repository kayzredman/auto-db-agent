"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowLeft,
  RefreshCw,
  TrendingUp,
  HardDrive,
  AlertTriangle,
  CheckCircle,
  XCircle,
  Clock,
  Camera,
  Database,
} from "lucide-react";
import {
  getDatabase,
  getTablespacePredictions,
  recordTablespaceSnapshot,
} from "@/lib/api";
import type {
  DatabaseInstance,
  TablespacePredictionReport,
  TablespacePrediction,
  PredictionRisk,
} from "@/lib/types";
import { Card, Button, Spinner, StatusBadge } from "@/components/ui";

const riskColors: Record<PredictionRisk, string> = {
  CRITICAL: "bg-danger/15 text-danger border-danger/30",
  HIGH: "bg-warning/15 text-warning border-warning/30",
  WARNING: "bg-yellow-500/15 text-yellow-400 border-yellow-500/30",
  OK: "bg-success/15 text-success border-success/30",
};

const riskIcons: Record<PredictionRisk, typeof AlertTriangle> = {
  CRITICAL: XCircle,
  HIGH: AlertTriangle,
  WARNING: Clock,
  OK: CheckCircle,
};

const dbTypeLabels: Record<string, string> = {
  postgres: "PostgreSQL",
  mysql: "MySQL",
  mssql: "SQL Server",
  oracle: "Oracle",
};

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const val = bytes / Math.pow(1024, i);
  return `${val.toFixed(val < 10 ? 2 : 1)} ${units[i]}`;
}

function formatDays(days: number | null): string {
  if (days === null) return "∞";
  if (days < 1) return `${Math.round(days * 24)}h`;
  if (days < 7) return `${days.toFixed(1)} days`;
  if (days < 30) return `${Math.round(days)} days`;
  if (days < 365) return `${(days / 30).toFixed(1)} months`;
  return `${(days / 365).toFixed(1)} years`;
}

function RiskBadge({ risk }: { risk: PredictionRisk }) {
  const Icon = riskIcons[risk];
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border ${riskColors[risk]}`}
    >
      <Icon className="w-3.5 h-3.5" />
      {risk}
    </span>
  );
}

function UsageBar({ used, total, label }: { used: number; total: number; label?: string }) {
  const pct = total > 0 ? Math.min((used / total) * 100, 100) : 0;
  const barColor =
    pct >= 90 ? "bg-danger" : pct >= 80 ? "bg-warning" : pct >= 60 ? "bg-yellow-400" : "bg-success";

  return (
    <div className="w-full">
      {label && (
        <div className="flex justify-between text-xs text-muted mb-1">
          <span>{label}</span>
          <span>{pct.toFixed(1)}%</span>
        </div>
      )}
      <div className="w-full h-2.5 bg-surface-hover rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-500 ${barColor}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function PredictionCard({ prediction }: { prediction: TablespacePrediction }) {
  const Icon = riskIcons[prediction.risk];
  const growthPerDayMb = prediction.growthPerDayBytes / (1024 * 1024);

  return (
    <Card className="relative overflow-hidden">
      {/* Risk indicator stripe */}
      <div
        className={`absolute top-0 left-0 w-1.5 h-full ${
          prediction.risk === "CRITICAL"
            ? "bg-danger"
            : prediction.risk === "HIGH"
            ? "bg-warning"
            : prediction.risk === "WARNING"
            ? "bg-yellow-400"
            : "bg-success"
        }`}
      />

      <div className="pl-4">
        {/* Header */}
        <div className="flex items-start justify-between mb-4">
          <div>
            <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
              <HardDrive className="w-4 h-4 text-muted" />
              {prediction.name}
            </h3>
            <p className="text-xs text-muted mt-0.5">
              {dbTypeLabels[prediction.dbType] ?? prediction.dbType}
              {prediction.autoExtensible && " • Auto-extensible"}
            </p>
          </div>
          <RiskBadge risk={prediction.risk} />
        </div>

        {/* Usage bar */}
        <UsageBar
          used={prediction.currentUsedBytes}
          total={prediction.effectiveCapacityBytes}
          label={`${formatBytes(prediction.currentUsedBytes)} / ${formatBytes(prediction.effectiveCapacityBytes)}`}
        />

        {/* Stats grid */}
        <div className="grid grid-cols-3 gap-3 mt-4">
          <div>
            <p className="text-xs text-muted">Free Space</p>
            <p className="text-sm font-semibold text-foreground">
              {formatBytes(prediction.effectiveFreeBytes)}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted">Growth / Day</p>
            <p className="text-sm font-semibold text-foreground">
              {prediction.snapshots.length < 2
                ? "N/A"
                : growthPerDayMb > 0.01
                  ? `+${growthPerDayMb < 1 ? growthPerDayMb.toFixed(3) : growthPerDayMb.toFixed(2)} MB`
                  : growthPerDayMb < -0.01
                    ? `${growthPerDayMb.toFixed(2)} MB`
                    : "Stable"}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted">Days to Full</p>
            <p
              className={`text-sm font-bold ${
                prediction.risk === "CRITICAL"
                  ? "text-danger"
                  : prediction.risk === "HIGH"
                  ? "text-warning"
                  : "text-foreground"
              }`}
            >
              {formatDays(prediction.daysToFull)}
            </p>
          </div>
        </div>

        {/* Snapshot data info */}
        <div className="mt-3 pt-3 border-t border-border">
          <p className="text-xs text-muted">
            {prediction.snapshots.length > 0
              ? `Based on ${prediction.snapshots.length} snapshot${prediction.snapshots.length > 1 ? "s" : ""} over the analysis window`
              : "No historical snapshots — record snapshots daily for accurate predictions"}
          </p>
        </div>
      </div>
    </Card>
  );
}

export default function PredictionsPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;

  const [instance, setInstance] = useState<DatabaseInstance | null>(null);
  const [report, setReport] = useState<TablespacePredictionReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [analyzing, setAnalyzing] = useState(false);
  const [snapshotting, setSnapshotting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<{
    message: string;
    type: "success" | "error";
  } | null>(null);

  const fetchData = useCallback(async () => {
    try {
      setError(null);
      const [inst, pred] = await Promise.all([
        getDatabase(id),
        getTablespacePredictions(id),
      ]);
      setInstance(inst);
      setReport(pred);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load predictions");
    } finally {
      setLoading(false);
      setAnalyzing(false);
    }
  }, [id]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  async function handleRefresh() {
    setAnalyzing(true);
    await fetchData();
  }

  async function handleRecordSnapshot() {
    try {
      setSnapshotting(true);
      const result = await recordTablespaceSnapshot(id);
      setToast({
        message: `Snapshot recorded: ${result.tablespacesRecorded} tablespace(s) on ${result.snapshotDate}`,
        type: "success",
      });
      // Refresh predictions to pick up new data
      await fetchData();
    } catch (err) {
      setToast({
        message: err instanceof Error ? err.message : "Failed to record snapshot",
        type: "error",
      });
    } finally {
      setSnapshotting(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Spinner />
      </div>
    );
  }

  if (error && !instance) {
    return (
      <div className="p-6">
        <button
          onClick={() => router.push(`/databases/${id}`)}
          className="flex items-center gap-2 text-sm text-muted hover:text-foreground mb-4"
        >
          <ArrowLeft className="w-4 h-4" /> Back to Instance
        </button>
        <Card className="text-center py-12">
          <XCircle className="w-12 h-12 text-danger mx-auto mb-3" />
          <p className="text-danger font-medium">{error}</p>
          <Button onClick={() => { setLoading(true); fetchData(); }} className="mt-4">
            Retry
          </Button>
        </Card>
      </div>
    );
  }

  const riskCounts = {
    CRITICAL: report?.predictions.filter((p) => p.risk === "CRITICAL").length ?? 0,
    HIGH: report?.predictions.filter((p) => p.risk === "HIGH").length ?? 0,
    WARNING: report?.predictions.filter((p) => p.risk === "WARNING").length ?? 0,
    OK: report?.predictions.filter((p) => p.risk === "OK").length ?? 0,
  };

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* Toast */}
      {toast && (
        <div
          className={`fixed top-4 right-4 z-50 px-4 py-3 rounded-lg shadow-lg border ${
            toast.type === "success"
              ? "bg-success/15 border-success/30 text-success"
              : "bg-danger/15 border-danger/30 text-danger"
          }`}
        >
          {toast.message}
        </div>
      )}

      {/* Breadcrumb + Actions */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <button
            onClick={() => router.push(`/databases/${id}`)}
            className="flex items-center gap-2 text-sm text-muted hover:text-foreground mb-2"
          >
            <ArrowLeft className="w-4 h-4" /> Back to Instance
          </button>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-3">
            <TrendingUp className="w-7 h-7 text-primary" />
            Storage Predictions
          </h1>
          <p className="text-sm text-muted mt-1">
            {instance?.name} — {dbTypeLabels[instance?.db_type ?? ""] ?? instance?.db_type}
            {instance && <StatusBadge status={instance.status} />}
          </p>
        </div>

        <div className="flex gap-2">
          <Button
            onClick={handleRecordSnapshot}
            variant="ghost"
            disabled={snapshotting}
          >
            <Camera className={`w-4 h-4 mr-2 ${snapshotting ? "animate-pulse" : ""}`} />
            {snapshotting ? "Recording…" : "Record Snapshot"}
          </Button>
          <Button onClick={handleRefresh} disabled={analyzing}>
            <RefreshCw className={`w-4 h-4 mr-2 ${analyzing ? "animate-spin" : ""}`} />
            {analyzing ? "Analyzing…" : "Re-analyze"}
          </Button>
        </div>
      </div>

      {/* Risk Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className={riskCounts.CRITICAL > 0 ? "ring-1 ring-danger/40" : ""}>
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-danger/15">
              <XCircle className="w-5 h-5 text-danger" />
            </div>
            <div>
              <p className="text-xs text-muted">Critical</p>
              <p className="text-xl font-bold text-foreground">{riskCounts.CRITICAL}</p>
              <p className="text-xs text-muted">&lt; 7 days</p>
            </div>
          </div>
        </Card>

        <Card className={riskCounts.HIGH > 0 ? "ring-1 ring-warning/40" : ""}>
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-warning/15">
              <AlertTriangle className="w-5 h-5 text-warning" />
            </div>
            <div>
              <p className="text-xs text-muted">High</p>
              <p className="text-xl font-bold text-foreground">{riskCounts.HIGH}</p>
              <p className="text-xs text-muted">&lt; 15 days</p>
            </div>
          </div>
        </Card>

        <Card className={riskCounts.WARNING > 0 ? "ring-1 ring-yellow-500/40" : ""}>
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-yellow-500/15">
              <Clock className="w-5 h-5 text-yellow-400" />
            </div>
            <div>
              <p className="text-xs text-muted">Warning</p>
              <p className="text-xl font-bold text-foreground">{riskCounts.WARNING}</p>
              <p className="text-xs text-muted">&lt; 30 days</p>
            </div>
          </div>
        </Card>

        <Card>
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-success/15">
              <CheckCircle className="w-5 h-5 text-success" />
            </div>
            <div>
              <p className="text-xs text-muted">OK</p>
              <p className="text-xl font-bold text-foreground">{riskCounts.OK}</p>
              <p className="text-xs text-muted">30+ days</p>
            </div>
          </div>
        </Card>
      </div>

      {/* Overall risk banner */}
      {report && report.highestRisk !== "OK" && (
        <div
          className={`rounded-lg border px-4 py-3 flex items-center gap-3 ${riskColors[report.highestRisk]}`}
        >
          {(() => {
            const Icon = riskIcons[report.highestRisk];
            return <Icon className="w-5 h-5 shrink-0" />;
          })()}
          <div>
            <p className="font-semibold text-sm">
              Highest Risk: {report.highestRisk}
            </p>
            <p className="text-xs opacity-80">
              {riskCounts.CRITICAL > 0 &&
                `${riskCounts.CRITICAL} tablespace(s) estimated full within 7 days. `}
              {riskCounts.HIGH > 0 &&
                `${riskCounts.HIGH} tablespace(s) nearing capacity within 15 days. `}
              {riskCounts.WARNING > 0 &&
                `${riskCounts.WARNING} tablespace(s) to monitor within 30 days.`}
            </p>
          </div>
        </div>
      )}

      {/* Prediction Cards */}
      {report && report.predictions.length > 0 ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {report.predictions.map((pred) => (
            <PredictionCard key={pred.name} prediction={pred} />
          ))}
        </div>
      ) : (
        <Card className="text-center py-16">
          <Database className="w-16 h-16 text-muted mx-auto mb-4 opacity-50" />
          <h3 className="text-lg font-semibold text-foreground mb-2">
            No Tablespace Data
          </h3>
          <p className="text-sm text-muted max-w-md mx-auto mb-6">
            No tablespaces found or the instance is not connected. Ensure the instance is active and
            the user has sufficient privileges to query tablespace metadata.
          </p>
          <Button onClick={handleRefresh} disabled={analyzing}>
            <RefreshCw className={`w-4 h-4 mr-2 ${analyzing ? "animate-spin" : ""}`} />
            Retry
          </Button>
        </Card>
      )}

      {/* Analysis metadata */}
      {report && (
        <p className="text-xs text-muted text-center">
          Analyzed at {new Date(report.analyzedAt).toLocaleString()} •
          Snapshot window: {report.snapshotWindowDays} days •
          {report.predictions.length} tablespace(s) evaluated
        </p>
      )}
    </div>
  );
}
